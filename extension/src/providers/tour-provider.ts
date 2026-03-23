import * as vscode from 'vscode'
import { execFileSync } from 'child_process'
import * as path from 'path'
import type { WsMessage, TourCreatePayload, TourAddStepPayload, TourDeleteStepPayload, TourFinalizePayload, TourDeletePayload, TourGetFileAtRefPayload } from '@code-viewer/shared'
import { createMessage } from '../ws/client'
import { getWorkspaceRepo } from './git-provider'
import { validatePath } from '../utils/validate-path'

const EXT_TO_LANG: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescriptreact',
  '.js': 'javascript', '.jsx': 'javascriptreact',
  '.json': 'json', '.md': 'markdown',
  '.html': 'html', '.css': 'css',
  '.py': 'python', '.rs': 'rust',
  '.go': 'go', '.java': 'java',
  '.yml': 'yaml', '.yaml': 'yaml',
  '.sh': 'shellscript', '.bash': 'shellscript',
}

function guessLanguageId(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  return EXT_TO_LANG[ext] ?? 'plaintext'
}

// ── Helpers ────────────────────────────────────────────────────────────────

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50)
  return slug
}

async function loadTourJson(toursUri: vscode.Uri, fileName: string): Promise<any> {
  const fileUri = vscode.Uri.joinPath(toursUri, fileName)
  const raw = await vscode.workspace.fs.readFile(fileUri)
  return JSON.parse(new TextDecoder().decode(raw))
}

async function saveTourJson(uri: vscode.Uri, data: any): Promise<void> {
  const bytes = new TextEncoder().encode(JSON.stringify(data, null, 2))
  await vscode.workspace.fs.writeFile(uri, bytes)
}

// ── Handlers ───────────────────────────────────────────────────────────────

// tour.list — list all tours in .tours/ directory
export async function handleTourList(msg: WsMessage, sendResponse: (msg: WsMessage) => void): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
  if (!workspaceFolder) {
    sendResponse(createMessage('tour.list.result', { tours: [] }, msg.id))
    return
  }

  try {
    const toursUri = vscode.Uri.joinPath(workspaceFolder.uri, '.tours')
    const entries = await vscode.workspace.fs.readDirectory(toursUri)
    const tours = []

    for (const [name, type] of entries) {
      if (type !== vscode.FileType.File || !name.endsWith('.tour')) continue

      // Only process tour files with safe characters in their names
      const baseName = name.slice(0, -'.tour'.length)
      if (!/^[\w\-]+$/.test(baseName)) continue

      try {
        const fileUri = vscode.Uri.joinPath(toursUri, name)
        const raw = await vscode.workspace.fs.readFile(fileUri)
        const tour = JSON.parse(new TextDecoder().decode(raw))
        tours.push({
          id: name.replace('.tour', ''),
          title: tour.title || name,
          description: tour.description,
          stepCount: Array.isArray(tour.steps) ? tour.steps.length : 0,
          ref: tour.ref,
          status: tour.status,
        })
      } catch {
        // Skip invalid tour files
      }
    }

    sendResponse(createMessage('tour.list.result', { tours }, msg.id))
  } catch {
    // .tours/ directory doesn't exist
    sendResponse(createMessage('tour.list.result', { tours: [] }, msg.id))
  }
}

// tour.getSteps — get steps for a specific tour
export async function handleTourGetSteps(msg: WsMessage, sendResponse: (msg: WsMessage) => void): Promise<void> {
  const { tourId } = msg.payload as { tourId: string }

  if (!/^[\w\-]+$/.test(tourId)) {
    sendResponse(createMessage('tour.getSteps.error',
      { code: 'INVALID_REQUEST', message: 'Invalid tour ID' }, msg.id))
    return
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
  if (!workspaceFolder) {
    sendResponse(createMessage('tour.getSteps.error', { code: 'NOT_FOUND', message: 'No workspace' }, msg.id))
    return
  }

  try {
    const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, '.tours', `${tourId}.tour`)
    const raw = await vscode.workspace.fs.readFile(fileUri)
    const tour = JSON.parse(new TextDecoder().decode(raw))

    const steps = (tour.steps ?? []).map((s: any) => ({
      file: s.file ?? '',
      line: s.line ?? 1,
      endLine: s.endLine,
      title: s.title,
      description: s.description ?? '',
      selection: s.selection,
    }))

    sendResponse(createMessage('tour.getSteps.result', {
      tour: { id: tourId, title: tour.title ?? tourId, description: tour.description, ref: tour.ref },
      steps,
    }, msg.id))
  } catch {
    sendResponse(createMessage('tour.getSteps.error', { code: 'NOT_FOUND', message: `Tour not found: ${tourId}` }, msg.id))
  }
}

// tour.create — create a new recording tour
export async function handleTourCreate(
  msg: WsMessage,
  send: (m: WsMessage) => void,
): Promise<void> {
  const { title, ref } = msg.payload as TourCreatePayload
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
  if (!workspaceFolder) {
    send(createMessage('tour.create.error', { code: 'NOT_FOUND', message: 'No workspace open' }, msg.id))
    return
  }

  const toursUri = vscode.Uri.joinPath(workspaceFolder.uri, '.tours')

  // Check no other tour is recording
  try {
    const entries = await vscode.workspace.fs.readDirectory(toursUri)
    for (const [name, type] of entries) {
      if (type !== vscode.FileType.File || !name.endsWith('.tour')) continue
      const tour = await loadTourJson(toursUri, name)
      if (tour.status === 'recording') {
        send(createMessage('tour.create.error', {
          code: 'TOUR_RECORDING_EXISTS',
          message: `Tour "${tour.title}" is already recording`,
          tourId: name.replace('.tour', ''),
        }, msg.id))
        return
      }
    }
  } catch {
    // .tours/ doesn't exist yet — fine
  }

  // Ensure .tours/ directory exists
  try { await vscode.workspace.fs.createDirectory(toursUri) } catch { /* already exists */ }

  // Generate slug
  const slug = slugify(title)
  if (!slug) {
    send(createMessage('tour.create.error', {
      code: 'INVALID_REQUEST', message: 'Title produces empty slug after sanitization',
    }, msg.id))
    return
  }

  // Check file doesn't already exist
  const tourUri = vscode.Uri.joinPath(toursUri, `${slug}.tour`)
  try {
    await vscode.workspace.fs.stat(tourUri)
    send(createMessage('tour.create.error', {
      code: 'TOUR_SLUG_EXISTS', message: `Tour file ${slug}.tour already exists`,
    }, msg.id))
    return
  } catch { /* File doesn't exist — good */ }

  // Resolve ref: use provided ref, or fall back to current git branch
  const resolvedRef = ref ?? getWorkspaceRepo()?.state.HEAD?.name

  // Write tour file
  const tourData: any = {
    $schema: 'https://aka.ms/codetour-schema',
    title,
    ...(resolvedRef ? { ref: resolvedRef } : {}),
    status: 'recording',
    steps: [],
  }
  await saveTourJson(tourUri, tourData)

  send(createMessage('tour.create.result', {
    tourId: slug,
    filePath: `.tours/${slug}.tour`,
  }, msg.id))
}

// tour.addStep — add a step to a recording tour
export async function handleTourAddStep(msg: WsMessage, send: (m: WsMessage) => void): Promise<void> {
  const payload = msg.payload as TourAddStepPayload
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
  if (!workspaceFolder) { send(createMessage('tour.addStep.error', { code: 'NOT_FOUND', message: 'No workspace open' }, msg.id)); return }

  if (!/^[\w\-]+$/.test(payload.tourId)) { send(createMessage('tour.addStep.error', { code: 'INVALID_REQUEST', message: 'Invalid tour ID' }, msg.id)); return }

  const toursUri = vscode.Uri.joinPath(workspaceFolder.uri, '.tours')
  let tour: any
  try { tour = await loadTourJson(toursUri, `${payload.tourId}.tour`) }
  catch { send(createMessage('tour.addStep.error', { code: 'NOT_FOUND', message: 'Tour not found' }, msg.id)); return }

  if (tour.status !== 'recording') { send(createMessage('tour.addStep.error', { code: 'TOUR_NOT_RECORDING', message: 'Tour is not in recording mode' }, msg.id)); return }

  const validation = validatePath(payload.file, workspaceFolder)
  if (!validation.valid) { send(createMessage('tour.addStep.error', { code: 'INVALID_REQUEST', message: `Invalid path: ${validation.reason}` }, msg.id)); return }

  const step: any = { file: payload.file, line: payload.line }
  if (payload.endLine != null) step.endLine = payload.endLine
  if (payload.selection) step.selection = payload.selection
  if (payload.title) step.title = payload.title
  step.description = payload.description

  if (!Array.isArray(tour.steps)) tour.steps = []
  if (payload.index != null) { tour.steps.splice(payload.index, 0, step) }
  else { tour.steps.push(step) }

  await saveTourJson(vscode.Uri.joinPath(toursUri, `${payload.tourId}.tour`), tour)
  send(createMessage('tour.addStep.result', { stepCount: tour.steps.length }, msg.id))
}

// tour.deleteStep — remove a step from a recording tour
export async function handleTourDeleteStep(msg: WsMessage, send: (m: WsMessage) => void): Promise<void> {
  const { tourId, stepIndex } = msg.payload as TourDeleteStepPayload
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
  if (!workspaceFolder) { send(createMessage('tour.deleteStep.error', { code: 'NOT_FOUND', message: 'No workspace open' }, msg.id)); return }
  if (!/^[\w\-]+$/.test(tourId)) { send(createMessage('tour.deleteStep.error', { code: 'INVALID_REQUEST', message: 'Invalid tour ID' }, msg.id)); return }

  const toursUri = vscode.Uri.joinPath(workspaceFolder.uri, '.tours')
  let tour: any
  try { tour = await loadTourJson(toursUri, `${tourId}.tour`) }
  catch { send(createMessage('tour.deleteStep.error', { code: 'NOT_FOUND', message: 'Tour not found' }, msg.id)); return }

  if (tour.status !== 'recording') { send(createMessage('tour.deleteStep.error', { code: 'TOUR_NOT_RECORDING', message: 'Tour is not in recording mode' }, msg.id)); return }

  if (!Array.isArray(tour.steps) || stepIndex < 0 || stepIndex >= tour.steps.length) {
    send(createMessage('tour.deleteStep.error', { code: 'TOUR_STEP_OUT_OF_BOUNDS', message: `Step index ${stepIndex} out of bounds` }, msg.id)); return
  }

  tour.steps.splice(stepIndex, 1)
  await saveTourJson(vscode.Uri.joinPath(toursUri, `${tourId}.tour`), tour)
  send(createMessage('tour.deleteStep.result', { stepCount: tour.steps.length }, msg.id))
}

// tour.finalize — finalize a recording tour (remove status field)
export async function handleTourFinalize(msg: WsMessage, send: (m: WsMessage) => void): Promise<void> {
  const { tourId } = msg.payload as TourFinalizePayload
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
  if (!workspaceFolder) { send(createMessage('tour.finalize.error', { code: 'NOT_FOUND', message: 'No workspace open' }, msg.id)); return }
  if (!/^[\w\-]+$/.test(tourId)) { send(createMessage('tour.finalize.error', { code: 'INVALID_REQUEST', message: 'Invalid tour ID' }, msg.id)); return }

  const toursUri = vscode.Uri.joinPath(workspaceFolder.uri, '.tours')
  let tour: any
  try { tour = await loadTourJson(toursUri, `${tourId}.tour`) }
  catch { send(createMessage('tour.finalize.error', { code: 'NOT_FOUND', message: 'Tour not found' }, msg.id)); return }

  if (tour.status !== 'recording') { send(createMessage('tour.finalize.error', { code: 'TOUR_NOT_RECORDING', message: 'Tour is not in recording mode' }, msg.id)); return }

  delete tour.status
  await saveTourJson(vscode.Uri.joinPath(toursUri, `${tourId}.tour`), tour)
  send(createMessage('tour.finalize.result', { ok: true }, msg.id))
}

// tour.delete — delete a tour file
export async function handleTourDelete(msg: WsMessage, send: (m: WsMessage) => void): Promise<void> {
  const { tourId } = msg.payload as TourDeletePayload
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
  if (!workspaceFolder) { send(createMessage('tour.delete.error', { code: 'NOT_FOUND', message: 'No workspace open' }, msg.id)); return }
  if (!/^[\w\-]+$/.test(tourId)) { send(createMessage('tour.delete.error', { code: 'INVALID_REQUEST', message: 'Invalid tour ID' }, msg.id)); return }

  const tourUri = vscode.Uri.joinPath(workspaceFolder.uri, '.tours', `${tourId}.tour`)
  try { await vscode.workspace.fs.stat(tourUri) }
  catch { send(createMessage('tour.delete.error', { code: 'NOT_FOUND', message: 'Tour not found' }, msg.id)); return }

  await vscode.workspace.fs.delete(tourUri)
  send(createMessage('tour.delete.result', { ok: true }, msg.id))
}

// tour.getFileAtRef — read file content at a specific git ref (or working tree)
export async function handleTourGetFileAtRef(msg: WsMessage, send: (m: WsMessage) => void): Promise<void> {
  const { ref, path: filePath } = msg.payload as TourGetFileAtRefPayload
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
  if (!workspaceFolder) { send(createMessage('tour.getFileAtRef.error', { code: 'NOT_FOUND', message: 'No workspace open' }, msg.id)); return }

  // Validate path (prevents directory traversal)
  const validation = validatePath(filePath, workspaceFolder)
  if (!validation.valid) { send(createMessage('tour.getFileAtRef.error', { code: 'INVALID_REQUEST', message: `Invalid path: ${validation.reason}` }, msg.id)); return }

  const languageId = guessLanguageId(filePath)

  if (ref == null) {
    // Read from working tree
    try {
      const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, filePath)
      const raw = await vscode.workspace.fs.readFile(fileUri)
      const content = new TextDecoder().decode(raw)
      send(createMessage('tour.getFileAtRef.result', { content, languageId, ref: null }, msg.id))
    } catch {
      send(createMessage('tour.getFileAtRef.error', { code: 'TOUR_FILE_NOT_AT_REF', message: 'File not found' }, msg.id))
    }
    return
  }

  // Read from git ref (execFileSync — no shell injection)
  try {
    const output = execFileSync('git', ['show', `${ref}:${filePath}`], {
      cwd: workspaceFolder.uri.fsPath,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    })
    send(createMessage('tour.getFileAtRef.result', { content: output, languageId, ref }, msg.id))
  } catch (err: any) {
    const message = err?.message ?? ''
    if (message.includes('bad revision') || message.includes('unknown revision')) {
      send(createMessage('tour.getFileAtRef.error', { code: 'TOUR_REF_NOT_FOUND', message: `Git ref "${ref}" not found` }, msg.id))
    } else {
      send(createMessage('tour.getFileAtRef.error', { code: 'TOUR_FILE_NOT_AT_REF', message: `File "${filePath}" not found at ref "${ref}"` }, msg.id))
    }
  }
}
