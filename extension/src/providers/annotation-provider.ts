import * as path from 'path'
import * as vscode from 'vscode'
import type {
  AnnotationGeneratePayload,
  AnnotationStatusPayload,
  WsMessage,
} from '@code-viewer/shared'
import { createMessage } from '../ws/client'
import { debugLog } from '../utils/debug'
import { ensureTarget, sendMessage } from './tmux-adapter-client'

const ANNOTATION_ROOT = '.codeviewer/annotated'
const SPAWN_READY_DELAY_MS = 2500

interface SafeAnnotationPath {
  relativePath: string
  sourceUri: vscode.Uri
  annotationPath: string
  annotationUri: vscode.Uri
}

function sendError(
  requestType: string,
  requestId: string,
  sendResponse: (msg: WsMessage) => void,
  code: 'INVALID_REQUEST' | 'NOT_FOUND' | 'EXTENSION_OFFLINE',
  message: string,
): void {
  console.error('[CodeViewer][annotation]', `${requestType}.error`, { requestId, code, message })
  sendResponse(createMessage(`${requestType}.error`, { code, message }, requestId))
}

function annotationDebug(stage: string, data: Record<string, unknown>): void {
  debugLog('annotation', stage, data)
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function normalizeWorkspaceRelativePath(requestedPath: unknown): string {
  if (typeof requestedPath !== 'string' || requestedPath.trim().length === 0) {
    throw new Error('path is required')
  }
  const normalized = requestedPath.replace(/\\/g, '/').replace(/^\.\/+/, '')
  if (path.isAbsolute(requestedPath) || path.win32.isAbsolute(requestedPath) || normalized.startsWith('/')) {
    throw new Error('path must be workspace-relative')
  }
  const segments = normalized.split('/').filter(Boolean)
  if (segments.length === 0) throw new Error('path is required')
  if (segments.some((segment) => segment === '..')) {
    throw new Error('path cannot escape the workspace')
  }
  return segments.join('/')
}

export function annotationPathFor(relativePath: string): string {
  const normalized = normalizeWorkspaceRelativePath(relativePath)
  return `${ANNOTATION_ROOT}/${normalized}`
}

export function validateAnnotationPath(
  requestedPath: unknown,
  workspaceFolder: vscode.WorkspaceFolder,
): SafeAnnotationPath {
  const relativePath = normalizeWorkspaceRelativePath(requestedPath)
  const workspaceRoot = workspaceFolder.uri.fsPath
  const sourceFsPath = path.resolve(workspaceRoot, relativePath)
  const relativeFromRoot = path.relative(workspaceRoot, sourceFsPath)
  if (relativeFromRoot.startsWith('..') || path.isAbsolute(relativeFromRoot)) {
    throw new Error('path cannot escape the workspace')
  }

  const annotationPath = annotationPathFor(relativePath)
  const annotationFsPath = path.resolve(workspaceRoot, annotationPath)
  const annotationRelativeFromRoot = path.relative(workspaceRoot, annotationFsPath)
  if (
    annotationRelativeFromRoot.startsWith('..')
    || path.isAbsolute(annotationRelativeFromRoot)
    || !annotationPath.startsWith(`${ANNOTATION_ROOT}/`)
  ) {
    throw new Error('annotation output path is invalid')
  }

  return {
    relativePath,
    sourceUri: vscode.Uri.file(sourceFsPath),
    annotationPath,
    annotationUri: vscode.Uri.file(annotationFsPath),
  }
}

async function ensureSourceFileExists(sourceUri: vscode.Uri): Promise<void> {
  let stat: vscode.FileStat
  try {
    stat = await vscode.workspace.fs.stat(sourceUri)
  } catch {
    throw new Error('Source file not found')
  }
  if (stat.type !== vscode.FileType.File) {
    throw new Error('Source path is not a file')
  }
}

async function ensureAnnotationParent(annotationUri: vscode.Uri): Promise<void> {
  const parentFsPath = path.dirname(annotationUri.fsPath)
  await vscode.workspace.fs.createDirectory(vscode.Uri.file(parentFsPath))
}

function readAnnotationConfig(): {
  command: string
  stateRoot?: string
  spawnProfile: string
} {
  const config = vscode.workspace.getConfiguration('codeViewer')
  const command = config.get<string>('tmuxAdapterCommand', 'tmux-adapter').trim() || 'tmux-adapter'
  const stateRoot = config.get<string>('tmuxAdapterStateRoot', '').trim() || undefined
  const spawnProfile = config.get<string>('annotationSpawnProfile', 'code-viewer-codex-annotation').trim()
    || 'code-viewer-codex-annotation'
  return { command, stateRoot, spawnProfile }
}

function buildAnnotationPrompt(
  workspaceRoot: string,
  relativePath: string,
  annotationPath: string,
  force: boolean,
): string {
  return [
    'You are generating a Code Viewer annotation artifact.',
    '',
    `Workspace: ${workspaceRoot}`,
    `Source file: ${relativePath}`,
    `Output file: ${annotationPath}`,
    '',
    'Task:',
    '- Read the source file.',
    '- Copy the source file into the output file and add deep syntax/API comments inline.',
    '- Preserve the source language and original file extension so Code Viewer syntax highlighting still works.',
    '- Use comment syntax that is valid for the source language.',
    '',
    'Annotation goal:',
    '- This artifact is a syntax-first reading aid, not a summary and not a code review.',
    '- Priority 1: explain language syntax, standard-library APIs, framework/library APIs, object shapes, method return values, and testing/mocking mechanics.',
    '- Priority 2: explain the code intent, data flow, contracts, edge cases, and failure modes after the syntax/API layer is clear.',
    '- The reader should not need to separately look up common syntax, API behavior, or library/test helper meaning while reading this file.',
    '',
    'Commenting rules:',
    '- Add many comments; comments being longer than the original code is acceptable.',
    '- Prefer many short nearby comments over a few long summary comments.',
    '- For dense logic or tests, aim for a comment every 1-3 source lines.',
    '- For multi-line object literals, argument lists, arrays, dicts, config blocks, or test fixtures, add comments before important fields or field groups; do not leave the whole literal as unexplained data.',
    '- Explain every import and every external API on first meaningful use.',
    '- Explain non-obvious language constructs: type annotations, generics, decorators, context managers, async/await, destructuring, default/optional parameters, closures, callbacks, assertions, fixtures, mocks, and monkey patches.',
    '- For every assertion, explain what contract it protects and what bug/regression would be caught if it failed.',
    '- For every Mock, patch, fake client, fixture, tempfile, Path, JSON parse/stringify, subprocess, CLI parser, or WebSocket/API call, explain the concrete API behavior being used.',
    '- For tests, explain what is mocked, what remains real, what behavior is isolated, and what contract each assertion protects.',
    '- Use separate comment lines immediately above the relevant line or block by default.',
    '- Use trailing inline comments only for very short notes that keep the whole line readable on mobile; do not put long explanations after import lines, field declarations, function calls, or return fields.',
    '- Avoid vague summary-only comments such as "test register works"; explain the syntax/API mechanics and why the line is written that way.',
    '- Do not add generic filler comments to satisfy density checks. Bad examples: "auto note", "continuous code section", "line-by-line details below", "complete source ends here".',
    '- Use dense Traditional Chinese comments; keep API names, library names, and technical terms in English when clearer.',
    '- If behavior is inferred rather than directly visible from this file, label it as "Inference:" in the comment.',
    '- Preserve the original code order and behavior; do not remove source code.',
    '- Prefer separate comment lines above code over long trailing comments, because the artifact should be easy to scan on mobile.',
    '- Keep inserted comments indented with the nearby code they explain; comments inside multi-line calls, arrays, dicts, or object literals should visually attach to the nearby field/group.',
    '- The annotated artifact should remain syntactically valid source whenever the language supports comments without changing behavior.',
    '',
    'Generation cadence:',
    '- Annotate as you copy the source; do not create a sparse draft and then spend many repair passes filling gaps.',
    '- Use a steady first-pass cadence: for imports, function signatures, branching logic, external API calls, mocks/patches, assertions, and multi-line config/object literals, add nearby comments immediately.',
    '- For TypeScript interfaces/types, Python dataclasses/classes, CLI argument arrays, JSON parsing, subprocess calls, and error normalization, add comments near each field group and contract boundary during the first pass.',
    '- For simple repeated literal fields, group adjacent fields and explain the group once, then explain only fields whose semantics differ.',
    '- Aim for no long unexplained meaningful block, but do not run a mechanical density-lint loop.',
    '- If you notice a sparse important block while writing, add concrete comments immediately before moving on.',
    '- Each inserted comment must explain concrete nearby syntax, symbols, fields, literals, APIs, object shapes, or contracts.',
    '',
    'Short final check before DONE:',
    '- Verify the output file exists, preserves source order, and includes the end of the source file.',
    '- Verify important middle and tail sections received useful comments, not only imports and the first functions.',
    '- Verify there are no generic filler comments, no literal "\\n" artifacts inside comments, and no Markdown fences.',
    '- When practical, verify the annotated artifact remains syntactically valid source.',
    '',
    'Writing strategy:',
    '- Complete this as one annotation task for the whole source file; do not ask the user to split the file.',
    '- Avoid one huge heredoc or one huge tool-call argument for the entire annotated file.',
    '- For medium or large files, create/truncate the output file first, then append the annotated content in small ordered chunks.',
    '- After each append chunk, continue from the next source line until the whole file has been copied and annotated.',
    '- If a chunk write fails because the generated command is too large or malformed, retry with a smaller chunk instead of stopping.',
    '- Before replying DONE, verify the output file exists, preserves the original source order, and includes the end of the source file.',
    '',
    'Boundaries:',
    '- Do not wrap the output in Markdown fences.',
    '- Do not modify the source file.',
    '- Do not modify files outside .codeviewer/annotated.',
    force ? '- Overwrite the output file if it already exists.' : '- Reuse the existing output file only if it is already complete.',
    '- When done, reply with DONE and the output path.',
  ].join('\n')
}

export async function handleAnnotationGenerate(
  msg: WsMessage,
  sendResponse: (msg: WsMessage) => void,
): Promise<void> {
  const requestId = msg.id
  const startedAt = Date.now()
  const payload = msg.payload as AnnotationGeneratePayload
  annotationDebug('generate.received', {
    requestId,
    path: payload?.path,
    force: payload?.force === true,
  })
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
  if (!workspaceFolder) {
    sendError(msg.type, msg.id, sendResponse, 'NOT_FOUND', 'No workspace open')
    return
  }

  let safePath: SafeAnnotationPath
  try {
    safePath = validateAnnotationPath(payload.path, workspaceFolder)
    await ensureSourceFileExists(safePath.sourceUri)
    await ensureAnnotationParent(safePath.annotationUri)
    annotationDebug('generate.validated', {
      requestId,
      workspaceRoot: workspaceFolder.uri.fsPath,
      path: safePath.relativePath,
      annotationPath: safePath.annotationPath,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[CodeViewer][annotation] generate.validate.failed', {
      requestId,
      path: payload?.path,
      message,
    })
    sendError(msg.type, msg.id, sendResponse, message.includes('not found') ? 'NOT_FOUND' : 'INVALID_REQUEST', message)
    return
  }

  try {
    const config = readAnnotationConfig()
    annotationDebug('generate.ensure-target.start', {
      requestId,
      command: config.command,
      stateRoot: config.stateRoot ?? null,
      spawnProfile: config.spawnProfile,
      cwd: workspaceFolder.uri.fsPath,
    })
    const target = await ensureTarget({
      command: config.command,
      stateRoot: config.stateRoot,
      spawnProfile: config.spawnProfile,
      cwd: workspaceFolder.uri.fsPath,
    })
    annotationDebug('generate.ensure-target.done', {
      requestId,
      target,
      elapsedMs: Date.now() - startedAt,
    })
    if (target.acquired === 'spawned') {
      annotationDebug('generate.spawn-ready-delay.start', {
        requestId,
        delayMs: SPAWN_READY_DELAY_MS,
        bindingId: target.bindingId,
      })
      await delay(SPAWN_READY_DELAY_MS)
      annotationDebug('generate.spawn-ready-delay.done', {
        requestId,
        bindingId: target.bindingId,
        elapsedMs: Date.now() - startedAt,
      })
    }
    annotationDebug('generate.send.start', {
      requestId,
      bindingId: target.bindingId,
      annotationPath: safePath.annotationPath,
    })
    await sendMessage({
      command: config.command,
      stateRoot: config.stateRoot,
      bindingId: target.bindingId,
      message: buildAnnotationPrompt(
        workspaceFolder.uri.fsPath,
        safePath.relativePath,
        safePath.annotationPath,
        payload.force === true,
      ),
    })
    annotationDebug('generate.send.done', {
      requestId,
      bindingId: target.bindingId,
      elapsedMs: Date.now() - startedAt,
    })
    sendResponse(createMessage('annotation.generate.result', {
      path: safePath.relativePath,
      annotationPath: safePath.annotationPath,
      target,
      submitted: true,
    }, msg.id))
    annotationDebug('generate.response.sent', {
      requestId,
      path: safePath.relativePath,
      annotationPath: safePath.annotationPath,
      elapsedMs: Date.now() - startedAt,
    })
  } catch (error) {
    console.error('[CodeViewer][annotation] generate.adapter.failed', {
      requestId,
      path: safePath.relativePath,
      annotationPath: safePath.annotationPath,
      message: error instanceof Error ? error.message : String(error),
    })
    sendError(
      msg.type,
      msg.id,
      sendResponse,
      'INVALID_REQUEST',
      error instanceof Error ? error.message : String(error),
    )
  }
}

export async function handleAnnotationStatus(
  msg: WsMessage,
  sendResponse: (msg: WsMessage) => void,
): Promise<void> {
  const requestId = msg.id
  const payload = msg.payload as AnnotationStatusPayload
  annotationDebug('status.received', { requestId, path: payload?.path })
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
  if (!workspaceFolder) {
    sendError(msg.type, msg.id, sendResponse, 'NOT_FOUND', 'No workspace open')
    return
  }

  let safePath: SafeAnnotationPath
  try {
    safePath = validateAnnotationPath(payload.path, workspaceFolder)
  } catch (error) {
    console.error('[CodeViewer][annotation] status.validate.failed', {
      requestId,
      path: payload?.path,
      message: error instanceof Error ? error.message : String(error),
    })
    sendError(
      msg.type,
      msg.id,
      sendResponse,
      'INVALID_REQUEST',
      error instanceof Error ? error.message : String(error),
    )
    return
  }

  try {
    const stat = await vscode.workspace.fs.stat(safePath.annotationUri)
    annotationDebug('status.result', {
      requestId,
      path: safePath.relativePath,
      annotationPath: safePath.annotationPath,
      exists: stat.type === vscode.FileType.File,
      size: stat.size,
      mtime: stat.mtime,
    })
    sendResponse(createMessage('annotation.status.result', {
      path: safePath.relativePath,
      annotationPath: safePath.annotationPath,
      exists: stat.type === vscode.FileType.File,
      updatedAt: stat.mtime,
    }, msg.id))
  } catch {
    annotationDebug('status.result', {
      requestId,
      path: safePath.relativePath,
      annotationPath: safePath.annotationPath,
      exists: false,
    })
    sendResponse(createMessage('annotation.status.result', {
      path: safePath.relativePath,
      annotationPath: safePath.annotationPath,
      exists: false,
    }, msg.id))
  }
}
