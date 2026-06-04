import { useState, useEffect, useRef, useCallback, type PointerEvent } from 'react'
import { useParams, useNavigate, useLocation, useSearchParams } from 'react-router'
import { useWebSocket } from '../../hooks/use-websocket'
import { generateId, wsClient } from '../../services/ws-client'
import { cacheService } from '../../services/cache'
import {
  buildFileRestoreKey,
  buildFileLocationUrl,
  oneBasedToZeroBasedLine,
  parseFileLocationQuery,
  zeroBasedToOneBasedLine,
} from '../../services/file-location'
import { writeCurrentFileForWorkspace } from '../../services/current-file'
import { readSavedFileScroll, writeElementFileScroll } from '../../services/file-scroll'
import {
  getDetourAnchor,
  mergeDetourState,
  unwindToDetourAnchor,
} from '../../services/semantic-navigation'
import { useWorkspace } from '../../hooks/use-workspace'
import { useDocumentVisibility } from '../../hooks/use-visibility'
import { debugLog } from '../../services/debug'
import {
  CodeBlock,
  CODE_FONT_SIZE_DEFAULT,
  CODE_FONT_SIZE_MAX,
  CODE_FONT_SIZE_MIN,
  CODE_FONT_SIZE_STORAGE_KEY,
} from '../../components/code-block'
import { MarkdownRenderer } from '../../components/markdown-renderer'
import { InFileSearch } from '../../components/in-file-search'
import {
  addFileBookmark,
  isFileBookmarked,
  removeFileBookmark,
} from '../../services/bookmarks'
import { addRecentFile } from './file-browser'
import { ReferencesList } from '../../components/references-list'
import { SymbolOutline } from '../../components/symbol-outline'
import { useTourEdit } from '../../hooks/use-tour-edit'
import { AddStepOverlay } from '../../components/add-step-overlay'
import { createObjectUrlFromBase64, formatPreviewSize } from '../../services/file-preview'
import type {
  FileReadResultPayload,
  FilePreviewResultPayload,
  AnnotationGeneratePayload,
  AnnotationGenerateResultPayload,
  AnnotationStatusPayload,
  AnnotationStatusResultPayload,
  FileChatSendPayload,
  FileChatSendResultPayload,
  FileChatStatusPayload,
  FileChatStatusResultPayload,
  FileChatThreadResultPayload,
  FileChatArchiveResultPayload,
  LspDefinitionResultPayload,
  LspReferencesResultPayload,
  LspDocumentSymbolResultPayload,
} from '@code-viewer/shared'
import { getFilePreviewKind } from '@code-viewer/shared'

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const LINE_HEIGHT = 19.5 // 13px * 1.5

const menuItemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '8px 12px',
  background: 'none',
  border: 'none',
  color: '#d4d4d4',
  fontSize: 12,
  textAlign: 'left',
  cursor: 'pointer',
}

const menuControlButtonStyle: React.CSSProperties = {
  flex: 1,
  padding: '6px 8px',
  background: '#252526',
  border: '1px solid #444',
  color: '#d4d4d4',
  fontSize: 12,
  borderRadius: 4,
  cursor: 'pointer',
}

const FILE_CHAT_MAXIMIZED_STORAGE_KEY = 'code-viewer:file-chat-maximized'

function clampCodeFontSize(value: number): number {
  return Math.round(Math.min(Math.max(value, CODE_FONT_SIZE_MIN), CODE_FONT_SIZE_MAX))
}

function copyToClipboard(text: string): void {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text))
  } else {
    fallbackCopy(text)
  }
}

function fallbackCopy(text: string): void {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  document.execCommand('copy')
  document.body.removeChild(ta)
}

interface TouchPos {
  line: number
  character: number
}

interface FileReturnPosition {
  path: string
  line?: number
  scrollTop: number
  contentLength: number
}

interface FileReturnState {
  codeViewerFileReturn?: FileReturnPosition
}

type AnnotationMode = 'original' | 'annotated'
type AnnotationPhase = 'idle' | 'submitting' | 'waiting' | 'ready' | 'error'
type FileChatPhase = 'idle' | 'submitting' | 'waiting' | 'ready' | 'error'

interface AnnotationDebugInfo {
  feature: 'annotation'
  path: string
  annotationPath?: string
  runLogPath?: string
  generationId?: string
  phase: AnnotationPhase | 'status'
  state?: string
  ready?: boolean
  submittedAt?: number
  updatedAt?: number
  target?: AnnotationGenerateResultPayload['target']
  diagnostics?: string[]
  error?: string
  capturedAt: number
}

interface FileChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  requestId?: string
  filePath?: string
}

interface FileChatRunInfo {
  requestId: string
  path?: string
  threadPath: string
  runLogPath: string
  submittedAt: number
  target?: FileChatSendResultPayload['target']
  state?: FileChatStatusResultPayload['state']
  diagnostics?: string[]
}

function fileChatRoleLabel(role: FileChatMessage['role']): string {
  return role === 'user' ? 'User' : 'Assistant'
}

function formatFileChatMessageForCopy(message: FileChatMessage): string {
  const lines: string[] = []
  if (message.filePath) lines.push(`File: ${message.filePath}`)
  lines.push(`${fileChatRoleLabel(message.role)}:`)
  lines.push(message.content)
  return lines.join('\n').trim()
}

function formatFileChatThreadForCopy(messages: FileChatMessage[]): string {
  return messages.map(formatFileChatMessageForCopy).join('\n\n---\n\n')
}

function formatFileChatTurnForCopy(message: FileChatMessage, messages: FileChatMessage[]): string {
  if (!message.requestId) return formatFileChatMessageForCopy(message)
  const turnMessages = messages.filter(candidate => candidate.requestId === message.requestId)
  return formatFileChatThreadForCopy(turnMessages.length > 0 ? turnMessages : [message])
}

function parseFileChatThread(threadText: string): FileChatMessage[] {
  const headerPattern = /^## (User|Assistant) requestId=([^\n]+)\s*$/gm
  const headers = Array.from(threadText.matchAll(headerPattern))
  const requestFileMap = new Map<string, string>()
  const messages: FileChatMessage[] = []
  let lastFilePath: string | undefined

  headers.forEach((match, index) => {
    const roleLabel = match[1]
    const requestId = match[2].trim()
    const bodyStart = match.index! + match[0].length
    const bodyEnd = index + 1 < headers.length ? headers[index + 1].index! : threadText.length
    const body = threadText.slice(bodyStart, bodyEnd).trim()

    if (roleLabel === 'User') {
      const fileMatch = /^File:\s*(.+)$/m.exec(body)
      const filePath = fileMatch?.[1]?.trim()
      if (filePath) {
        requestFileMap.set(requestId, filePath)
        lastFilePath = filePath
      }
      const questionMatch = /(?:^|\n)Question:\s*\n+([\s\S]*)$/m.exec(body)
      const content = (questionMatch?.[1] ?? body).trim()
      messages.push({
        id: `${requestId}:user:${index}`,
        role: 'user',
        content,
        createdAt: 0,
        requestId,
        filePath,
      })
      return
    }

    messages.push({
      id: `${requestId}:assistant:${index}`,
      role: 'assistant',
      content: body,
      createdAt: 0,
      requestId,
      filePath: requestFileMap.get(requestId) ?? lastFilePath,
    })
  })

  return messages
}

function getFileReturnPosition(state: unknown): FileReturnPosition | null {
  if (!state || typeof state !== 'object') return null
  const candidate = (state as FileReturnState).codeViewerFileReturn
  if (!candidate || typeof candidate.path !== 'string') return null
  if (typeof candidate.scrollTop !== 'number' || !Number.isFinite(candidate.scrollTop)) return null
  if (typeof candidate.contentLength !== 'number' || !Number.isFinite(candidate.contentLength)) return null
  if (candidate.line !== undefined && (typeof candidate.line !== 'number' || !Number.isFinite(candidate.line))) return null
  return candidate
}

function mergeFileReturnState(
  state: unknown,
  position: FileReturnPosition,
): FileReturnState {
  return {
    ...(state && typeof state === 'object' ? state as Record<string, unknown> : {}),
    codeViewerFileReturn: position,
  }
}

export function CodeViewerPage() {
  const { '*': rawPath } = useParams()
  const path = rawPath ? decodeURIComponent(rawPath) : ''
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const { request, connectionState } = useWebSocket()
  const { workspace, workspaceReady } = useWorkspace()
  const visibility = useDocumentVisibility()
  const [file, setFile] = useState<FileReadResultPayload | null>(null)
  const [preview, setPreview] = useState<FilePreviewResultPayload | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tooLarge, setTooLarge] = useState(false)
  const [wordWrap, setWordWrap] = useState(() =>
    localStorage.getItem('code-viewer:wrap-enabled') === 'true',
  )
  const [codeFontSize, setCodeFontSize] = useState(() => {
    const saved = Number(localStorage.getItem(CODE_FONT_SIZE_STORAGE_KEY))
    return Number.isFinite(saved) && saved > 0
      ? clampCodeFontSize(saved)
      : CODE_FONT_SIZE_DEFAULT
  })
  const [highlightLine, setHighlightLine] = useState<number | null>(null)
  const [mdRendered, setMdRendered] = useState(() =>
    localStorage.getItem('code-viewer:md-view-mode') !== 'raw',
  )
  // Markdown DOM search state
  const [mdSearchQuery, setMdSearchQuery] = useState('')
  const [mdMatchCount, setMdMatchCount] = useState(0)
  const [mdMatchIndex, setMdMatchIndex] = useState(-1)
  const [annotationMode, setAnnotationMode] = useState<AnnotationMode>('original')
  const [annotationPath, setAnnotationPath] = useState<string | null>(null)
  const [annotationExists, setAnnotationExists] = useState(false)
  const [annotationPhase, setAnnotationPhase] = useState<AnnotationPhase>('idle')
  const [annotationError, setAnnotationError] = useState<string | null>(null)
  const [annotationGenerationId, setAnnotationGenerationId] = useState<string | null>(null)
  const [annotationSubmittedAt, setAnnotationSubmittedAt] = useState<number | null>(null)
  const [annotationDebugInfo, setAnnotationDebugInfo] = useState<AnnotationDebugInfo | null>(null)
  const annotationPollSeqRef = useRef(0)
  const [fileChatOpen, setFileChatOpen] = useState(false)
  const [fileChatPhase, setFileChatPhase] = useState<FileChatPhase>('idle')
  const [fileChatQuestion, setFileChatQuestion] = useState('')
  const [fileChatError, setFileChatError] = useState<string | null>(null)
  const [fileChatMessages, setFileChatMessages] = useState<FileChatMessage[]>([])
  const [fileChatRunInfo, setFileChatRunInfo] = useState<FileChatRunInfo | null>(null)
  const [fileChatSearch, setFileChatSearch] = useState('')
  const [fileChatButtonPos, setFileChatButtonPos] = useState({ right: 18, bottom: 18 })
  const [fileChatMaximized, setFileChatMaximized] = useState(() =>
    localStorage.getItem(FILE_CHAT_MAXIMIZED_STORAGE_KEY) === 'true',
  )
  const [isMobileChat, setIsMobileChat] = useState(() => window.innerWidth <= 640)
  const fileChatQuestionRef = useRef<HTMLTextAreaElement>(null)
  const fileChatMessagesRef = useRef<HTMLDivElement>(null)
  const fileChatScrollTimersRef = useRef<number[]>([])
  const fileChatDragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    startRight: number
    startBottom: number
    moved: boolean
  } | null>(null)

  const previewKind = getFilePreviewKind(path)
  const activeFilePath = annotationMode === 'annotated' && annotationExists && annotationPath
    ? annotationPath
    : path
  const isAnnotationView = activeFilePath !== path
  const isMarkdown = file?.languageId === 'markdown'
  const desktopFileChatPanelHeight = Math.min(620, Math.max(320, window.innerHeight - 36))
  const normalizedFileChatSearch = fileChatSearch.trim().toLowerCase()
  const visibleFileChatMessages = normalizedFileChatSearch
    ? fileChatMessages.filter(message => [
        message.content,
        message.filePath ?? '',
        message.requestId ?? '',
      ].some(value => value.toLowerCase().includes(normalizedFileChatSearch)))
    : fileChatMessages

  const scrollFileChatToBottom = useCallback(() => {
    const scrollNow = () => {
      const container = fileChatMessagesRef.current
      if (!container) return
      container.scrollTop = container.scrollHeight
    }
    scrollNow()
    window.requestAnimationFrame(() => {
      scrollNow()
      window.requestAnimationFrame(scrollNow)
    })
    fileChatScrollTimersRef.current.forEach(timer => window.clearTimeout(timer))
    fileChatScrollTimersRef.current = [50, 150, 350].map(delay =>
      window.setTimeout(scrollNow, delay),
    )
  }, [])

  useEffect(() => {
    const onResize = () => {
      const nextIsMobileChat = window.innerWidth <= 640
      setIsMobileChat(nextIsMobileChat)
      setFileChatButtonPos(current => clampFileChatPosition(current, fileChatOpen))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [fileChatOpen])

  useEffect(() => {
    if (!fileChatOpen) return
    scrollFileChatToBottom()
  }, [
    fileChatOpen,
    fileChatMessages.length,
    fileChatPhase,
    fileChatError,
    path,
    visibleFileChatMessages.length,
    scrollFileChatToBottom,
  ])

  useEffect(() => {
    if (!fileChatOpen) return
    const container = fileChatMessagesRef.current
    if (!container || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => scrollFileChatToBottom())
    observer.observe(container)
    return () => observer.disconnect()
  }, [fileChatOpen, scrollFileChatToBottom])

  useEffect(() => {
    return () => {
      fileChatScrollTimersRef.current.forEach(timer => window.clearTimeout(timer))
      fileChatScrollTimersRef.current = []
    }
  }, [])

  useEffect(() => {
    if (!fileChatOpen) return
    void loadFileChatThread()
    if (!isMobileChat) {
      setFileChatButtonPos(current => clampFileChatPosition(current, true))
    }
  }, [fileChatOpen])

  // References list state (T041)
  const [referencesOpen, setReferencesOpen] = useState(false)
  const [references, setReferences] = useState<LspReferencesResultPayload['locations']>([])

  // Symbol outline state (T042)
  const [symbolsOpen, setSymbolsOpen] = useState(false)
  const [symbols, setSymbols] = useState<LspDocumentSymbolResultPayload['symbols']>([])

  // In-file search state
  const [searchOpen, setSearchOpen] = useState(false)

  // Unified DOM-based search for both raw and rendered markdown
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    // Clear previous marks
    container.querySelectorAll('mark[data-md-search]').forEach((mark) => {
      const parent = mark.parentNode
      if (parent) {
        parent.replaceChild(document.createTextNode(mark.textContent ?? ''), mark)
        parent.normalize()
      }
    })

    if (!mdSearchQuery || !searchOpen) {
      setMdMatchCount(0)
      setMdMatchIndex(-1)
      return
    }

    const lowerQuery = mdSearchQuery.toLowerCase()
    const marks: HTMLElement[] = []

    // Walk all text nodes and wrap matches in <mark>
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
    const textNodes: Text[] = []
    let node: Text | null
    while ((node = walker.nextNode() as Text | null)) {
      if (node.textContent && node.textContent.toLowerCase().includes(lowerQuery)) {
        textNodes.push(node)
      }
    }

    for (const textNode of textNodes) {
      const text = textNode.textContent ?? ''
      const lowerText = text.toLowerCase()
      const parts: (string | { match: string })[] = []
      let lastIndex = 0

      let idx = lowerText.indexOf(lowerQuery, lastIndex)
      while (idx !== -1) {
        if (idx > lastIndex) parts.push(text.slice(lastIndex, idx))
        parts.push({ match: text.slice(idx, idx + mdSearchQuery.length) })
        lastIndex = idx + mdSearchQuery.length
        idx = lowerText.indexOf(lowerQuery, lastIndex)
      }
      if (lastIndex < text.length) parts.push(text.slice(lastIndex))

      if (parts.length <= 1) continue

      const frag = document.createDocumentFragment()
      for (const part of parts) {
        if (typeof part === 'string') {
          frag.appendChild(document.createTextNode(part))
        } else {
          const mark = document.createElement('mark')
          mark.setAttribute('data-md-search', '')
          mark.style.background = 'rgba(226,185,61,0.25)'
          mark.style.color = 'inherit'
          mark.style.borderRadius = '2px'
          mark.textContent = part.match
          marks.push(mark)
          frag.appendChild(mark)
        }
      }
      textNode.parentNode?.replaceChild(frag, textNode)
    }

    setMdMatchCount(marks.length)
    if (marks.length > 0) {
      setMdMatchIndex(0)
      marks[0].style.background = 'rgba(226,185,61,0.6)'
      marks[0].scrollIntoView({ block: 'center', behavior: 'smooth' })
    } else {
      setMdMatchIndex(-1)
    }
  }, [mdSearchQuery, searchOpen])

  // Navigate search matches (works for both raw and rendered)
  const mdSearchNavigate = useCallback((direction: 1 | -1) => {
    const container = scrollContainerRef.current
    if (!container) return
    const marks = Array.from(container.querySelectorAll('mark[data-md-search]')) as HTMLElement[]
    if (marks.length === 0) return

    // Reset current highlight
    marks.forEach((m) => { m.style.background = 'rgba(226,185,61,0.25)' })

    const newIndex = ((mdMatchIndex + direction) % marks.length + marks.length) % marks.length
    setMdMatchIndex(newIndex)
    marks[newIndex].style.background = 'rgba(226,185,61,0.6)'
    marks[newIndex].scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [mdMatchIndex])

  // Tour edit state
  const { tourEdit } = useTourEdit()
  const [addStepLine, setAddStepLine] = useState<number | null>(null)
  const [stepModeActive, setStepModeActive] = useState(true) // toggle within session, doesn't clear reference point

  // Overflow menu state
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // File bookmark + file-chat reference markers
  const [fileBookmarked, setFileBookmarked] = useState(false)
  const [markedReferenceLines, setMarkedReferenceLines] = useState<Set<number>>(new Set())

  // Close overflow menu on click outside
  useEffect(() => {
    if (!menuOpen) return
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [menuOpen])

  function updateCodeFontSize(delta: number): void {
    setCodeFontSize((current) => {
      const next = clampCodeFontSize(current + delta)
      localStorage.setItem(CODE_FONT_SIZE_STORAGE_KEY, String(next))
      return next
    })
  }

  // Load file-level bookmark when file changes. Line stars are temporary file-chat reference marks.
  useEffect(() => {
    if (!workspace || !path) return
    setFileBookmarked(isFileBookmarked(workspace.extensionId, path))
    setMarkedReferenceLines(new Set())
  }, [workspace, path])

  function clearMarkedReferenceLines(): void {
    setMarkedReferenceLines(new Set())
    showToast('Reference lines cleared')
  }

  // Line number click — Step+ ON: open add-step overlay; OFF: toggle file-chat reference mark
  const handleLineNumberClick = useCallback((lineNum: number) => {
    if (!workspace || !path || !file || isAnnotationView) return

    if (tourEdit && stepModeActive) {
      // Step+ is ON: open add step overlay
      setAddStepLine(lineNum)
      if (navigator.vibrate) navigator.vibrate(50)
      return
    }

    setMarkedReferenceLines((prev) => {
      const next = new Set(prev)
      if (next.has(lineNum)) {
        next.delete(lineNum)
        showToast(`Reference line removed (${lineNum})`)
      } else {
        next.add(lineNum)
        showToast(`Reference line marked (${lineNum})`)
      }
      return next
    })
    if (navigator.vibrate) navigator.vibrate(50)
  }, [workspace, path, file, tourEdit, stepModeActive, isAnnotationView])

  function toggleFileBookmark(): void {
    if (!workspace || !path) return
    if (fileBookmarked) {
      removeFileBookmark(workspace.extensionId, path)
      setFileBookmarked(false)
      showToast('File bookmark removed')
    } else {
      addFileBookmark(workspace.extensionId, path)
      setFileBookmarked(true)
      showToast('File bookmarked')
    }
  }

  function markedReferenceLineText(): string[] {
    if (!file) return []
    const lines = file.content.split('\n')
    return Array.from(markedReferenceLines)
      .sort((a, b) => a - b)
      .map(lineNum => `L${lineNum}: ${lines[lineNum - 1] ?? ''}`)
  }

  function markedReferencePayload(): Array<{ line: number; content: string }> {
    if (!file) return []
    const lines = file.content.split('\n')
    return Array.from(markedReferenceLines)
      .sort((a, b) => a - b)
      .map(lineNum => ({ line: lineNum, content: lines[lineNum - 1] ?? '' }))
  }

  function insertMarkedLinesIntoChat(): void {
    const referenceText = markedReferenceLineText().join('\n')
    if (!referenceText) return
    const contextBlock = [
      '以下是想要詢問的關聯行：',
      referenceText,
      '',
      '請針對以上關聯行回答：',
      '',
    ].join('\n')
    const nextQuestion = fileChatQuestion.trim().length > 0
      ? `${fileChatQuestion.trimEnd()}\n\n---\n${contextBlock}`
      : contextBlock
    setFileChatQuestion(nextQuestion)
    setFileChatOpen(true)
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const textarea = fileChatQuestionRef.current
        if (!textarea) return
        textarea.focus()
        textarea.setSelectionRange(nextQuestion.length, nextQuestion.length)
      })
    })
    showToast('Reference lines inserted')
  }

  function updateFileChatMaximized(next: boolean): void {
    setFileChatMaximized(next)
    localStorage.setItem(FILE_CHAT_MAXIMIZED_STORAGE_KEY, String(next))
  }

  function clampFileChatPosition(
    pos: { right: number; bottom: number },
    panelOpen: boolean,
  ): { right: number; bottom: number } {
    const width = panelOpen && !isMobileChat ? 420 : 56
    const height = panelOpen && !isMobileChat ? desktopFileChatPanelHeight : 56
    return {
      right: Math.max(0, Math.min(Math.max(0, window.innerWidth - width), pos.right)),
      bottom: Math.max(0, Math.min(Math.max(0, window.innerHeight - height), pos.bottom)),
    }
  }

  function handleFileChatPointerDown(event: PointerEvent<HTMLElement>): void {
    if (isMobileChat && fileChatOpen) return
    if (fileChatMaximized && fileChatOpen) return
    fileChatDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startRight: fileChatButtonPos.right,
      startBottom: fileChatButtonPos.bottom,
      moved: false,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handleFileChatPointerMove(event: PointerEvent<HTMLElement>): void {
    const drag = fileChatDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) drag.moved = true
    if (!drag.moved) return
    setFileChatButtonPos(clampFileChatPosition({
      right: drag.startRight - dx,
      bottom: drag.startBottom - dy,
    }, fileChatOpen))
  }

  function handleFileChatPointerUp(event: PointerEvent<HTMLElement>): void {
    const drag = fileChatDragRef.current
    fileChatDragRef.current = null
    if (!drag || drag.pointerId !== event.pointerId) return
    if (!drag.moved) setFileChatOpen(true)
  }

  // Toast state
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function showToast(msg: string) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToastMsg(msg)
    toastTimerRef.current = setTimeout(() => setToastMsg(null), 1500)
  }

  const codeContainerRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const restoreStateRef = useRef('')
  const queryLocation = parseFileLocationQuery(searchParams)
  const detourAnchor = getDetourAnchor(location.state)
  const fileReturnPosition = getFileReturnPosition(location.state)
  const targetLine = oneBasedToZeroBasedLine(queryLocation.line)
  const persistCurrentScroll = useCallback(() => {
    if (isAnnotationView) return
    if (previewKind || !workspace || !path) return
    if (file?.path && file.path !== path) return
    writeElementFileScroll(
      workspace,
      path,
      scrollContainerRef.current,
      file?.content?.length ?? 0,
    )
  }, [file, path, previewKind, workspace, isAnnotationView])
  const persistCurrentHistoryPosition = useCallback((line?: number) => {
    if (typeof window === 'undefined') return
    if (isAnnotationView) return
    if (previewKind || !path) return
    const currentState = window.history.state as { usr?: unknown } | null
    const currentUserState = currentState?.usr
    window.history.replaceState(
      {
        ...currentState,
        usr: mergeFileReturnState(currentUserState, {
          path,
          line,
          scrollTop: scrollContainerRef.current?.scrollTop ?? 0,
          contentLength: file?.content?.length ?? 0,
        }),
      },
      '',
    )
  }, [file, path, previewKind, isAnnotationView])

  // Persist current file path immediately on navigation
  useEffect(() => {
    if (path) {
      writeCurrentFileForWorkspace(workspace, path)
    }
  }, [path, workspace])

  useEffect(() => {
    setFile(null)
    setPreview(null)
    setPreviewError(null)
    setPreviewUrl(null)
    setTooLarge(false)
    setLoading(true)
  }, [activeFilePath, previewKind])

  useEffect(() => {
    annotationPollSeqRef.current += 1
    setAnnotationMode('original')
    setAnnotationPath(null)
    setAnnotationExists(false)
    setAnnotationPhase('idle')
    setAnnotationError(null)
    setAnnotationGenerationId(null)
    setAnnotationSubmittedAt(null)
    setAnnotationDebugInfo(null)
    setFileChatQuestion('')
  }, [path, previewKind])

  // Redirect to workspace selection if no workspace ever selected
  useEffect(() => {
    if (!workspace && connectionState === 'connected') {
      navigate('/workspaces', { replace: true })
    }
  }, [workspace, connectionState, navigate])

  // Cache-first: immediately show cached file content
  useEffect(() => {
    if (!path || !workspace || previewKind) return
    cacheService.getFileContent(workspace.extensionId, activeFilePath).then(cached => {
      if (cached) {
        setFile(cached)
        setLoading(false)
      }
    })
  }, [path, activeFilePath, workspace, previewKind])

  // Background fetch on connect (no spinner if we have cached data)
  useEffect(() => {
    if (!path || !workspace || !workspaceReady || connectionState !== 'connected') return
    if (previewKind) {
      loadPreview()
    } else {
      loadFileBackground()
    }
    const unsub = wsClient.subscribe('file.contentChanged', (msg) => {
      const payload = msg.payload as { path: string }
      if (payload.path === activeFilePath) {
        debugLog('watch:file', 'event', { source: 'push', path: payload.path })
        if (previewKind) {
          loadPreview()
        } else {
          loadFileBackground()
        }
      }
    })
    return unsub
  }, [path, activeFilePath, workspace, workspaceReady, connectionState, previewKind])

  useEffect(() => {
    if (!path || !workspaceReady || previewKind || connectionState !== 'connected') return
    void refreshAnnotationStatus(false)
  }, [path, workspaceReady, connectionState, previewKind])

  const wasHiddenRef = useRef(visibility !== 'visible')
  useEffect(() => {
    if (visibility !== 'visible') {
      wasHiddenRef.current = true
      return
    }

    if (!wasHiddenRef.current || !path || !workspace || !workspaceReady || connectionState !== 'connected') return
    wasHiddenRef.current = false
    debugLog('watch:file', 'resume-reload', { path: activeFilePath, workspace: workspace.extensionId })
    void (previewKind ? loadPreview() : loadFileBackground())
  }, [visibility, path, activeFilePath, workspace, workspaceReady, connectionState, previewKind])

  useEffect(() => {
    if (!preview) return
    const objectUrl = createObjectUrlFromBase64(preview.mimeType, preview.data)
    setPreviewUrl(objectUrl)
    return () => {
      URL.revokeObjectURL(objectUrl)
    }
  }, [preview])

  // Scroll position: debounced save
  useEffect(() => {
    if (previewKind || isAnnotationView) return
    const container = scrollContainerRef.current
    if (!container || !workspace || !path) return
    let timer: ReturnType<typeof setTimeout>
    const handler = () => {
      clearTimeout(timer)
      timer = setTimeout(persistCurrentScroll, 500)
    }
    container.addEventListener('scroll', handler, { passive: true })
    return () => {
      clearTimeout(timer)
      persistCurrentScroll()
      container.removeEventListener('scroll', handler)
    }
  }, [path, workspace, previewKind, persistCurrentScroll, isAnnotationView])

  // Restore semantic target location first, then fall back to saved scroll.
  useEffect(() => {
    if (previewKind || isAnnotationView) return
    if (!file || !workspace || !scrollContainerRef.current) return
    // During route changes React can briefly render the new path with the previous file state.
    // Do not consume the restore key until the loaded file actually matches the route.
    if (file.path !== path) return
    const restoreKey = buildFileRestoreKey(workspace.rootPath, path, {
      line: queryLocation.line,
    }) + (
      fileReturnPosition?.path === path
        ? `:return:${fileReturnPosition.line ?? 'scroll'}:${Math.round(fileReturnPosition.scrollTop)}`
        : ''
    )
    if (restoreStateRef.current === restoreKey) return
    restoreStateRef.current = restoreKey

    const returnLine = fileReturnPosition?.path === path ? fileReturnPosition.line : undefined
    if (returnLine != null) {
      let secondFrame = 0
      let cancelled = false
      const run = (behavior: ScrollBehavior = 'auto') => {
        if (!cancelled) scrollToLine(returnLine, behavior)
      }
      const firstFrame = requestAnimationFrame(() => {
        run('auto')
        secondFrame = requestAnimationFrame(() => run('auto'))
      })
      const fallbackTimer = window.setTimeout(() => run('auto'), 100)
      const settledTimer = window.setTimeout(() => run('smooth'), 300)
      return () => {
        cancelled = true
        cancelAnimationFrame(firstFrame)
        if (secondFrame) cancelAnimationFrame(secondFrame)
        clearTimeout(fallbackTimer)
        clearTimeout(settledTimer)
      }
    }

    if (fileReturnPosition?.path === path) {
      requestAnimationFrame(() => {
        scrollContainerRef.current?.scrollTo({ top: fileReturnPosition.scrollTop })
      })
      return
    }

    if (targetLine != null) {
      let secondFrame = 0
      let cancelled = false
      const run = (behavior: ScrollBehavior = 'auto') => {
        if (!cancelled) scrollToLine(targetLine, behavior)
      }
      const firstFrame = requestAnimationFrame(() => {
        run('auto')
        secondFrame = requestAnimationFrame(() => run('auto'))
      })
      const fallbackTimer = window.setTimeout(() => run('auto'), 100)
      const settledTimer = window.setTimeout(() => run('smooth'), 300)
      return () => {
        cancelled = true
        cancelAnimationFrame(firstFrame)
        if (secondFrame) cancelAnimationFrame(secondFrame)
        clearTimeout(fallbackTimer)
        clearTimeout(settledTimer)
      }
    }

    const saved = readSavedFileScroll(workspace, path)
    if (!saved) return

    try {
      const { scrollTop, contentLength } = saved
      // Skip if content changed significantly
      if (contentLength && Math.abs(file.content.length - contentLength) / contentLength > 0.1) return
      requestAnimationFrame(() => {
        scrollContainerRef.current?.scrollTo({ top: scrollTop })
      })
    } catch { /* ignore */ }
  }, [file, path, workspace, targetLine, previewKind, fileReturnPosition, queryLocation.line, isAnnotationView])

  // Cleanup: purge scroll entries older than 7 days (once on mount)
  useEffect(() => {
    const now = Date.now()
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i)
      if (key?.startsWith('code-viewer:scroll:')) {
        try {
          const { timestamp } = JSON.parse(localStorage.getItem(key)!)
          if (now - timestamp > SEVEN_DAYS) localStorage.removeItem(key)
        } catch { localStorage.removeItem(key) }
      }
    }
  }, [])

  // Background load: silently update, no spinner
  async function loadFileBackground(targetPath = activeFilePath) {
    if (!targetPath) return
    try {
      debugLog('watch:file', 'request', { path: targetPath, workspace: workspace?.extensionId ?? null })
      const res = await request<{ path: string }, FileReadResultPayload>('file.read', { path: targetPath })
      if (typeof res.payload.content === 'string' && res.payload.content.length > MAX_FILE_SIZE) {
        setTooLarge(true)
        setFile(null)
      } else if (typeof res.payload.content === 'string') {
        setFile(res.payload)
        if (targetPath === path) addRecentFile(path, workspace?.extensionId)
        if (workspace) {
          cacheService.setFileContent(workspace.extensionId, targetPath, {
            path: res.payload.path,
            content: res.payload.content,
            languageId: res.payload.languageId,
            isDirty: res.payload.isDirty,
            encoding: res.payload.encoding,
            lineCount: res.payload.lineCount,
          })
        }
      }
    } catch {
      // If no data at all, try cache
      if (!file && workspace) {
        const cached = await cacheService.getFileContent(workspace.extensionId, targetPath)
        if (cached) setFile(cached)
      }
    } finally {
      setLoading(false)
    }
  }

  async function loadPreview() {
    if (!path) return
    try {
      const res = await request<{ path: string }, FilePreviewResultPayload>('file.preview', { path })
      setPreview(res.payload)
      setPreviewError(null)
      setFile(null)
      addRecentFile(path, workspace?.extensionId)
    } catch (error) {
      setPreview(null)
      setPreviewError(error instanceof Error ? error.message : 'Preview unavailable')
    } finally {
      setLoading(false)
    }
  }

  async function refreshAnnotationStatus(updatePhase = true): Promise<AnnotationStatusResultPayload | null> {
    if (!path || previewKind) return null
    debugLog('annotation', 'status.request', {
      path,
      updatePhase,
      workspace: workspace?.extensionId ?? null,
    })
    try {
      const res = await request<AnnotationStatusPayload, AnnotationStatusResultPayload>(
        'annotation.status',
        { path },
        5000,
      )
      setAnnotationPath(res.payload.annotationPath)
      setAnnotationExists(res.payload.ready)
      setAnnotationGenerationId(res.payload.generationId ?? null)
      setAnnotationDebugInfo({
        feature: 'annotation',
        path: res.payload.path,
        annotationPath: res.payload.annotationPath,
        runLogPath: res.payload.runLogPath,
        generationId: res.payload.generationId,
        phase: 'status',
        state: res.payload.state,
        ready: res.payload.ready,
        updatedAt: res.payload.updatedAt,
        diagnostics: res.payload.validation?.diagnostics ?? [],
        capturedAt: Date.now(),
      })
      debugLog('annotation', 'status.response', {
        requestId: res.replyTo,
        generationId: res.payload.generationId ?? null,
        path: res.payload.path,
        annotationPath: res.payload.annotationPath,
        runLogPath: res.payload.runLogPath ?? null,
        exists: res.payload.exists,
        ready: res.payload.ready,
        state: res.payload.state,
        updatedAt: res.payload.updatedAt ?? null,
        diagnostics: res.payload.validation?.diagnostics ?? [],
      })
      if (res.payload.ready) {
        setAnnotationPhase('ready')
        setAnnotationError(null)
      } else if (res.payload.exists && res.payload.state === 'invalid' && updatePhase) {
        setAnnotationPhase('error')
        setAnnotationError(res.payload.validation?.diagnostics.join('; ') || 'Annotation artifact is invalid')
      } else if (updatePhase) {
        setAnnotationPhase('idle')
      }
      return res.payload
    } catch (error) {
      console.error('[annotation] status.failed', {
        path,
        message: error instanceof Error ? error.message : String(error),
      })
      if (updatePhase) {
        setAnnotationPhase('error')
        setAnnotationError(error instanceof Error ? error.message : 'Annotation status unavailable')
      }
      setAnnotationDebugInfo({
        feature: 'annotation',
        path,
        phase: 'error',
        error: error instanceof Error ? error.message : 'Annotation status unavailable',
        capturedAt: Date.now(),
      })
      return null
    }
  }

  async function pollAnnotationStatus(
    sourcePath: string,
    expectedAnnotationPath: string,
    seq: number,
    generationId: string,
    submittedAt: number,
  ) {
    let lastStatus: AnnotationStatusResultPayload | null = null
    debugLog('annotation', 'poll.start', {
      sourcePath,
      expectedAnnotationPath,
      seq,
      generationId,
      submittedAt,
    })
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise(resolve => window.setTimeout(resolve, attempt === 0 ? 700 : 1500))
      if (annotationPollSeqRef.current !== seq) return
      try {
        debugLog('annotation', 'poll.tick', { sourcePath, expectedAnnotationPath, seq, attempt, generationId })
        const res = await request<AnnotationStatusPayload, AnnotationStatusResultPayload>(
          'annotation.status',
          { path: sourcePath, generationId, minUpdatedAt: submittedAt },
          5000,
        )
        if (annotationPollSeqRef.current !== seq) return
        lastStatus = res.payload
        setAnnotationPath(res.payload.annotationPath)
        setAnnotationExists(res.payload.ready)
        setAnnotationGenerationId(res.payload.generationId ?? generationId)
        setAnnotationDebugInfo({
          feature: 'annotation',
          path: res.payload.path,
          annotationPath: res.payload.annotationPath,
          runLogPath: res.payload.runLogPath,
          generationId: res.payload.generationId ?? generationId,
          phase: res.payload.ready ? 'ready' : 'waiting',
          state: res.payload.state,
          ready: res.payload.ready,
          submittedAt,
          updatedAt: res.payload.updatedAt,
          diagnostics: res.payload.validation?.diagnostics ?? [],
          capturedAt: Date.now(),
        })
        debugLog('annotation', 'poll.response', {
          requestId: res.replyTo,
          generationId: res.payload.generationId ?? generationId,
          sourcePath,
          annotationPath: res.payload.annotationPath,
          runLogPath: res.payload.runLogPath ?? null,
          exists: res.payload.exists,
          ready: res.payload.ready,
          state: res.payload.state,
          attempt,
          updatedAt: res.payload.updatedAt ?? null,
          diagnostics: res.payload.validation?.diagnostics ?? [],
        })
        if (res.payload.ready) {
          setAnnotationPhase('ready')
          setAnnotationError(null)
          setAnnotationMode('annotated')
          debugLog('annotation', 'artifact.load.start', {
            sourcePath,
            annotationPath: res.payload.annotationPath || expectedAnnotationPath,
          })
          await loadFileBackground(res.payload.annotationPath || expectedAnnotationPath)
          debugLog('annotation', 'artifact.load.done', {
            sourcePath,
            annotationPath: res.payload.annotationPath || expectedAnnotationPath,
          })
          showToast('Annotation ready')
          return
        }
      } catch (error) {
        console.warn('[annotation] poll.status.failed', {
          sourcePath,
          attempt,
          message: error instanceof Error ? error.message : String(error),
        })
        // Keep polling; transient relay/extension reconnects can happen on mobile.
      }
    }
    if (annotationPollSeqRef.current !== seq) return
    console.error('[annotation] poll.timeout', {
      sourcePath,
      expectedAnnotationPath,
      seq,
      generationId,
      lastState: lastStatus?.state ?? null,
      diagnostics: lastStatus?.validation?.diagnostics ?? [],
    })
    setAnnotationPhase('error')
    setAnnotationError(
      lastStatus?.validation?.diagnostics.join('; ')
      || (lastStatus?.state ? `Annotation not ready: ${lastStatus.state}` : 'Annotation artifact not found'),
    )
    setAnnotationDebugInfo({
      feature: 'annotation',
      path: sourcePath,
      annotationPath: expectedAnnotationPath,
      runLogPath: lastStatus?.runLogPath,
      generationId,
      phase: 'error',
      state: lastStatus?.state,
      ready: false,
      submittedAt,
      diagnostics: lastStatus?.validation?.diagnostics ?? [],
      error: lastStatus?.state ? `Annotation not ready: ${lastStatus.state}` : 'Annotation artifact not found',
      capturedAt: Date.now(),
    })
  }

  async function generateAnnotation() {
    if (!path || previewKind || annotationPhase === 'submitting' || annotationPhase === 'waiting') return
    const seq = annotationPollSeqRef.current + 1
    annotationPollSeqRef.current = seq
    const generationId = `annotation-${generateId()}`
    debugLog('annotation', 'generate.start', {
      path,
      seq,
      generationId,
      workspace: workspace?.extensionId ?? null,
      annotationExists,
    })
    setAnnotationPhase('submitting')
    setAnnotationError(null)
    setAnnotationGenerationId(generationId)
    setAnnotationSubmittedAt(null)
    setAnnotationDebugInfo({
      feature: 'annotation',
      path,
      generationId,
      phase: 'submitting',
      capturedAt: Date.now(),
    })
    try {
      const res = await request<AnnotationGeneratePayload, AnnotationGenerateResultPayload>(
        'annotation.generate',
        { path, force: true, generationId },
        30000,
      )
      setAnnotationPath(res.payload.annotationPath)
      setAnnotationExists(false)
      setAnnotationPhase('waiting')
      setAnnotationGenerationId(res.payload.generationId)
      setAnnotationSubmittedAt(res.payload.submittedAt)
      setAnnotationDebugInfo({
        feature: 'annotation',
        path: res.payload.path,
        annotationPath: res.payload.annotationPath,
        runLogPath: res.payload.runLogPath,
        generationId: res.payload.generationId,
        phase: 'waiting',
        submittedAt: res.payload.submittedAt,
        target: res.payload.target,
        capturedAt: Date.now(),
      })
      debugLog('annotation', 'generate.submitted', {
        requestId: res.replyTo,
        generationId: res.payload.generationId,
        submittedAt: res.payload.submittedAt,
        path: res.payload.path,
        annotationPath: res.payload.annotationPath,
        runLogPath: res.payload.runLogPath ?? null,
        target: res.payload.target,
      })
      showToast(`Annotation ${res.payload.target.acquired}`)
      void pollAnnotationStatus(path, res.payload.annotationPath, seq, res.payload.generationId, res.payload.submittedAt)
    } catch (error) {
      console.error('[annotation] generate.failed', {
        path,
        seq,
        generationId,
        message: error instanceof Error ? error.message : String(error),
      })
      setAnnotationPhase('error')
      setAnnotationError(error instanceof Error ? error.message : 'Annotation request failed')
      setAnnotationDebugInfo({
        feature: 'annotation',
        path,
        generationId,
        phase: 'error',
        error: error instanceof Error ? error.message : 'Annotation request failed',
        capturedAt: Date.now(),
      })
    }
  }

  async function pollFileChatStatus(sourcePath: string, requestId: string, submittedAt: number): Promise<void> {
    for (let attempt = 0; attempt < 180; attempt += 1) {
      await new Promise(resolve => window.setTimeout(resolve, attempt === 0 ? 900 : 1500))
      try {
        const res = await request<FileChatStatusPayload, FileChatStatusResultPayload>(
          'fileChat.status',
          { path: sourcePath, requestId, minUpdatedAt: submittedAt },
          5000,
        )
        setFileChatRunInfo((current) => current?.requestId === requestId
          ? {
              ...current,
              state: res.payload.state,
              diagnostics: res.payload.diagnostics ?? [],
            }
          : current)
        debugLog('fileChat', 'status.response', {
          requestId,
          path: res.payload.path,
          threadPath: res.payload.threadPath,
          runLogPath: res.payload.runLogPath,
          ready: res.payload.ready,
          state: res.payload.state,
          diagnostics: res.payload.diagnostics ?? [],
          attempt,
        })
        if (res.payload.ready && res.payload.latestAssistantMessage) {
          setFileChatPhase('ready')
          setFileChatError(null)
          setFileChatMessages((messages) => {
            if (messages.some(message => message.id === `${requestId}:assistant`)) return messages
            return [
              ...messages,
              {
                id: `${requestId}:assistant`,
                role: 'assistant',
                content: res.payload.latestAssistantMessage ?? '',
                createdAt: Date.now(),
                requestId,
                filePath: res.payload.path,
              },
            ]
          })
          showToast('File answer ready')
          return
        }
      } catch (error) {
        console.warn('[fileChat] poll.status.failed', {
          sourcePath,
          requestId,
          attempt,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
    setFileChatPhase('error')
    setFileChatError('File chat answer did not become ready in time. It may still finish in the thread later; use New to start a fresh chat if this Codex session is stuck.')
    await loadFileChatThread()
  }

  async function loadFileChatThread(): Promise<void> {
    try {
      const res = await request<Record<string, never>, FileChatThreadResultPayload>(
        'fileChat.thread',
        {},
        5000,
      )
      setFileChatMessages(parseFileChatThread(res.payload.threadText))
      setFileChatError(null)
      scrollFileChatToBottom()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load file chat thread'
      setFileChatError(message)
      console.warn('[fileChat] thread.load.failed', { message })
    }
  }

  async function archiveFileChatThread(): Promise<void> {
    try {
      const res = await request<Record<string, never>, FileChatArchiveResultPayload>(
        'fileChat.archive',
        {},
        10000,
      )
      setFileChatMessages([])
      setFileChatRunInfo({
        requestId: 'archive',
        threadPath: res.payload.threadPath,
        runLogPath: res.payload.runLogPath,
        submittedAt: res.payload.archivedAt,
        diagnostics: [`archived to ${res.payload.archivePath}`],
      })
      setFileChatPhase('idle')
      setFileChatError(null)
      setFileChatSearch('')
      showToast('Chat archived')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to archive chat'
      setFileChatError(message)
      console.warn('[fileChat] archive.failed', { message })
    }
  }

  async function submitFileChatQuestion(): Promise<void> {
    if (!path || !file || fileChatPhase === 'submitting' || fileChatPhase === 'waiting') return
    const question = fileChatQuestion.trim()
    if (!question) {
      setFileChatError('Question is required')
      return
    }
    const requestId = `file-chat-${generateId()}`
    const markedLines = markedReferencePayload()
    setFileChatPhase('submitting')
    setFileChatError(null)
    setFileChatMessages((messages) => [
      ...messages,
      {
        id: `${requestId}:user`,
        role: 'user',
        content: question,
        createdAt: Date.now(),
        requestId,
        filePath: path,
      },
    ])
    setFileChatQuestion('')
    debugLog('fileChat', 'send.start', {
      requestId,
      path,
      markedLineCount: markedLines.length,
    })
    try {
      const res = await request<FileChatSendPayload, FileChatSendResultPayload>(
        'fileChat.send',
        { path, question, requestId, markedLines },
        30000,
      )
      setFileChatPhase('waiting')
      setFileChatRunInfo({
        requestId: res.payload.requestId,
        path: res.payload.path,
        threadPath: res.payload.threadPath,
        runLogPath: res.payload.runLogPath,
        submittedAt: res.payload.submittedAt,
        target: res.payload.target,
      })
      debugLog('fileChat', 'send.submitted', {
        requestId: res.payload.requestId,
        path: res.payload.path,
        threadPath: res.payload.threadPath,
        runLogPath: res.payload.runLogPath,
        target: res.payload.target,
      })
      showToast(`File chat ${res.payload.target.acquired}`)
      void pollFileChatStatus(path, res.payload.requestId, res.payload.submittedAt)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'File chat request failed'
      setFileChatPhase('error')
      setFileChatError(message)
      setFileChatRunInfo({
        requestId,
        path,
        threadPath: '.codeviewer/chat-runs/current/thread.md',
        runLogPath: '.codeviewer/chat-runs/current/run.jsonl',
        submittedAt: Date.now(),
        diagnostics: [message],
      })
      console.error('[fileChat] send.failed', { path, requestId, message })
    }
  }

  // Code popover state: shown on tap, contains hover info + action buttons
  const [popover, setPopover] = useState<{
    pos: TouchPos
    x: number
    y: number
    hoverContent: string | null
    loading: boolean
  } | null>(null)

  // Get line/character from click coordinates using caretRangeFromPoint
  function getPositionFromClick(clientX: number, clientY: number): TouchPos | null {
    const container = codeContainerRef.current
    if (!container) return null

    // Use caretRangeFromPoint to find exact text position
    const range = document.caretRangeFromPoint(clientX, clientY)
    if (!range || !container.contains(range.startContainer)) return null

    // Walk up to find .line element
    let node: Node | null = range.startContainer
    let lineEl: HTMLElement | null = null
    while (node && node !== container) {
      if (node instanceof HTMLElement && node.classList?.contains('line')) {
        lineEl = node
        break
      }
      node = node.parentNode
    }
    if (!lineEl) return null

    // Find line index
    const lines = container.querySelectorAll('.line')
    let lineIndex = 0
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === lineEl) { lineIndex = i; break }
    }

    // Character offset within line
    const lineRange = document.createRange()
    lineRange.selectNodeContents(lineEl)
    lineRange.setEnd(range.startContainer, range.startOffset)
    const character = lineRange.toString().length

    return { line: lineIndex, character }
  }

  // Handle tap on code: show popover with hover info + actions
  function handleCodeClick(e: React.MouseEvent) {
    if (isAnnotationView) return
    // Ignore if user is selecting text (has active selection)
    const sel = window.getSelection()
    if (sel && sel.toString().length > 0) return

    const pos = getPositionFromClick(e.clientX, e.clientY)
    if (!pos) return

    // Position popover near tap point
    const vpWidth = window.innerWidth
    const x = Math.min(e.clientX, vpWidth - 240)
    const y = Math.max(0, e.clientY - 60)

    setPopover({ pos, x, y, hoverContent: null, loading: true })

    // Fetch hover info
    if (connectionState === 'connected') {
      request<{ path: string; line: number; character: number }, { contents: string } | null>(
        'lsp.hover', { path, line: pos.line, character: pos.character }
      ).then(res => {
        setPopover(prev => prev ? { ...prev, hoverContent: res.payload?.contents ?? null, loading: false } : null)
      }).catch(() => {
        setPopover(prev => prev ? { ...prev, loading: false } : null)
      })
    } else {
      setPopover(prev => prev ? { ...prev, loading: false } : null)
    }
  }

  // Navigate to a file at a given line
  function navigateToFile(targetPath: string, line: number, sourceLine?: number) {
    persistCurrentScroll()
    persistCurrentHistoryPosition(sourceLine)
    navigate(
      buildFileLocationUrl(targetPath, { line: zeroBasedToOneBasedLine(line) }),
      { state: mergeDetourState(detourAnchor) },
    )
  }

  // Scroll to a line and briefly highlight it
  function scrollToLine(line: number, behavior: ScrollBehavior = 'smooth') {
    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer) return
    const targetScrollTop = line * LINE_HEIGHT
    scrollContainer.scrollTo({ top: targetScrollTop, behavior })
    setHighlightLine(line)
    setTimeout(() => setHighlightLine(null), 3500)
  }

  // Go to Definition handler (T040) — uses popover position from tap
  async function handleGoToDefinition() {
    if (!popover) return
    const { pos } = popover
    setPopover(null)
    try {
      const res = await request<
        { path: string; line: number; character: number },
        LspDefinitionResultPayload
      >('lsp.definition', { path, line: pos.line, character: pos.character })

      const locations = res.payload?.locations ?? []
      if (locations.length === 0) return

      const loc = locations[0]
      navigateToFile(loc.path, loc.range.start.line, pos.line)
    } catch {
      // Ignore
    }
  }

  // Find References handler (T041) — uses popover position from tap
  async function handleFindReferences() {
    if (!popover) return
    const { pos } = popover
    setPopover(null)
    try {
      const res = await request<
        { path: string; line: number; character: number; includeDeclaration: boolean },
        LspReferencesResultPayload
      >('lsp.references', {
        path,
        line: pos.line,
        character: pos.character,
        includeDeclaration: true,
      })

      setReferences(res.payload?.locations ?? [])
      setReferencesOpen(true)
    } catch {
      setReferences([])
      setReferencesOpen(true)
    }
  }

  // Document Symbols handler (T042)
  async function handleDocumentSymbols() {
    try {
      const res = await request<{ path: string }, LspDocumentSymbolResultPayload>(
        'lsp.documentSymbol',
        { path },
      )
      setSymbols(res.payload?.symbols ?? [])
      setSymbolsOpen(true)
    } catch {
      setSymbols([])
      setSymbolsOpen(true)
    }
  }

  const fileName = path.split('/').pop() ?? path
  const annotationBusy = annotationPhase === 'submitting' || annotationPhase === 'waiting'
  const annotationStatusLabel = annotationPhase === 'submitting'
    ? 'Submitting'
    : annotationPhase === 'waiting'
      ? 'Waiting'
      : annotationPhase === 'ready'
        ? 'Annotated'
        : annotationPhase === 'error'
          ? 'Annotation error'
          : null
  const annotationStatusTitle = [
    annotationError,
    annotationGenerationId ? `generation: ${annotationGenerationId}` : null,
    annotationDebugInfo?.runLogPath ? `run log: ${annotationDebugInfo.runLogPath}` : null,
    annotationSubmittedAt ? `submitted: ${new Date(annotationSubmittedAt).toLocaleTimeString()}` : null,
  ].filter(Boolean).join(' | ') || undefined
  const stackFileActions = annotationExists || isAnnotationView

  function copyAnnotationDebugInfo(): void {
    if (!annotationDebugInfo) return
    copyToClipboard(JSON.stringify(annotationDebugInfo, null, 2))
    showToast('Annotation debug info copied')
  }

  if (previewKind) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '6px 12px', borderBottom: '1px solid #333', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            {detourAnchor && (
              <button
                onClick={() => unwindToDetourAnchor(navigate, detourAnchor)}
                style={{
                  background: 'none',
                  border: '1px solid #444',
                  color: '#569cd6',
                  fontSize: 11,
                  padding: '2px 8px',
                  borderRadius: 4,
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                {detourAnchor.label}
              </button>
            )}
            <div style={{ fontSize: 13, color: '#d4d4d4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
              {fileName}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, color: '#888' }}>{preview?.mimeType ?? previewKind}</span>
            {preview && (
              <span style={{ fontSize: 11, color: '#888' }}>{formatPreviewSize(preview.size)}</span>
            )}
          </div>
        </div>

        <div
          style={{
            flex: 1,
            overflow: 'auto',
            WebkitOverflowScrolling: 'touch',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#111',
            padding: 16,
          }}
        >
          {loading ? (
            <div style={{ color: '#888', fontSize: 14 }}>Loading preview...</div>
          ) : previewUrl && preview?.kind === 'image' ? (
            <img
              src={previewUrl}
              alt={fileName}
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 8 }}
            />
          ) : previewUrl && preview?.kind === 'video' ? (
            <video
              src={previewUrl}
              controls
              playsInline
              preload="metadata"
              style={{ width: '100%', maxHeight: '100%', background: '#000', borderRadius: 8 }}
            />
          ) : (
            <div style={{ textAlign: 'center', color: '#888' }}>
              <div style={{ fontSize: 14, color: '#d4d4d4', marginBottom: 8 }}>Preview unavailable</div>
              <div style={{ fontSize: 12 }}>{previewError ?? 'This file type is not previewable yet.'}</div>
            </div>
          )}
        </div>
      </div>
    )
  }

  if (loading && !file) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            padding: '8px 12px',
            borderBottom: '1px solid #333',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 13, color: '#d4d4d4' }}>{fileName}</span>
        </div>
        <div style={{ flex: 1, padding: '12px 16px', display: 'flex', gap: 12 }}>
          <div style={{ width: 28, flexShrink: 0 }}>
            {Array.from({ length: 20 }, (_, i) => (
              <div
                key={i}
                style={{
                  height: 12,
                  marginBottom: 7.5,
                  borderRadius: 2,
                  background: '#2a2a2a',
                  width: i < 9 ? 8 : 16,
                  marginLeft: 'auto',
                }}
              />
            ))}
          </div>
          <div style={{ flex: 1 }}>
            {[65, 40, 80, 55, 30, 70, 45, 90, 35, 60, 25, 75, 50, 85, 20, 70, 40, 55, 30, 65].map(
              (w, i) => (
                <div
                  key={i}
                  style={{
                    height: 12,
                    marginBottom: 7.5,
                    borderRadius: 2,
                    background: '#2a2a2a',
                    width: `${w}%`,
                    animation: 'skeleton-pulse 1.5s ease-in-out infinite',
                    animationDelay: `${i * 50}ms`,
                  }}
                />
              ),
            )}
          </div>
        </div>
        <style>{`
          @keyframes skeleton-pulse {
            0%, 100% { opacity: 0.4; }
            50% { opacity: 0.8; }
          }
        `}</style>
      </div>
    )
  }

  if (tooLarge) {
    return (
      <div style={{ padding: 16, textAlign: 'center', paddingTop: 60 }}>
        <div style={{ fontSize: 16, color: '#d4d4d4', marginBottom: 8 }}>{fileName}</div>
        <div style={{ fontSize: 14, color: '#888', marginBottom: 16 }}>File too large (&gt;5MB)</div>
        <div style={{ fontSize: 13, color: '#569cd6' }}>Please view in Desktop VS Code</div>
      </div>
    )
  }

  if (!file) {
    return <div style={{ padding: 16, color: '#888' }}>File not found</div>
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header — two rows: filename on top, buttons below */}
      <div style={{ padding: '6px 12px', borderBottom: '1px solid #333', flexShrink: 0 }}>
        {/* Row 1: filename */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          {detourAnchor && (
            <button
              onClick={() => unwindToDetourAnchor(navigate, detourAnchor)}
              style={{
                background: 'none',
                border: '1px solid #444',
                color: '#569cd6',
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: 4,
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              {detourAnchor.label}
            </button>
          )}
          <div style={{ fontSize: 13, color: '#d4d4d4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
            {fileName}
          </div>
        </div>
        {/* Row 2: metadata + buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: '#888' }}>{file.languageId}</span>
          {file.isDirty && (
            <span
              style={{
                fontSize: 10,
                color: '#e2b93d',
                background: '#3c3c00',
                padding: '1px 6px',
                borderRadius: 4,
              }}
            >
              unsaved
            </span>
          )}
          {fileBookmarked && (
            <span style={{ fontSize: 11, color: '#e2b93d' }} title="File bookmarked">
              &#x2605; file
            </span>
          )}
          {markedReferenceLines.size > 0 && (
            <>
              <span style={{ fontSize: 11, color: '#9cdcfe' }} title={markedReferenceLineText().join('\n')}>
                ref {markedReferenceLines.size}
              </span>
              <button
                onClick={clearMarkedReferenceLines}
                title="Clear marked reference lines"
                aria-label="Clear marked reference lines"
                style={{
                  height: 22,
                  padding: '0 7px',
                  borderRadius: 4,
                  border: '1px solid #444',
                  background: '#252526',
                  color: '#d4d4d4',
                  cursor: 'pointer',
                  fontSize: 11,
                }}
              >
                Clear refs
              </button>
            </>
          )}
          {annotationStatusLabel && (
            <span
              style={{
                fontSize: 10,
                color: annotationPhase === 'error' ? '#f48771' : '#9cdcfe',
                background: annotationPhase === 'error' ? '#3b1f1a' : '#1f3442',
                padding: '1px 6px',
                borderRadius: 4,
              }}
              title={annotationStatusTitle}
            >
              {annotationStatusLabel}
            </span>
          )}
          <div style={{
            marginLeft: stackFileActions ? 0 : 'auto',
            display: 'flex',
            gap: 4,
            alignItems: 'center',
            justifyContent: 'flex-end',
            flexWrap: 'wrap',
            width: stackFileActions ? '100%' : undefined,
            maxWidth: '100%',
          }}>
          {(annotationExists || isAnnotationView) && (
            <div style={{ display: 'flex', height: 24, border: '1px solid #444', borderRadius: 4, overflow: 'hidden' }}>
              <button
                onClick={() => setAnnotationMode('original')}
                style={{
                  background: annotationMode === 'original' ? '#333' : 'none',
                  border: 'none',
                  borderRight: '1px solid #444',
                  color: annotationMode === 'original' ? '#d4d4d4' : '#888',
                  fontSize: 11,
                  padding: '0 8px',
                  cursor: 'pointer',
                }}
              >
                Original
              </button>
              <button
                onClick={() => annotationExists && setAnnotationMode('annotated')}
                disabled={!annotationExists}
                style={{
                  background: annotationMode === 'annotated' ? '#333' : 'none',
                  border: 'none',
                  color: annotationMode === 'annotated' ? '#d4d4d4' : '#888',
                  fontSize: 11,
                  padding: '0 8px',
                  cursor: annotationExists ? 'pointer' : 'default',
                  opacity: annotationExists ? 1 : 0.45,
                }}
              >
                Annotated
              </button>
            </div>
          )}
          {!annotationExists && !isAnnotationView && (
            <button
              onClick={generateAnnotation}
              disabled={annotationBusy}
              style={{
                background: annotationBusy ? '#333' : 'none',
                border: '1px solid #444',
                color: annotationBusy ? '#888' : '#d4d4d4',
                fontSize: 11,
                padding: '0 8px',
                height: 24,
                borderRadius: 4,
                cursor: annotationBusy ? 'default' : 'pointer',
              }}
            >
              {annotationBusy ? '...' : 'Annotate'}
            </button>
          )}
          {isMarkdown && (
            <button
              onClick={() => setMdRendered((v) => {
                const next = !v
                localStorage.setItem('code-viewer:md-view-mode', next ? 'rendered' : 'raw')
                return next
              })}
              style={{
                background: mdRendered ? '#333' : 'none',
                border: '1px solid #444',
                color: mdRendered ? '#d4d4d4' : '#888',
                fontSize: 11,
                padding: '0 8px',
                height: 24,
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              {mdRendered ? 'Rendered' : 'Raw'}
            </button>
          )}
          <button
            onClick={() => setSearchOpen(v => !v)}
            style={{
              background: searchOpen ? '#333' : 'none',
              border: '1px solid #444',
              color: searchOpen ? '#d4d4d4' : '#888',
              fontSize: 13,
              padding: '0 8px',
              height: 24,
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            &#x1F50D;
          </button>
          {tourEdit && (
            <button
              onClick={() => setStepModeActive(v => !v)}
              style={{
                background: stepModeActive ? '#264f78' : 'none',
                border: stepModeActive ? '1px solid #569cd6' : '1px solid #444',
                color: stepModeActive ? '#d4d4d4' : '#888',
                fontSize: 11,
                padding: '0 8px',
                height: 24,
                borderRadius: 4,
                cursor: 'pointer',
                maxWidth: 100,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={`Step+ (${tourEdit.tourTitle}) — tap to toggle`}
            >
              Step+
            </button>
          )}
          {/* Overflow menu */}
          <div ref={menuRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setMenuOpen(v => !v)}
              style={{
                background: menuOpen ? '#333' : 'none',
                border: '1px solid #444',
                color: menuOpen ? '#d4d4d4' : '#888',
                fontSize: 13,
                padding: '0 8px',
                height: 24,
                borderRadius: 4,
                cursor: 'pointer',
              }}
              title="More actions"
            >
              &#x22EF;
            </button>
            {menuOpen && (
              <div style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: 4,
                width: 200,
                background: '#1e1e1e',
                border: '1px solid #444',
                borderRadius: 6,
                boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
                zIndex: 100,
                overflow: 'hidden',
              }}>
                <button
                  onClick={() => {
                    copyToClipboard(path)
                    setMenuOpen(false)
                  }}
                  style={menuItemStyle}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#2a2d2e' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none' }}
                >
                  Copy Relative Path
                </button>
                <button
                  onClick={() => {
                    const abs = workspace?.rootPath ? `${workspace.rootPath}/${path}` : path
                    copyToClipboard(abs)
                    setMenuOpen(false)
                  }}
                  style={menuItemStyle}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#2a2d2e' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none' }}
                >
                  Copy Absolute Path
                </button>
                <div style={{ borderTop: '1px solid #333' }} />
                <button
                  onClick={() => {
                    toggleFileBookmark()
                    setMenuOpen(false)
                  }}
                  style={menuItemStyle}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#2a2d2e' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none' }}
                >
                  {fileBookmarked ? '★ Remove File Bookmark' : '☆ Bookmark File'}
                </button>
                <button
                  onClick={() => {
                    copyToClipboard(markedReferenceLineText().join('\n'))
                    setMenuOpen(false)
                    showToast('Reference lines copied')
                  }}
                  disabled={markedReferenceLines.size === 0}
                  style={{
                    ...menuItemStyle,
                    opacity: markedReferenceLines.size === 0 ? 0.45 : 1,
                    cursor: markedReferenceLines.size === 0 ? 'default' : 'pointer',
                  }}
                  onMouseEnter={(e) => {
                    if (markedReferenceLines.size > 0) (e.currentTarget as HTMLElement).style.background = '#2a2d2e'
                  }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none' }}
                >
                  Copy Marked Lines
                </button>
                <div style={{ borderTop: '1px solid #333' }} />
                <button
                  onClick={() => {
                    setWordWrap((v) => {
                      const next = !v
                      localStorage.setItem('code-viewer:wrap-enabled', String(next))
                      return next
                    })
                    setMenuOpen(false)
                  }}
                  style={menuItemStyle}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#2a2d2e' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none' }}
                >
                  {wordWrap ? '✓ ' : ''}Word Wrap
                </button>
                <button
                  onClick={() => {
                    handleDocumentSymbols()
                    setMenuOpen(false)
                  }}
                  style={menuItemStyle}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#2a2d2e' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none' }}
                >
                  Symbols
                </button>
                <button
                  onClick={() => {
                    void generateAnnotation()
                    setMenuOpen(false)
                  }}
                  disabled={annotationBusy}
                  style={{
                    ...menuItemStyle,
                    opacity: annotationBusy ? 0.45 : 1,
                    cursor: annotationBusy ? 'default' : 'pointer',
                  }}
                  onMouseEnter={(e) => {
                    if (!annotationBusy) (e.currentTarget as HTMLElement).style.background = '#2a2d2e'
                  }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none' }}
                >
                  {annotationExists ? 'Regen Annotation' : 'Generate Annotation'}
                </button>
                <button
                  onClick={() => {
                    copyAnnotationDebugInfo()
                    setMenuOpen(false)
                  }}
                  disabled={!annotationDebugInfo}
                  style={{
                    ...menuItemStyle,
                    opacity: annotationDebugInfo ? 1 : 0.45,
                    cursor: annotationDebugInfo ? 'pointer' : 'default',
                  }}
                  onMouseEnter={(e) => {
                    if (annotationDebugInfo) (e.currentTarget as HTMLElement).style.background = '#2a2d2e'
                  }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none' }}
                >
                  Copy Annotation Debug Info
                </button>
                <div style={{ borderTop: '1px solid #333' }} />
                <div style={{ padding: '8px 12px' }}>
                  <div style={{ color: '#888', fontSize: 11, marginBottom: 6 }}>
                    Font Size {codeFontSize}px
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => updateCodeFontSize(-1)}
                      disabled={codeFontSize <= CODE_FONT_SIZE_MIN}
                      style={{
                        ...menuControlButtonStyle,
                        opacity: codeFontSize <= CODE_FONT_SIZE_MIN ? 0.45 : 1,
                        cursor: codeFontSize <= CODE_FONT_SIZE_MIN ? 'default' : 'pointer',
                      }}
                    >
                      A-
                    </button>
                    <button
                      onClick={() => updateCodeFontSize(1)}
                      disabled={codeFontSize >= CODE_FONT_SIZE_MAX}
                      style={{
                        ...menuControlButtonStyle,
                        opacity: codeFontSize >= CODE_FONT_SIZE_MAX ? 0.45 : 1,
                        cursor: codeFontSize >= CODE_FONT_SIZE_MAX ? 'default' : 'pointer',
                      }}
                    >
                      A+
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
          </div>
        </div>
      </div>

      {/* In-file search bar */}
      <InFileSearch
        content={file.content}
        visible={searchOpen}
        onClose={() => setSearchOpen(false)}
        onMatchesChange={() => {}}
        onQueryChange={setMdSearchQuery}
        overrideMatchCount={mdMatchCount}
        overrideMatchIndex={mdMatchIndex}
        onNavigate={(d) => mdSearchNavigate(d as 1 | -1)}
      />

      {/* Content area */}
      <div
        ref={scrollContainerRef}
        style={{ flex: 1, overflow: 'auto', WebkitOverflowScrolling: 'touch', position: 'relative' }}
        onClick={isAnnotationView || (isMarkdown && mdRendered) ? undefined : handleCodeClick}
      >
        {isMarkdown && mdRendered ? (
          <MarkdownRenderer content={file.content} codeFontSize={codeFontSize} wordWrap={wordWrap} />
        ) : (
          <div ref={codeContainerRef}>
            <CodeBlock
              code={file.content}
              language={file.languageId}
              filePath={activeFilePath}
              showLineNumbers
              wordWrap={wordWrap}
              highlightLine={highlightLine}
              bookmarkedLines={markedReferenceLines}
              onLineNumberClick={handleLineNumberClick}
              fontSize={codeFontSize}
            />
          </div>
        )}
      </div>

      {/* Code popover: hover info + Go to Definition / Find References */}
      {popover && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            left: popover.x,
            top: popover.y,
            maxWidth: 280,
            background: '#252526',
            border: '1px solid #444',
            borderRadius: 8,
            padding: 0,
            fontSize: 12,
            color: '#d4d4d4',
            zIndex: 50,
            boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
            overflow: 'hidden',
          }}
        >
          {/* Hover content */}
          <div style={{
            padding: '8px 12px',
            fontFamily: "'JetBrains Mono', monospace",
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            lineHeight: 1.4,
            maxHeight: 120,
            overflow: 'auto',
            borderBottom: '1px solid #333',
            color: popover.loading ? '#888' : '#d4d4d4',
          }}>
            {popover.loading ? '...' : (popover.hoverContent || 'No type info')}
          </div>
          {/* Action buttons */}
          <div style={{ display: 'flex' }}>
            <button
              onClick={handleGoToDefinition}
              style={{
                flex: 1,
                padding: '10px 8px',
                background: 'none',
                border: 'none',
                borderRight: '1px solid #333',
                color: '#569cd6',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Definition
            </button>
            <button
              onClick={handleFindReferences}
              style={{
                flex: 1,
                padding: '10px 8px',
                background: 'none',
                border: 'none',
                color: '#569cd6',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              References
            </button>
          </div>
        </div>
      )}

      {/* Dismiss popover on tap outside */}
      {popover && (
        <div
          onClick={() => setPopover(null)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 49,
          }}
        />
      )}


      {/* References list (T041) */}
      <ReferencesList
        isOpen={referencesOpen}
        onClose={() => setReferencesOpen(false)}
        references={references}
        onNavigate={navigateToFile}
      />

      {/* Symbol outline (T042) */}
      <SymbolOutline
        isOpen={symbolsOpen}
        onClose={() => setSymbolsOpen(false)}
        symbols={symbols}
        onNavigate={(line) => navigateToFile(path, line)}
      />

      {/* Add Step Overlay */}
      {addStepLine !== null && tourEdit && (
        <AddStepOverlay
          file={path}
          tappedLine={addStepLine}
          onClose={() => setAddStepLine(null)}
          onSaved={() => {
            setAddStepLine(null)
            showToast(`Step added to "${tourEdit.tourTitle}"`)
          }}
        />
      )}

      {/* Ask About File */}
      {!fileChatOpen && !isAnnotationView && (
        <button
          onPointerDown={handleFileChatPointerDown}
          onPointerMove={handleFileChatPointerMove}
          onPointerUp={handleFileChatPointerUp}
          style={{
            position: 'fixed',
            right: fileChatButtonPos.right,
            bottom: fileChatButtonPos.bottom,
            width: 48,
            height: 48,
            borderRadius: '50%',
            border: fileChatPhase === 'error' ? '1px solid #f48771' : '1px solid #569cd6',
            background: fileChatPhase === 'waiting' || fileChatPhase === 'submitting' ? '#1f3442' : '#0e639c',
            color: '#fff',
            fontSize: 16,
            fontWeight: 600,
            cursor: 'grab',
            zIndex: 70,
            boxShadow: '0 8px 22px rgba(0,0,0,0.45)',
            touchAction: 'none',
          }}
          title="Ask About File"
        >
          ?
        </button>
      )}

      {fileChatOpen && !isAnnotationView && (
        <div
          style={{
            position: 'fixed',
            inset: isMobileChat || fileChatMaximized ? 0 : undefined,
            right: isMobileChat || fileChatMaximized ? undefined : fileChatButtonPos.right,
            bottom: isMobileChat || fileChatMaximized ? undefined : fileChatButtonPos.bottom,
            width: isMobileChat || fileChatMaximized ? '100vw' : 420,
            height: isMobileChat || fileChatMaximized ? '100dvh' : 'min(620px, calc(100vh - 36px))',
            maxWidth: '100vw',
            background: '#1e1e1e',
            border: isMobileChat || fileChatMaximized ? 'none' : '1px solid #444',
            borderRadius: isMobileChat || fileChatMaximized ? 0 : 8,
            boxShadow: '0 12px 34px rgba(0,0,0,0.55)',
            zIndex: 80,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 12px',
            borderBottom: '1px solid #333',
            flexShrink: 0,
          }}>
            <div
              onPointerDown={handleFileChatPointerDown}
              onPointerMove={handleFileChatPointerMove}
              onPointerUp={handleFileChatPointerUp}
              style={{
                flex: 1,
                minWidth: 0,
                cursor: isMobileChat || fileChatMaximized ? 'default' : 'grab',
                touchAction: isMobileChat || fileChatMaximized ? 'auto' : 'none',
              }}
              title={isMobileChat || fileChatMaximized ? fileName : 'Drag Ask About File'}
            >
              <div style={{ color: '#d4d4d4', fontSize: 13, fontWeight: 600 }}>Ask About File</div>
              <div style={{ color: '#888', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {fileName}
              </div>
            </div>
            {fileChatPhase !== 'idle' && (
              <span style={{
                color: fileChatPhase === 'error' ? '#f48771' : '#9cdcfe',
                background: fileChatPhase === 'error' ? '#3b1f1a' : '#1f3442',
                borderRadius: 4,
                padding: '2px 6px',
                fontSize: 11,
              }}>
                {fileChatPhase}
              </span>
            )}
            {!isMobileChat && (
              <button
                onClick={() => updateFileChatMaximized(!fileChatMaximized)}
                style={{
                  background: '#252526',
                  border: '1px solid #444',
                  color: '#d4d4d4',
                  height: 28,
                  borderRadius: 4,
                  padding: '0 8px',
                  cursor: 'pointer',
                  fontSize: 12,
                }}
                title={fileChatMaximized ? 'Restore Ask About File dialog' : 'Maximize Ask About File dialog'}
                aria-label={fileChatMaximized ? 'Restore Ask About File dialog' : 'Maximize Ask About File dialog'}
              >
                {fileChatMaximized ? 'Restore' : 'Max'}
              </button>
            )}
            <button
              onClick={() => void archiveFileChatThread()}
              style={{
                background: '#252526',
                border: '1px solid #444',
                color: '#d4d4d4',
                height: 28,
                borderRadius: 4,
                padding: '0 8px',
                cursor: 'pointer',
                fontSize: 12,
              }}
              title="Archive current chat and start a new one"
            >
              New
            </button>
            <button
              onClick={() => setFileChatOpen(false)}
              style={{
                background: 'none',
                border: '1px solid #444',
                color: '#d4d4d4',
                width: 28,
                height: 28,
                borderRadius: 4,
                cursor: 'pointer',
              }}
              title="Close"
            >
              ×
            </button>
          </div>

          <div style={{
            borderBottom: '1px solid #333',
            padding: '8px 12px',
            flexShrink: 0,
          }}>
            <input
              value={fileChatSearch}
              onChange={(event) => setFileChatSearch(event.target.value)}
              placeholder="Search this thread"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                background: '#111',
                border: '1px solid #444',
                borderRadius: 5,
                color: '#d4d4d4',
                padding: '6px 8px',
                fontSize: 12,
                outline: 'none',
              }}
            />
            {normalizedFileChatSearch && (
              <div style={{ color: '#888', fontSize: 11, marginTop: 4 }}>
                {visibleFileChatMessages.length} match{visibleFileChatMessages.length === 1 ? '' : 'es'}
              </div>
            )}
          </div>

          <div ref={fileChatMessagesRef} style={{
            flex: 1,
            overflow: 'auto',
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            overflowAnchor: 'none',
          }}>
            {fileChatMessages.length === 0 ? (
              <div style={{ color: '#888', fontSize: 13, lineHeight: 1.5 }}>
                Current file is attached automatically.
              </div>
            ) : visibleFileChatMessages.length === 0 ? (
              <div style={{ color: '#888', fontSize: 13, lineHeight: 1.5 }}>
                No matching messages.
              </div>
            ) : (
              visibleFileChatMessages.map((message) => (
                <div
                  key={message.id}
                  style={{
                    alignSelf: message.role === 'user' ? 'flex-end' : 'stretch',
                    maxWidth: message.role === 'user' ? '88%' : '100%',
                    background: message.role === 'user' ? '#264f78' : '#252526',
                    border: message.role === 'user' ? '1px solid #326a9d' : '1px solid #333',
                    color: '#d4d4d4',
                    borderRadius: 8,
                    padding: '8px 10px',
                    fontSize: 13,
                    lineHeight: 1.5,
                    whiteSpace: message.role === 'user' ? 'pre-wrap' : undefined,
                    wordBreak: 'break-word',
                  }}
                  title={[
                    message.filePath ? `file: ${message.filePath}` : '',
                    message.requestId ? `request: ${message.requestId}` : '',
                  ].filter(Boolean).join('\n')}
                >
                  <div style={{
                    display: 'flex',
                    justifyContent: message.role === 'user' ? 'flex-end' : 'space-between',
                    alignItems: 'center',
                    gap: 8,
                    marginBottom: 6,
                  }}>
                    {message.role === 'assistant' && (
                      <span style={{
                        color: '#888',
                        fontSize: 11,
                        fontWeight: 600,
                        textTransform: 'uppercase',
                      }}>
                        Reply
                      </span>
                    )}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <button
                        onClick={() => {
                          copyToClipboard(formatFileChatMessageForCopy(message))
                          showToast('Message copied')
                        }}
                        title="Copy Message"
                        aria-label="Copy Message"
                        style={{
                          height: 24,
                          padding: '0 7px',
                          borderRadius: 4,
                          border: '1px solid #444',
                          background: '#1f1f1f',
                          color: '#d4d4d4',
                          cursor: 'pointer',
                          fontSize: 11,
                        }}
                      >
                        Copy Message
                      </button>
                      <button
                        onClick={() => {
                          copyToClipboard(formatFileChatTurnForCopy(message, fileChatMessages))
                          showToast('Turn copied')
                        }}
                        title="Copy Turn"
                        aria-label="Copy Turn"
                        style={{
                          height: 24,
                          padding: '0 7px',
                          borderRadius: 4,
                          border: '1px solid #444',
                          background: '#1f1f1f',
                          color: '#d4d4d4',
                          cursor: 'pointer',
                          fontSize: 11,
                        }}
                      >
                        Copy Turn
                      </button>
                    </div>
                  </div>
                  {message.filePath && (
                    <div style={{
                      color: message.role === 'user' ? '#c7dff5' : '#888',
                      fontSize: 11,
                      marginBottom: 4,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {message.filePath}
                    </div>
                  )}
                  {message.role === 'assistant' ? (
                    <MarkdownRenderer
                      content={message.content}
                      codeFontSize={13}
                      wordWrap
                      padding={0}
                    />
                  ) : (
                    message.content
                  )}
                </div>
              ))
            )}
            {(fileChatPhase === 'submitting' || fileChatPhase === 'waiting') && (
              <div style={{ color: '#9cdcfe', fontSize: 12 }}>
                {fileChatPhase === 'submitting' ? 'Submitting...' : 'Waiting for answer...'}
              </div>
            )}
            {fileChatError && (
              <div style={{ color: '#f48771', fontSize: 12, whiteSpace: 'pre-wrap' }}>
                {fileChatError}
              </div>
            )}
          </div>

          <div style={{ borderTop: '1px solid #333', padding: 10, flexShrink: 0 }}>
            <textarea
              ref={fileChatQuestionRef}
              value={fileChatQuestion}
              onChange={(event) => setFileChatQuestion(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault()
                  void submitFileChatQuestion()
                }
              }}
              rows={isMobileChat ? 4 : 3}
              placeholder="Ask about this file"
              style={{
                width: '100%',
                resize: 'vertical',
                minHeight: 72,
                maxHeight: 160,
                boxSizing: 'border-box',
                background: '#111',
                border: '1px solid #444',
                borderRadius: 6,
                color: '#d4d4d4',
                padding: 8,
                fontSize: 13,
                lineHeight: 1.45,
                outline: 'none',
              }}
            />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
              <button
                onClick={insertMarkedLinesIntoChat}
                disabled={markedReferenceLines.size === 0}
                style={{
                  width: 32,
                  height: 30,
                  borderRadius: 4,
                  border: '1px solid #444',
                  background: markedReferenceLines.size > 0 ? '#252526' : '#1b1b1b',
                  color: markedReferenceLines.size > 0 ? '#9cdcfe' : '#666',
                  cursor: markedReferenceLines.size > 0 ? 'pointer' : 'default',
                }}
                title="Insert marked lines"
              >
                +
              </button>
              <button
                onClick={() => {
                  if (fileChatRunInfo) {
                    copyToClipboard(JSON.stringify(fileChatRunInfo, null, 2))
                    showToast('File chat debug info copied')
                  }
                }}
                disabled={!fileChatRunInfo}
                title="Copy file chat request id, artifact paths, target id, and diagnostics"
                style={{
                  height: 30,
                  padding: '0 8px',
                  borderRadius: 4,
                  border: '1px solid #444',
                  background: fileChatRunInfo ? '#252526' : '#1b1b1b',
                  color: fileChatRunInfo ? '#d4d4d4' : '#666',
                  cursor: fileChatRunInfo ? 'pointer' : 'default',
                  fontSize: 12,
                }}
              >
                Debug
              </button>
              <button
                onClick={() => {
                  copyToClipboard(formatFileChatThreadForCopy(fileChatMessages))
                  showToast('Thread copied')
                }}
                disabled={fileChatMessages.length === 0}
                title="Copy full file chat thread"
                aria-label="Copy Thread"
                style={{
                  height: 30,
                  padding: '0 8px',
                  borderRadius: 4,
                  border: '1px solid #444',
                  background: fileChatMessages.length > 0 ? '#252526' : '#1b1b1b',
                  color: fileChatMessages.length > 0 ? '#d4d4d4' : '#666',
                  cursor: fileChatMessages.length > 0 ? 'pointer' : 'default',
                  fontSize: 12,
                }}
              >
                Copy Thread
              </button>
              <button
                onClick={() => void submitFileChatQuestion()}
                disabled={fileChatPhase === 'submitting' || fileChatPhase === 'waiting' || fileChatQuestion.trim().length === 0}
                style={{
                  marginLeft: 'auto',
                  height: 30,
                  padding: '0 12px',
                  borderRadius: 4,
                  border: '1px solid #0e639c',
                  background: fileChatPhase === 'submitting' || fileChatPhase === 'waiting' || fileChatQuestion.trim().length === 0 ? '#333' : '#0e639c',
                  color: fileChatPhase === 'submitting' || fileChatPhase === 'waiting' || fileChatQuestion.trim().length === 0 ? '#888' : '#fff',
                  cursor: fileChatPhase === 'submitting' || fileChatPhase === 'waiting' || fileChatQuestion.trim().length === 0 ? 'default' : 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toastMsg && (
        <div style={{
          position: 'fixed',
          bottom: 80,
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#333',
          color: '#d4d4d4',
          padding: '8px 16px',
          borderRadius: 8,
          fontSize: 13,
          zIndex: 100,
          pointerEvents: 'none',
        }}>
          {toastMsg}
        </div>
      )}
    </div>
  )
}
