import * as vscode from 'vscode'
import type { WsMessage } from '@code-viewer/shared'
import { createMessage } from '../ws/client'

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
          title: tour.title ?? name,
          description: tour.description,
          stepCount: Array.isArray(tour.steps) ? tour.steps.length : 0,
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

    const steps = (tour.steps ?? []).map((step: any) => ({
      file: step.file ?? '',
      line: step.line ?? 1,
      endLine: step.endLine,
      title: step.title,
      description: step.description ?? '',
    }))

    sendResponse(createMessage('tour.getSteps.result', {
      tour: { id: tourId, title: tour.title ?? tourId, description: tour.description },
      steps,
    }, msg.id))
  } catch {
    sendResponse(createMessage('tour.getSteps.error', { code: 'NOT_FOUND', message: `Tour not found: ${tourId}` }, msg.id))
  }
}
