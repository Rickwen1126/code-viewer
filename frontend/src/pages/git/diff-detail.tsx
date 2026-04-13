import { useState, useEffect } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router'
import { useWebSocket } from '../../hooks/use-websocket'
import { DiffView } from '../../components/diff-view'
import {
  buildAddedFileHunks,
  shouldLoadAddedFileTextFallback,
  shouldLoadGitMediaPreview,
} from './diff-detail-utils'
import { buildFileLocationUrl } from '../../services/file-location'
import { buildGitDiffUrl, createDetourAnchor, mergeDetourState } from '../../services/semantic-navigation'
import { createObjectUrlFromBase64, formatPreviewSize } from '../../services/file-preview'
import type {
  FilePreviewResultPayload,
  GitDiffResultPayload,
  FileReadResultPayload,
} from '@code-viewer/shared'
import { getFilePreviewKind } from '@code-viewer/shared'

function getPrimaryCodeLine(
  hunks: GitDiffResultPayload['hunks'],
): number | undefined {
  for (const hunk of hunks) {
    for (const change of hunk.changes) {
      if (change.newLineNumber != null) {
        return change.newLineNumber
      }
    }
    if (hunk.newStart > 0) {
      return hunk.newStart
    }
  }
  return undefined
}

export function GitDiffDetailPage() {
  const { '*': rawPath } = useParams()
  const [searchParams] = useSearchParams()
  const path = rawPath ? decodeURIComponent(rawPath) : ''
  const commit = searchParams.get('commit') ?? undefined
  const status = searchParams.get('status') ?? undefined
  const { request, connectionState } = useWebSocket()
  const navigate = useNavigate()
  const [diff, setDiff] = useState<GitDiffResultPayload | null>(null)
  const [addedFileContent, setAddedFileContent] = useState<FileReadResultPayload | null>(null)
  const [preview, setPreview] = useState<FilePreviewResultPayload | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const previewKind = getFilePreviewKind(path)

  useEffect(() => {
    if (!path) return
    if (connectionState !== 'connected') {
      setLoading(false)
      return
    }
    loadDiff()
  }, [path, connectionState, commit, status])

  useEffect(() => {
    if (!preview) return
    const objectUrl = createObjectUrlFromBase64(preview.mimeType, preview.data)
    setPreviewUrl(objectUrl)
    return () => {
      URL.revokeObjectURL(objectUrl)
    }
  }, [preview])

  async function loadDiff() {
    try {
      setLoading(true)
      setError(false)
      setAddedFileContent(null)
      setPreview(null)
      setPreviewError(null)
      setPreviewUrl(null)
      const res = await request<{ path: string; commit?: string }, GitDiffResultPayload>('git.diff', { path, commit })
      setDiff(res.payload)
      const hasDiffHunks = res.payload.hunks.length > 0
      if (shouldLoadGitMediaPreview({ previewKind, commit, status, hasDiffHunks })) {
        try {
          const previewRes = await request<{ path: string }, FilePreviewResultPayload>('file.preview', { path })
          setPreview(previewRes.payload)
        } catch {
          setPreviewError('Binary/media diff is unavailable. Use View in Code to inspect the current file.')
        }
      } else if (shouldLoadAddedFileTextFallback({ previewKind, commit, status, hasDiffHunks })) {
        try {
          const fileRes = await request<{ path: string }, FileReadResultPayload>('file.read', { path })
          setAddedFileContent(fileRes.payload)
        } catch {
          // Fall back to empty diff state
        }
      }
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  const fileName = path.split('/').pop() ?? path
  const hunks = diff?.hunks.length ? diff.hunks : addedFileContent ? buildAddedFileHunks(addedFileContent.content) : []
  const isEmptyAddedFile = status === 'added' && addedFileContent?.content === '' && diff?.hunks.length === 0
  const showMediaPreview = preview != null && previewUrl != null && diff?.hunks.length === 0
  const showMediaEmptyState = !showMediaPreview && previewKind != null && diff?.hunks.length === 0
  const canViewInCode = status !== 'deleted'
  const viewInCodeUrl = buildFileLocationUrl(path, { line: getPrimaryCodeLine(hunks) })
  const diffUrl = buildGitDiffUrl(path, { commit, status })

  function renderMediaContent() {
    if (loading) {
      return <div style={{ padding: 16, color: '#888' }}>Loading diff...</div>
    }

    if (error) {
      return (
        <div style={{ padding: 16, color: '#f48771' }}>
          Failed to load diff. Make sure the extension is connected.
        </div>
      )
    }

    if (!diff) {
      return <div style={{ padding: 16, color: '#888' }}>No diff available.</div>
    }

    if (showMediaPreview) {
      return (
        <div
          style={{
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            minHeight: '100%',
            background: '#111',
          }}
        >
          <div
            style={{
              padding: '10px 12px',
              border: '1px solid #2a2a2a',
              borderRadius: 8,
              background: '#181818',
            }}
          >
            <div style={{ fontSize: 12, color: '#d4d4d4', marginBottom: 4 }}>
              Binary/media diff is unavailable. Showing the current workspace preview instead.
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#888' }}>
              <span>{preview.mimeType}</span>
              <span>{formatPreviewSize(preview.size)}</span>
            </div>
          </div>
          <div
            style={{
              flex: 1,
              minHeight: 280,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 8,
            }}
          >
            {preview.kind === 'image' ? (
              <img
                src={previewUrl}
                alt={fileName}
                style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 8 }}
              />
            ) : (
              <video
                src={previewUrl}
                controls
                playsInline
                preload="metadata"
                style={{ width: '100%', maxHeight: '100%', background: '#000', borderRadius: 8 }}
              />
            )}
          </div>
        </div>
      )
    }

    const message = previewError
      ?? (status === 'deleted'
        ? 'Preview unavailable for deleted media files.'
        : commit
          ? 'Preview is only available for current workspace media files, not commit-scoped diffs.'
          : 'Preview unavailable for this media file.')

    return (
      <div style={{ padding: 16, color: '#888' }}>
        <div style={{ fontSize: 14, color: '#d4d4d4', marginBottom: 8 }}>No textual diff available.</div>
        <div style={{ fontSize: 12 }}>{message}</div>
      </div>
    )
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
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
        <button
          onClick={() => navigate(-1)}
          style={{
            background: 'none',
            border: 'none',
            color: '#569cd6',
            fontSize: 20,
            cursor: 'pointer',
            padding: '0 4px',
            lineHeight: 1,
          }}
          aria-label="Back"
        >
          ‹
        </button>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <div
            style={{
              fontSize: 13,
              color: '#d4d4d4',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {fileName}
          </div>
          {path !== fileName && (
            <div
              style={{
                fontSize: 11,
                color: '#888',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {path}
            </div>
          )}
          {commit && (
            <div style={{ fontSize: 10, color: '#569cd6', fontFamily: 'monospace' }}>
              {commit.slice(0, 7)}
            </div>
          )}
        </div>
        {canViewInCode && (
          <button
            onClick={() => navigate(viewInCodeUrl, {
              state: mergeDetourState(createDetourAnchor('git-diff', diffUrl)),
            })}
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
            View in Code
          </button>
        )}
      </div>

      {/* Diff content */}
      <div style={{ flex: 1, overflow: 'auto', WebkitOverflowScrolling: 'touch' }}>
        {loading ? (
          <div style={{ padding: 16, color: '#888' }}>Loading diff...</div>
        ) : error ? (
          <div style={{ padding: 16, color: '#f48771' }}>
            Failed to load diff. Make sure the extension is connected.
          </div>
        ) : !diff ? (
          <div style={{ padding: 16, color: '#888' }}>No diff available.</div>
        ) : showMediaEmptyState ? (
          renderMediaContent()
        ) : isEmptyAddedFile ? (
          <div style={{ padding: 16, color: '#888' }}>New file is empty.</div>
        ) : (
          <DiffView hunks={hunks} />
        )}
      </div>
    </div>
  )
}
