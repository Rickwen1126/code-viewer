import * as os from 'os'
import * as path from 'path'
import * as vscode from 'vscode'
import type {
  AnnotationArtifactState,
  AnnotationArtifactValidation,
  AnnotationGeneratePayload,
  AnnotationStatusPayload,
  RunEvent,
  WsMessage,
} from '@code-viewer/shared'
import { createMessage } from '../ws/client'
import { debugLog } from '../utils/debug'
import { ensureTarget, sendMessage } from './tmux-adapter-client'

const ANNOTATION_ROOT = '.codeviewer/annotated'
const ANNOTATION_RUN_ROOT = '.codeviewer/annotation-runs'
const SPAWN_READY_DELAY_MS = 2500
const DEFAULT_TMUX_ADAPTER_STATE_ROOT = path.join(os.homedir(), '.local', 'state', 'tmux-adapter-code-viewer')
const EMPTY_VALIDATION: AnnotationArtifactValidation = { ok: false, diagnostics: [] }

interface SafeAnnotationPath {
  relativePath: string
  sourceUri: vscode.Uri
  annotationPath: string
  annotationUri: vscode.Uri
}

interface AnnotationGenerationState {
  generationId: string
  requestId: string
  relativePath: string
  annotationPath: string
  runLogPath: string
  submittedAt: number
  status: Extract<AnnotationArtifactState, 'pending' | 'ready' | 'invalid'>
  target?: Awaited<ReturnType<typeof ensureTarget>>
  validation?: AnnotationArtifactValidation
}

interface AnnotationStatusSnapshot {
  path: string
  annotationPath: string
  runLogPath?: string
  exists: boolean
  ready: boolean
  state: AnnotationArtifactState
  generationId?: string
  updatedAt?: number
  validation?: AnnotationArtifactValidation
}

const generationStates = new Map<string, AnnotationGenerationState>()

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

function safeRunSegment(value: string): string {
  const segment = value.trim().replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120)
  return segment.length > 0 ? segment : `run-${Date.now()}`
}

export function annotationRunLogPathFor(generationId: string): string {
  return `${ANNOTATION_RUN_ROOT}/${safeRunSegment(generationId)}/run.jsonl`
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function readText(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('utf8')
}

function countLines(text: string): number {
  if (text.length === 0) return 0
  return text.split(/\r?\n/).length
}

function lastMeaningfulLine(text: string): string | undefined {
  const lines = text.split(/\r?\n/)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const trimmed = lines[index].trim()
    if (trimmed.length > 0) return trimmed
  }
  return undefined
}

function commentPatternFor(relativePath: string): RegExp | undefined {
  const ext = path.extname(relativePath).toLowerCase()
  if (['.ts', '.tsx', '.js', '.jsx', '.css', '.scss', '.java', '.go', '.rs', '.c', '.cpp', '.h', '.hpp'].includes(ext)) {
    return /^\s*(\/\/|\/\*)/m
  }
  if (['.py', '.rb', '.sh', '.bash', '.zsh', '.yml', '.yaml', '.toml'].includes(ext)) {
    return /^\s*#/m
  }
  return undefined
}

export function validateAnnotationArtifactText(
  sourceText: string,
  artifactText: string,
  relativePath: string,
  stat?: { size?: number; updatedAt?: number },
): AnnotationArtifactValidation {
  const diagnostics: string[] = []
  const sourceLineCount = countLines(sourceText)
  const artifactLineCount = countLines(artifactText)
  const trimmedArtifact = artifactText.trim()

  if (trimmedArtifact.length === 0) {
    diagnostics.push('artifact is empty')
  }
  if (/```/.test(artifactText)) {
    diagnostics.push('artifact contains Markdown fences')
  }
  if (sourceLineCount > 1 && artifactLineCount < sourceLineCount) {
    diagnostics.push('artifact has fewer lines than source')
  }

  const tail = lastMeaningfulLine(sourceText)
  if (tail && !artifactText.includes(tail)) {
    diagnostics.push('artifact does not include the source tail')
  }

  const commentPattern = commentPatternFor(relativePath)
  if (commentPattern && !commentPattern.test(artifactText)) {
    diagnostics.push('artifact has no source-language comment markers')
  }

  return {
    ok: diagnostics.length === 0,
    diagnostics,
    sourceLineCount,
    artifactLineCount,
    size: stat?.size,
    updatedAt: stat?.updatedAt,
  }
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

async function appendWorkspaceJsonLine(workspaceFolder: vscode.WorkspaceFolder, relativePath: string, value: unknown): Promise<void> {
  const workspaceRoot = workspaceFolder.uri.fsPath
  const fsPath = path.resolve(workspaceRoot, relativePath)
  const relativeFromRoot = path.relative(workspaceRoot, fsPath)
  if (relativeFromRoot.startsWith('..') || path.isAbsolute(relativeFromRoot)) {
    throw new Error('run log path cannot escape the workspace')
  }

  const uri = vscode.Uri.file(fsPath)
  await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(fsPath)))

  let existing = ''
  try {
    existing = readText(await vscode.workspace.fs.readFile(uri))
  } catch {
    existing = ''
  }
  const next = `${existing}${JSON.stringify(value)}\n`
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(next))
}

async function recordAnnotationEvent(
  workspaceFolder: vscode.WorkspaceFolder,
  event: Omit<RunEvent, 'version' | 'feature' | 'timestamp'>,
): Promise<void> {
  const fullEvent: RunEvent = {
    version: 1,
    feature: 'annotation',
    timestamp: Date.now(),
    ...event,
  }
  annotationDebug('run-event', fullEvent as unknown as Record<string, unknown>)
  if (!fullEvent.runLogPath) return
  try {
    await appendWorkspaceJsonLine(workspaceFolder, fullEvent.runLogPath, fullEvent)
  } catch (error) {
    console.warn('[CodeViewer][annotation] run-log.write.failed', {
      requestId: fullEvent.requestId,
      generationId: fullEvent.generationId,
      runLogPath: fullEvent.runLogPath,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

function readAnnotationConfig(): {
  command: string
  stateRoot: string
  spawnProfile: string
} {
  const config = vscode.workspace.getConfiguration('codeViewer')
  const command = config.get<string>('tmuxAdapterCommand', 'tmux-adapter').trim() || 'tmux-adapter'
  const stateRoot = config.get<string>('tmuxAdapterStateRoot', '').trim() || DEFAULT_TMUX_ADAPTER_STATE_ROOT
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
    'Internal checklist workflow:',
    '- Before writing the output, scan the whole source file and build an internal checklist of annotation items. Do not write this checklist into the annotated source file.',
    '- Every checklist item must have a concrete source line range and a concrete code surface, such as imports, type/interface declarations, constants/config, a function, a class/method, a test case, or a block inside a long function.',
    '- If a function, class, object literal, test case, or branch block is longer than about 80 source lines, split it into smaller checklist items with their own line ranges.',
    '- Treat the middle third and final third of the file as first-class checklist coverage. They are not leftover cleanup after the first functions are done.',
    '- Do not mentally mark a checklist item complete until its exact line range has concrete nearby comments for meaningful syntax, APIs, fields, branches, assertions, and contracts.',
    '- Work through checklist items in source order so the output file grows in the same order as the source.',
    '',
    'Generation cadence:',
    '- Annotate as you copy the source; do not create a sparse draft and then spend many repair passes filling gaps.',
    '- Use a steady first-pass cadence: for imports, function signatures, branching logic, external API calls, mocks/patches, assertions, and multi-line config/object literals, add nearby comments immediately.',
    '- For TypeScript interfaces/types, Python dataclasses/classes, CLI argument arrays, JSON parsing, subprocess calls, and error normalization, add comments near each field group and contract boundary during the first pass.',
    '- For simple repeated literal fields, group only a small adjacent field group and explain that group concretely; do not use grouping as a reason to skip later functions, later tests, branches, or the tail of the file.',
    '- Aim for no long unexplained meaningful block, but do not run a mechanical density-lint loop.',
    '- If you notice a sparse important block while writing, add concrete comments immediately before moving on.',
    '- Each inserted comment must explain concrete nearby syntax, symbols, fields, literals, APIs, object shapes, or contracts.',
    '- The final 30% of the source should not be noticeably sparser than the first 30%. If you are running low on space, reduce verbosity evenly instead of dropping tail coverage.',
    '',
    'Short final check before DONE:',
    '- Verify the output file exists, preserves source order, and includes the end of the source file.',
    '- Re-scan your internal checklist item by item; every item must have been copied and annotated before you reply DONE.',
    '- Verify important middle and tail sections received useful comments, not only imports and the first functions.',
    '- Verify there are no generic filler comments and no Markdown fences.',
    '- Do not use literal escaped newline strings such as "\\n" as formatting leftovers inside comments; mentioning real source/API strings such as "\\n" is allowed when the nearby code actually uses newline framing.',
    '- When practical, verify the annotated artifact remains syntactically valid source.',
    '',
    'Writing strategy:',
    '- Complete this as one annotation task for the whole source file; do not ask the user to split the file.',
    '- Avoid one huge heredoc or one huge tool-call argument for the entire annotated file.',
    '- For medium or large files, create/truncate the output file first, then append annotated checklist items or small ordered checklist groups.',
    '- After each append chunk, continue from the next checklist item and source line until the whole file has been copied and annotated.',
    '- Never jump ahead to the end by summarizing unprocessed ranges. If a later range is repetitive, still copy it and add concrete nearby comments for that range.',
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

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function normalizeOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

async function getAnnotationStatusSnapshot(
  safePath: SafeAnnotationPath,
  generationId?: string,
  minUpdatedAt?: number,
): Promise<AnnotationStatusSnapshot> {
  const trackedGeneration = generationStates.get(safePath.relativePath)
  const effectiveGenerationId = generationId ?? trackedGeneration?.generationId
  const runLogPath = effectiveGenerationId ? annotationRunLogPathFor(effectiveGenerationId) : undefined

  let stat: vscode.FileStat
  try {
    stat = await vscode.workspace.fs.stat(safePath.annotationUri)
  } catch {
    return {
      path: safePath.relativePath,
      annotationPath: safePath.annotationPath,
      runLogPath,
      exists: false,
      ready: false,
      state: 'missing',
      generationId: effectiveGenerationId,
      validation: {
        ...EMPTY_VALIDATION,
        diagnostics: ['artifact missing'],
      },
    }
  }

  if (stat.type !== vscode.FileType.File) {
    return {
      path: safePath.relativePath,
      annotationPath: safePath.annotationPath,
      runLogPath,
      exists: false,
      ready: false,
      state: 'invalid',
      generationId: effectiveGenerationId,
      updatedAt: stat.mtime,
      validation: {
        ok: false,
        diagnostics: ['annotation path is not a file'],
        size: stat.size,
        updatedAt: stat.mtime,
      },
    }
  }

  if (typeof minUpdatedAt === 'number' && stat.mtime < minUpdatedAt) {
    return {
      path: safePath.relativePath,
      annotationPath: safePath.annotationPath,
      runLogPath,
      exists: true,
      ready: false,
      state: 'pending',
      generationId: effectiveGenerationId,
      updatedAt: stat.mtime,
      validation: {
        ok: false,
        diagnostics: ['artifact predates requested generation'],
        size: stat.size,
        updatedAt: stat.mtime,
      },
    }
  }

  const [sourceBytes, artifactBytes] = await Promise.all([
    vscode.workspace.fs.readFile(safePath.sourceUri),
    vscode.workspace.fs.readFile(safePath.annotationUri),
  ])
  const validation = validateAnnotationArtifactText(
    readText(sourceBytes),
    readText(artifactBytes),
    safePath.relativePath,
    { size: stat.size, updatedAt: stat.mtime },
  )
  return {
    path: safePath.relativePath,
    annotationPath: safePath.annotationPath,
    runLogPath,
    exists: true,
    ready: validation.ok,
    state: validation.ok ? 'ready' : 'invalid',
    generationId: effectiveGenerationId,
    updatedAt: stat.mtime,
    validation,
  }
}

export async function handleAnnotationGenerate(
  msg: WsMessage,
  sendResponse: (msg: WsMessage) => void,
): Promise<void> {
  const requestId = msg.id
  const startedAt = Date.now()
  const payload = msg.payload as AnnotationGeneratePayload
  const generationId = normalizeOptionalString(payload?.generationId) ?? requestId
  const runLogPath = annotationRunLogPathFor(generationId)
  annotationDebug('generate.received', {
    requestId,
    generationId,
    runLogPath,
    path: payload?.path,
    force: payload?.force === true,
  })
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
  if (!workspaceFolder) {
    sendError(msg.type, msg.id, sendResponse, 'NOT_FOUND', 'No workspace open')
    return
  }

  await recordAnnotationEvent(workspaceFolder, {
    phase: 'extension.annotation.generate.received',
    level: 'info',
    requestId,
    generationId,
    runLogPath,
    path: typeof payload?.path === 'string' ? payload.path : undefined,
    elapsedMs: Date.now() - startedAt,
    data: { force: payload?.force === true },
  })

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
      runLogPath,
    })
    await recordAnnotationEvent(workspaceFolder, {
      phase: 'extension.annotation.generate.validated',
      level: 'info',
      requestId,
      generationId,
      path: safePath.relativePath,
      artifactPath: safePath.annotationPath,
      runLogPath,
      workspaceId: workspaceFolder.name,
      elapsedMs: Date.now() - startedAt,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[CodeViewer][annotation] generate.validate.failed', {
      requestId,
      generationId,
      path: payload?.path,
      message,
    })
    await recordAnnotationEvent(workspaceFolder, {
      phase: 'extension.annotation.generate.validate.failed',
      level: 'error',
      requestId,
      generationId,
      path: typeof payload?.path === 'string' ? payload.path : undefined,
      runLogPath,
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? { message, stack: error.stack } : { message },
    })
    sendError(msg.type, msg.id, sendResponse, message.includes('not found') ? 'NOT_FOUND' : 'INVALID_REQUEST', message)
    return
  }

  try {
    const config = readAnnotationConfig()
    annotationDebug('generate.ensure-target.start', {
      requestId,
      generationId,
      command: config.command,
      stateRoot: config.stateRoot ?? null,
      spawnProfile: config.spawnProfile,
      cwd: workspaceFolder.uri.fsPath,
    })
    await recordAnnotationEvent(workspaceFolder, {
      phase: 'tmux.ensureTarget.start',
      level: 'info',
      requestId,
      generationId,
      path: safePath.relativePath,
      artifactPath: safePath.annotationPath,
      runLogPath,
      elapsedMs: Date.now() - startedAt,
      data: {
        command: config.command,
        stateRoot: config.stateRoot,
        spawnProfile: config.spawnProfile,
      },
    })
    const target = await ensureTarget({
      command: config.command,
      stateRoot: config.stateRoot,
      spawnProfile: config.spawnProfile,
      cwd: workspaceFolder.uri.fsPath,
    })
    annotationDebug('generate.ensure-target.done', {
      requestId,
      generationId,
      target,
      elapsedMs: Date.now() - startedAt,
    })
    await recordAnnotationEvent(workspaceFolder, {
      phase: 'tmux.ensureTarget.done',
      level: 'info',
      requestId,
      generationId,
      path: safePath.relativePath,
      artifactPath: safePath.annotationPath,
      runLogPath,
      target,
      elapsedMs: Date.now() - startedAt,
    })
    if (target.acquired === 'spawned') {
      annotationDebug('generate.spawn-ready-delay.start', {
        requestId,
        generationId,
        delayMs: SPAWN_READY_DELAY_MS,
        bindingId: target.bindingId,
      })
      await delay(SPAWN_READY_DELAY_MS)
      annotationDebug('generate.spawn-ready-delay.done', {
        requestId,
        generationId,
        bindingId: target.bindingId,
        elapsedMs: Date.now() - startedAt,
      })
      await recordAnnotationEvent(workspaceFolder, {
        phase: 'tmux.spawnReadyDelay.done',
        level: 'debug',
        requestId,
        generationId,
        path: safePath.relativePath,
        artifactPath: safePath.annotationPath,
        runLogPath,
        target,
        elapsedMs: Date.now() - startedAt,
        data: { delayMs: SPAWN_READY_DELAY_MS },
      })
    }
    const submittedAt = Date.now()
    generationStates.set(safePath.relativePath, {
      generationId,
      requestId,
      relativePath: safePath.relativePath,
      annotationPath: safePath.annotationPath,
      runLogPath,
      submittedAt,
      status: 'pending',
      target,
    })
    annotationDebug('generate.send.start', {
      requestId,
      generationId,
      submittedAt,
      bindingId: target.bindingId,
      annotationPath: safePath.annotationPath,
    })
    await recordAnnotationEvent(workspaceFolder, {
      phase: 'tmux.send.start',
      level: 'info',
      requestId,
      generationId,
      path: safePath.relativePath,
      artifactPath: safePath.annotationPath,
      runLogPath,
      target,
      elapsedMs: Date.now() - startedAt,
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
      generationId,
      bindingId: target.bindingId,
      elapsedMs: Date.now() - startedAt,
    })
    await recordAnnotationEvent(workspaceFolder, {
      phase: 'tmux.send.done',
      level: 'info',
      requestId,
      generationId,
      path: safePath.relativePath,
      artifactPath: safePath.annotationPath,
      runLogPath,
      target,
      elapsedMs: Date.now() - startedAt,
    })
    sendResponse(createMessage('annotation.generate.result', {
      path: safePath.relativePath,
      annotationPath: safePath.annotationPath,
      runLogPath,
      generationId,
      submittedAt,
      target,
      submitted: true,
    }, msg.id))
    annotationDebug('generate.response.sent', {
      requestId,
      generationId,
      path: safePath.relativePath,
      annotationPath: safePath.annotationPath,
      elapsedMs: Date.now() - startedAt,
    })
  } catch (error) {
    console.error('[CodeViewer][annotation] generate.adapter.failed', {
      requestId,
      generationId,
      path: safePath.relativePath,
      annotationPath: safePath.annotationPath,
      message: error instanceof Error ? error.message : String(error),
    })
    await recordAnnotationEvent(workspaceFolder, {
      phase: 'extension.annotation.generate.adapter.failed',
      level: 'error',
      requestId,
      generationId,
      path: safePath.relativePath,
      artifactPath: safePath.annotationPath,
      runLogPath,
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error
        ? { message: error.message, stack: error.stack }
        : { message: String(error) },
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
  const startedAt = Date.now()
  const payload = msg.payload as AnnotationStatusPayload
  const generationId = normalizeOptionalString(payload?.generationId)
  const minUpdatedAt = normalizeOptionalNumber(payload?.minUpdatedAt)
  annotationDebug('status.received', {
    requestId,
    generationId,
    minUpdatedAt: minUpdatedAt ?? null,
    path: payload?.path,
  })
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
      generationId,
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
    const snapshot = await getAnnotationStatusSnapshot(safePath, generationId, minUpdatedAt)
    const trackedGeneration = generationStates.get(safePath.relativePath)
    if (snapshot.generationId && trackedGeneration?.generationId === snapshot.generationId) {
      trackedGeneration.status = snapshot.ready ? 'ready' : snapshot.state === 'invalid' ? 'invalid' : 'pending'
      trackedGeneration.validation = snapshot.validation
    }
    annotationDebug('status.result', {
      requestId,
      generationId: snapshot.generationId ?? null,
      path: safePath.relativePath,
      annotationPath: safePath.annotationPath,
      exists: snapshot.exists,
      ready: snapshot.ready,
      state: snapshot.state,
      updatedAt: snapshot.updatedAt ?? null,
      diagnostics: snapshot.validation?.diagnostics ?? [],
    })
    if (snapshot.runLogPath) {
      await recordAnnotationEvent(workspaceFolder, {
        phase: `extension.annotation.status.${snapshot.state}`,
        level: snapshot.ready ? 'info' : snapshot.state === 'invalid' ? 'warn' : 'debug',
        requestId,
        generationId: snapshot.generationId,
        path: safePath.relativePath,
        artifactPath: safePath.annotationPath,
        runLogPath: snapshot.runLogPath,
        elapsedMs: Date.now() - startedAt,
        diagnostics: snapshot.validation?.diagnostics ?? [],
        data: {
          exists: snapshot.exists,
          ready: snapshot.ready,
          updatedAt: snapshot.updatedAt ?? null,
        },
      })
    }
    sendResponse(createMessage('annotation.status.result', snapshot, msg.id))
  } catch (error) {
    console.error('[CodeViewer][annotation] status.check.failed', {
      requestId,
      generationId,
      path: safePath.relativePath,
      annotationPath: safePath.annotationPath,
      message: error instanceof Error ? error.message : String(error),
    })
    const statusRunLogPath = generationId ? annotationRunLogPathFor(generationId) : undefined
    if (statusRunLogPath) {
      await recordAnnotationEvent(workspaceFolder, {
        phase: 'extension.annotation.status.failed',
        level: 'error',
        requestId,
        generationId,
        path: safePath.relativePath,
        artifactPath: safePath.annotationPath,
        runLogPath: statusRunLogPath,
        elapsedMs: Date.now() - startedAt,
        error: error instanceof Error
          ? { message: error.message, stack: error.stack }
          : { message: String(error) },
      })
    }
    sendError(
      msg.type,
      msg.id,
      sendResponse,
      'INVALID_REQUEST',
      error instanceof Error ? error.message : String(error),
    )
  }
}
