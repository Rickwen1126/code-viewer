import { useState, useEffect, useRef, useCallback } from 'react'
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
import { getBookmarkedLines, addBookmark, removeBookmark, getBookmarksForFile } from '../../services/bookmarks'
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
  const annotationPollSeqRef = useRef(0)

  const previewKind = getFilePreviewKind(path)
  const activeFilePath = annotationMode === 'annotated' && annotationExists && annotationPath
    ? annotationPath
    : path
  const isAnnotationView = activeFilePath !== path
  const isMarkdown = file?.languageId === 'markdown'

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

  // Bookmarks state
  const [bookmarkedLines, setBookmarkedLines] = useState<Set<number>>(new Set())

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

  // Load bookmarks when file changes
  useEffect(() => {
    if (!workspace || !path) return
    setBookmarkedLines(getBookmarkedLines(workspace.extensionId, path))
  }, [workspace, path])

  // Line number click — Step+ ON: open add-step overlay; OFF: toggle bookmark
  const handleLineNumberClick = useCallback((lineNum: number) => {
    if (!workspace || !path || !file || isAnnotationView) return

    if (tourEdit && stepModeActive) {
      // Step+ is ON: open add step overlay
      setAddStepLine(lineNum)
      if (navigator.vibrate) navigator.vibrate(50)
      return
    }

    // Step+ is OFF: toggle bookmark
    const contentLines = file.content.split('\n')
    const preview = contentLines[lineNum - 1] ?? ''

    if (bookmarkedLines.has(lineNum)) {
      removeBookmark(workspace.extensionId, path, lineNum)
      setBookmarkedLines(prev => { const next = new Set(prev); next.delete(lineNum); return next })
      showToast(`Bookmark removed (line ${lineNum})`)
    } else {
      addBookmark(workspace.extensionId, path, lineNum, preview)
      setBookmarkedLines(prev => new Set(prev).add(lineNum))
      showToast(`Bookmarked line ${lineNum}`)
    }
    if (navigator.vibrate) navigator.vibrate(50)
  }, [workspace, path, file, bookmarkedLines, tourEdit, stepModeActive, isAnnotationView])

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
      debugLog('annotation', 'status.response', {
        requestId: res.replyTo,
        generationId: res.payload.generationId ?? null,
        path: res.payload.path,
        annotationPath: res.payload.annotationPath,
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
        debugLog('annotation', 'poll.response', {
          requestId: res.replyTo,
          generationId: res.payload.generationId ?? generationId,
          sourcePath,
          annotationPath: res.payload.annotationPath,
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
      debugLog('annotation', 'generate.submitted', {
        requestId: res.replyTo,
        generationId: res.payload.generationId,
        submittedAt: res.payload.submittedAt,
        path: res.payload.path,
        annotationPath: res.payload.annotationPath,
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
    annotationSubmittedAt ? `submitted: ${new Date(annotationSubmittedAt).toLocaleTimeString()}` : null,
  ].filter(Boolean).join(' | ') || undefined
  const stackFileActions = annotationExists || isAnnotationView

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
          {bookmarkedLines.size > 0 && (
            <span style={{ fontSize: 11, color: '#e2b93d' }}>
              &#x2605;{bookmarkedLines.size}
            </span>
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
              bookmarkedLines={bookmarkedLines}
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
