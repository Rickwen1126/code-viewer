import * as vscode from 'vscode'
import type { WsMessage, TourCreatePayload, TourAddStepPayload, TourDeleteStepPayload } from '@code-viewer/shared'
import { createMessage } from '../ws/client'
import { getWorkspaceRepo } from './git-provider'
import { validatePath } from '../utils/validate-path'

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
