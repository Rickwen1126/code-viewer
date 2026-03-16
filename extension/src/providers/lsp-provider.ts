import * as vscode from 'vscode'
import type { WsMessage } from '@code-viewer/shared'
import { createMessage } from '../ws/client'

export async function handleLspHover(msg: WsMessage, sendResponse: (msg: WsMessage) => void): Promise<void> {
  const { path, line, character } = msg.payload as { path: string; line: number; character: number }
  const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, path)
  const position = new vscode.Position(line, character)

  try {
    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider', uri, position
    )
    if (!hovers || hovers.length === 0) {
      sendResponse(createMessage('lsp.hover.result', null, msg.id))
      return
    }
    const hover = hovers[0]
    const contents = hover.contents
      .map((c) => (typeof c === 'string' ? c : 'value' in c ? c.value : String(c)))
      .join('\n\n')
    const range = hover.range ? {
      start: { line: hover.range.start.line, character: hover.range.start.character },
      end: { line: hover.range.end.line, character: hover.range.end.character },
    } : undefined

    sendResponse(createMessage('lsp.hover.result', { contents, range }, msg.id))
  } catch {
    sendResponse(createMessage('lsp.hover.result', null, msg.id))
  }
}

export async function handleLspDefinition(msg: WsMessage, sendResponse: (msg: WsMessage) => void): Promise<void> {
  const { path, line, character } = msg.payload as { path: string; line: number; character: number }
  const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, path)
  const position = new vscode.Position(line, character)

  try {
    const locations = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
      'vscode.executeDefinitionProvider', uri, position
    )
    const result = (locations ?? []).map((loc) => {
      const targetUri = 'targetUri' in loc ? loc.targetUri : loc.uri
      const targetRange = 'targetRange' in loc ? loc.targetRange : loc.range
      return {
        path: vscode.workspace.asRelativePath(targetUri),
        range: {
          start: { line: targetRange.start.line, character: targetRange.start.character },
          end: { line: targetRange.end.line, character: targetRange.end.character },
        },
      }
    })
    sendResponse(createMessage('lsp.definition.result', { locations: result }, msg.id))
  } catch {
    sendResponse(createMessage('lsp.definition.result', { locations: [] }, msg.id))
  }
}

export async function handleLspReferences(msg: WsMessage, sendResponse: (msg: WsMessage) => void): Promise<void> {
  const { path, line, character } = msg.payload as { path: string; line: number; character: number; includeDeclaration?: boolean }
  const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, path)
  const position = new vscode.Position(line, character)

  try {
    const refs = await vscode.commands.executeCommand<vscode.Location[]>(
      'vscode.executeReferenceProvider', uri, position
    )
    const result = await Promise.all((refs ?? []).map(async (ref) => {
      // Get line preview
      let preview = ''
      try {
        const doc = await vscode.workspace.openTextDocument(ref.uri)
        preview = doc.lineAt(ref.range.start.line).text.trim()
      } catch { /* ignore */ }

      return {
        path: vscode.workspace.asRelativePath(ref.uri),
        range: {
          start: { line: ref.range.start.line, character: ref.range.start.character },
          end: { line: ref.range.end.line, character: ref.range.end.character },
        },
        preview,
      }
    }))
    sendResponse(createMessage('lsp.references.result', { locations: result }, msg.id))
  } catch {
    sendResponse(createMessage('lsp.references.result', { locations: [] }, msg.id))
  }
}

export async function handleLspDocumentSymbol(msg: WsMessage, sendResponse: (msg: WsMessage) => void): Promise<void> {
  const { path } = msg.payload as { path: string }
  const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, path)

  try {
    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
      'vscode.executeDocumentSymbolProvider', uri
    )
    function mapSymbol(sym: vscode.DocumentSymbol): unknown {
      return {
        name: sym.name,
        kind: vscode.SymbolKind[sym.kind]?.toLowerCase() ?? 'unknown',
        range: {
          start: { line: sym.range.start.line, character: sym.range.start.character },
          end: { line: sym.range.end.line, character: sym.range.end.character },
        },
        children: sym.children?.map(mapSymbol),
      }
    }
    sendResponse(createMessage('lsp.documentSymbol.result', { symbols: (symbols ?? []).map(mapSymbol) }, msg.id))
  } catch {
    sendResponse(createMessage('lsp.documentSymbol.result', { symbols: [] }, msg.id))
  }
}
