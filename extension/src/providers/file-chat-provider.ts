import * as os from 'os'
import * as path from 'path'
import * as vscode from 'vscode'
import type {
  FileChatMarkedLine,
  FileChatSendPayload,
  FileChatStatusPayload,
  RunEvent,
  WsMessage,
} from '@code-viewer/shared'
import { createMessage } from '../ws/client'
import { debugLog } from '../utils/debug'
import { ensureTarget, sendMessage } from './tmux-adapter-client'

const CHAT_ROOT = '.codeviewer/chat-runs/current'
const CHAT_THREAD_ID = 'current'
const CHAT_MANIFEST_PATH = `${CHAT_ROOT}/manifest.json`
const CHAT_THREAD_PATH = `${CHAT_ROOT}/thread.md`
const CHAT_RUN_LOG_PATH = `${CHAT_ROOT}/run.jsonl`
const DEFAULT_TMUX_ADAPTER_STATE_ROOT = path.join(os.homedir(), '.local', 'state', 'tmux-adapter-code-viewer')
const MAX_SOURCE_CHARS = 80_000
const SPAWN_READY_DELAY_MS = 2500

interface SafeFileChatPath {
  relativePath: string
  sourceUri: vscode.Uri
}

interface FileChatStatusSnapshot {
  path: string
  requestId: string
  threadId: string
  manifestPath: string
  threadPath: string
  runLogPath: string
  ready: boolean
  state: 'pending' | 'ready' | 'invalid' | 'failed' | 'missing'
  latestAssistantMessage?: string
  diagnostics?: string[]
  updatedAt?: number
}

function fileChatDebug(stage: string, data: Record<string, unknown>): void {
  debugLog('fileChat', stage, data)
}

function readText(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('utf8')
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

export function validateFileChatPath(
  requestedPath: unknown,
  workspaceFolder: vscode.WorkspaceFolder,
): SafeFileChatPath {
  const relativePath = normalizeWorkspaceRelativePath(requestedPath)
  const workspaceRoot = workspaceFolder.uri.fsPath
  const sourceFsPath = path.resolve(workspaceRoot, relativePath)
  const relativeFromRoot = path.relative(workspaceRoot, sourceFsPath)
  if (relativeFromRoot.startsWith('..') || path.isAbsolute(relativeFromRoot)) {
    throw new Error('path cannot escape the workspace')
  }

  return {
    relativePath,
    sourceUri: vscode.Uri.file(sourceFsPath),
  }
}

export function fileChatPaths(): {
  threadId: string
  manifestPath: string
  threadPath: string
  runLogPath: string
} {
  return {
    threadId: CHAT_THREAD_ID,
    manifestPath: CHAT_MANIFEST_PATH,
    threadPath: CHAT_THREAD_PATH,
    runLogPath: CHAT_RUN_LOG_PATH,
  }
}

function normalizeQuestion(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('question is required')
  }
  return value.trim()
}

function normalizeMarkedLines(value: unknown): FileChatMarkedLine[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const candidate = item as { line?: unknown; content?: unknown }
      if (typeof candidate.line !== 'number' || !Number.isInteger(candidate.line) || candidate.line < 1) return null
      if (typeof candidate.content !== 'string') return null
      return { line: candidate.line, content: candidate.content }
    })
    .filter((item): item is FileChatMarkedLine => item !== null)
    .slice(0, 100)
}

export function readFileChatConfig(): {
  command: string
  stateRoot: string
  spawnProfile: string
} {
  const config = vscode.workspace.getConfiguration('codeViewer')
  const command = config.get<string>('tmuxAdapterCommand', 'tmux-adapter').trim() || 'tmux-adapter'
  const stateRoot = config.get<string>('tmuxAdapterStateRoot', '').trim() || DEFAULT_TMUX_ADAPTER_STATE_ROOT
  const spawnProfile = config.get<string>('fileChatSpawnProfile', 'code-viewer-codex-file-chat').trim()
    || 'code-viewer-codex-file-chat'
  return { command, stateRoot, spawnProfile }
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

async function ensureChatDirectory(workspaceFolder: vscode.WorkspaceFolder): Promise<void> {
  await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, CHAT_ROOT)))
}

async function readWorkspaceText(workspaceFolder: vscode.WorkspaceFolder, relativePath: string): Promise<string | null> {
  try {
    return readText(await vscode.workspace.fs.readFile(vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, relativePath))))
  } catch {
    return null
  }
}

async function writeWorkspaceText(workspaceFolder: vscode.WorkspaceFolder, relativePath: string, text: string): Promise<void> {
  const workspaceRoot = workspaceFolder.uri.fsPath
  const fsPath = path.resolve(workspaceRoot, relativePath)
  const relativeFromRoot = path.relative(workspaceRoot, fsPath)
  if (relativeFromRoot.startsWith('..') || path.isAbsolute(relativeFromRoot)) {
    throw new Error('chat artifact path cannot escape the workspace')
  }
  await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(fsPath)))
  await vscode.workspace.fs.writeFile(vscode.Uri.file(fsPath), new TextEncoder().encode(text))
}

async function appendWorkspaceText(workspaceFolder: vscode.WorkspaceFolder, relativePath: string, text: string): Promise<void> {
  const existing = await readWorkspaceText(workspaceFolder, relativePath)
  await writeWorkspaceText(workspaceFolder, relativePath, `${existing ?? ''}${text}`)
}

async function recordFileChatEvent(
  workspaceFolder: vscode.WorkspaceFolder,
  event: Omit<RunEvent, 'version' | 'feature' | 'timestamp' | 'runLogPath' | 'threadPath' | 'threadId'>,
): Promise<void> {
  const fullEvent: RunEvent = {
    version: 1,
    feature: 'fileChat',
    timestamp: Date.now(),
    threadId: CHAT_THREAD_ID,
    threadPath: CHAT_THREAD_PATH,
    runLogPath: CHAT_RUN_LOG_PATH,
    ...event,
  }
  fileChatDebug('run-event', fullEvent as unknown as Record<string, unknown>)
  try {
    await appendWorkspaceText(workspaceFolder, CHAT_RUN_LOG_PATH, `${JSON.stringify(fullEvent)}\n`)
  } catch (error) {
    console.warn('[CodeViewer][fileChat] run-log.write.failed', {
      requestId: fullEvent.requestId,
      path: fullEvent.path,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function formatMarkedLines(markedLines: FileChatMarkedLine[]): string {
  if (markedLines.length === 0) return '(none)'
  return markedLines
    .map((line) => `L${line.line}: ${line.content}`)
    .join('\n')
}

function userBlock(requestId: string, relativePath: string, question: string, markedLines: FileChatMarkedLine[]): string {
  return [
    '',
    `## User requestId=${requestId}`,
    '',
    `File: ${relativePath}`,
    '',
    'Marked lines:',
    '',
    '```text',
    formatMarkedLines(markedLines),
    '```',
    '',
    'Question:',
    '',
    question,
    '',
  ].join('\n')
}

export function extractAssistantMessage(threadText: string, requestId: string): string | undefined {
  const headerPattern = new RegExp(`^## Assistant requestId=${requestId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm')
  const match = headerPattern.exec(threadText)
  if (!match) return undefined
  const bodyStart = match.index + match[0].length
  const rest = threadText.slice(bodyStart)
  const nextHeader = /\n## (User|Assistant) requestId=/.exec(rest)
  const body = (nextHeader ? rest.slice(0, nextHeader.index) : rest).trim()
  return body.length > 0 ? body : undefined
}

export function buildFileChatPrompt(params: {
  workspaceRoot: string
  relativePath: string
  requestId: string
  question: string
  sourceText: string
  markedLines: FileChatMarkedLine[]
}): string {
  return [
    'You are answering an ad-hoc Code Viewer question about one source file.',
    '',
    `Workspace: ${params.workspaceRoot}`,
    `Source file: ${params.relativePath}`,
    `Thread file: ${CHAT_THREAD_PATH}`,
    `Manifest file: ${CHAT_MANIFEST_PATH}`,
    `Run log: ${CHAT_RUN_LOG_PATH}`,
    `Request id: ${params.requestId}`,
    '',
    'Rules:',
    '- Answer in Traditional Chinese.',
    '- Help a junior engineer understand the syntax/API layer first, then the code intent.',
    '- Use the current source file content below as primary context.',
    '- Prefer concrete references to functions, types, line-level behavior, and library APIs.',
    '- If the answer needs inference beyond the file, label it as "Inference:".',
    '- Do not modify the source file.',
    '- Do not modify files outside .codeviewer/chat-runs/current/.',
    '- Append exactly one assistant block to the thread file.',
    `- Use this header exactly: ## Assistant requestId=${params.requestId}`,
    '- Do not rewrite previous user or assistant blocks.',
    '- Reply DONE with the thread path.',
    '',
    'Marked lines from the user:',
    '',
    '```text',
    formatMarkedLines(params.markedLines),
    '```',
    '',
    'User question:',
    '',
    params.question,
    '',
    'Current source file content:',
    '',
    '```text',
    params.sourceText,
    '```',
  ].join('\n')
}

async function writeManifest(workspaceFolder: vscode.WorkspaceFolder, data: {
  requestId: string
  relativePath: string
  question: string
  markedLines: FileChatMarkedLine[]
  submittedAt: number
}): Promise<void> {
  await writeWorkspaceText(workspaceFolder, CHAT_MANIFEST_PATH, `${JSON.stringify({
    version: 1,
    threadId: CHAT_THREAD_ID,
    activeRequestId: data.requestId,
    path: data.relativePath,
    question: data.question,
    markedLines: data.markedLines,
    submittedAt: data.submittedAt,
    manifestPath: CHAT_MANIFEST_PATH,
    threadPath: CHAT_THREAD_PATH,
    runLogPath: CHAT_RUN_LOG_PATH,
  }, null, 2)}\n`)
}

async function getStatusSnapshot(
  workspaceFolder: vscode.WorkspaceFolder,
  relativePath: string,
  requestId: string,
  minUpdatedAt?: number,
): Promise<FileChatStatusSnapshot> {
  const threadUri = vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, CHAT_THREAD_PATH))
  let stat: vscode.FileStat
  try {
    stat = await vscode.workspace.fs.stat(threadUri)
  } catch {
    return {
      path: relativePath,
      requestId,
      threadId: CHAT_THREAD_ID,
      manifestPath: CHAT_MANIFEST_PATH,
      threadPath: CHAT_THREAD_PATH,
      runLogPath: CHAT_RUN_LOG_PATH,
      ready: false,
      state: 'missing',
      diagnostics: ['thread missing'],
    }
  }

  if (typeof minUpdatedAt === 'number' && stat.mtime < minUpdatedAt) {
    return {
      path: relativePath,
      requestId,
      threadId: CHAT_THREAD_ID,
      manifestPath: CHAT_MANIFEST_PATH,
      threadPath: CHAT_THREAD_PATH,
      runLogPath: CHAT_RUN_LOG_PATH,
      ready: false,
      state: 'pending',
      updatedAt: stat.mtime,
      diagnostics: ['thread predates requested ask'],
    }
  }

  const threadText = readText(await vscode.workspace.fs.readFile(threadUri))
  const latestAssistantMessage = extractAssistantMessage(threadText, requestId)
  return {
    path: relativePath,
    requestId,
    threadId: CHAT_THREAD_ID,
    manifestPath: CHAT_MANIFEST_PATH,
    threadPath: CHAT_THREAD_PATH,
    runLogPath: CHAT_RUN_LOG_PATH,
    ready: typeof latestAssistantMessage === 'string',
    state: latestAssistantMessage ? 'ready' : 'pending',
    latestAssistantMessage,
    updatedAt: stat.mtime,
    diagnostics: latestAssistantMessage ? [] : ['assistant block missing'],
  }
}

function sendError(
  requestType: string,
  requestId: string,
  sendResponse: (msg: WsMessage) => void,
  code: 'INVALID_REQUEST' | 'NOT_FOUND',
  message: string,
): void {
  console.error('[CodeViewer][fileChat]', `${requestType}.error`, { requestId, code, message })
  sendResponse(createMessage(`${requestType}.error`, { code, message }, requestId))
}

export async function handleFileChatSend(
  msg: WsMessage,
  sendResponse: (msg: WsMessage) => void,
): Promise<void> {
  const requestId = typeof (msg.payload as FileChatSendPayload | undefined)?.requestId === 'string'
    ? ((msg.payload as FileChatSendPayload).requestId as string)
    : msg.id
  const startedAt = Date.now()
  const payload = msg.payload as FileChatSendPayload
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
  if (!workspaceFolder) {
    sendError(msg.type, msg.id, sendResponse, 'NOT_FOUND', 'No workspace open')
    return
  }

  await ensureChatDirectory(workspaceFolder)
  await recordFileChatEvent(workspaceFolder, {
    phase: 'extension.fileChat.send.received',
    level: 'info',
    requestId,
    path: typeof payload?.path === 'string' ? payload.path : undefined,
    elapsedMs: Date.now() - startedAt,
  })

  let safePath: SafeFileChatPath
  let question: string
  let markedLines: FileChatMarkedLine[]
  try {
    safePath = validateFileChatPath(payload.path, workspaceFolder)
    question = normalizeQuestion(payload.question)
    markedLines = normalizeMarkedLines(payload.markedLines)
    await ensureSourceFileExists(safePath.sourceUri)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await recordFileChatEvent(workspaceFolder, {
      phase: 'extension.fileChat.send.validate.failed',
      level: 'error',
      requestId,
      path: typeof payload?.path === 'string' ? payload.path : undefined,
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? { message, stack: error.stack } : { message },
    })
    sendError(msg.type, msg.id, sendResponse, message.includes('not found') ? 'NOT_FOUND' : 'INVALID_REQUEST', message)
    return
  }

  try {
    const sourceText = readText(await vscode.workspace.fs.readFile(safePath.sourceUri))
    if (sourceText.length > MAX_SOURCE_CHARS) {
      throw new Error(`Source file too large for file chat V1 (${sourceText.length} chars > ${MAX_SOURCE_CHARS})`)
    }
    const submittedAt = Date.now()
    await writeManifest(workspaceFolder, {
      requestId,
      relativePath: safePath.relativePath,
      question,
      markedLines,
      submittedAt,
    })
    await appendWorkspaceText(workspaceFolder, CHAT_THREAD_PATH, userBlock(requestId, safePath.relativePath, question, markedLines))
    await recordFileChatEvent(workspaceFolder, {
      phase: 'extension.fileChat.source.read',
      level: 'info',
      requestId,
      path: safePath.relativePath,
      elapsedMs: Date.now() - startedAt,
      data: {
        sourceChars: sourceText.length,
        markedLineCount: markedLines.length,
      },
    })

    const config = readFileChatConfig()
    await recordFileChatEvent(workspaceFolder, {
      phase: 'tmux.ensureTarget.start',
      level: 'info',
      requestId,
      path: safePath.relativePath,
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
      feature: 'fileChat',
    })
    await recordFileChatEvent(workspaceFolder, {
      phase: 'tmux.ensureTarget.done',
      level: 'info',
      requestId,
      path: safePath.relativePath,
      target,
      elapsedMs: Date.now() - startedAt,
    })
    if (target.acquired === 'spawned') {
      await delay(SPAWN_READY_DELAY_MS)
      await recordFileChatEvent(workspaceFolder, {
        phase: 'tmux.spawnReadyDelay.done',
        level: 'debug',
        requestId,
        path: safePath.relativePath,
        target,
        elapsedMs: Date.now() - startedAt,
        data: { delayMs: SPAWN_READY_DELAY_MS },
      })
    }

    await recordFileChatEvent(workspaceFolder, {
      phase: 'tmux.send.start',
      level: 'info',
      requestId,
      path: safePath.relativePath,
      target,
      elapsedMs: Date.now() - startedAt,
    })
    await sendMessage({
      command: config.command,
      stateRoot: config.stateRoot,
      bindingId: target.bindingId,
      message: buildFileChatPrompt({
        workspaceRoot: workspaceFolder.uri.fsPath,
        relativePath: safePath.relativePath,
        requestId,
        question,
        sourceText,
        markedLines,
      }),
    })
    await recordFileChatEvent(workspaceFolder, {
      phase: 'tmux.send.done',
      level: 'info',
      requestId,
      path: safePath.relativePath,
      target,
      elapsedMs: Date.now() - startedAt,
    })
    sendResponse(createMessage('fileChat.send.result', {
      path: safePath.relativePath,
      requestId,
      threadId: CHAT_THREAD_ID,
      submittedAt,
      manifestPath: CHAT_MANIFEST_PATH,
      threadPath: CHAT_THREAD_PATH,
      runLogPath: CHAT_RUN_LOG_PATH,
      target,
      submitted: true,
    }, msg.id))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await recordFileChatEvent(workspaceFolder, {
      phase: 'extension.fileChat.send.failed',
      level: 'error',
      requestId,
      path: safePath.relativePath,
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? { message, stack: error.stack } : { message },
    })
    sendError(msg.type, msg.id, sendResponse, 'INVALID_REQUEST', message)
  }
}

export async function handleFileChatStatus(
  msg: WsMessage,
  sendResponse: (msg: WsMessage) => void,
): Promise<void> {
  const startedAt = Date.now()
  const payload = msg.payload as FileChatStatusPayload
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
  if (!workspaceFolder) {
    sendError(msg.type, msg.id, sendResponse, 'NOT_FOUND', 'No workspace open')
    return
  }

  let safePath: SafeFileChatPath
  try {
    safePath = validateFileChatPath(payload.path, workspaceFolder)
    if (typeof payload.requestId !== 'string' || payload.requestId.trim().length === 0) {
      throw new Error('requestId is required')
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    sendError(msg.type, msg.id, sendResponse, 'INVALID_REQUEST', message)
    return
  }

  try {
    const snapshot = await getStatusSnapshot(workspaceFolder, safePath.relativePath, payload.requestId, payload.minUpdatedAt)
    await recordFileChatEvent(workspaceFolder, {
      phase: `extension.fileChat.status.${snapshot.state}`,
      level: snapshot.ready ? 'info' : snapshot.state === 'invalid' ? 'warn' : 'debug',
      requestId: payload.requestId,
      path: safePath.relativePath,
      elapsedMs: Date.now() - startedAt,
      diagnostics: snapshot.diagnostics ?? [],
      data: {
        ready: snapshot.ready,
        updatedAt: snapshot.updatedAt ?? null,
      },
    })
    sendResponse(createMessage('fileChat.status.result', snapshot, msg.id))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await recordFileChatEvent(workspaceFolder, {
      phase: 'extension.fileChat.status.failed',
      level: 'error',
      requestId: payload.requestId,
      path: safePath.relativePath,
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? { message, stack: error.stack } : { message },
    })
    sendError(msg.type, msg.id, sendResponse, 'INVALID_REQUEST', message)
  }
}
