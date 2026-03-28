# Frontend Features — Markdown Preview, Session Resilience, Bookmarks, Search

**Date**: 2026-03-26
**Status**: Approved
**Scope**: Frontend-only features (pure frontend except grep which needs extension handler)

---

## Overview

Four independent features for the mobile-first code viewer (iPhone 390x844, dark theme). All share the same codebase (`frontend/src/`) and follow existing patterns.

| Feature | Scope | New deps | Backend changes |
|---------|-------|----------|-----------------|
| Markdown Preview | Frontend | `marked` | None |
| Session Resilience | Frontend | None | None |
| Bookmarks | Frontend | None | None |
| In-file Search | Frontend | None | None |
| Grep (full-repo) | Frontend + Extension | None | New `file.search` WS message |

---

## Feature 1: Markdown Preview

### What

When viewing a `.md` file, render it as formatted markdown by default. Toggle between raw (syntax-highlighted code) and rendered views.

### Design

**Detection**: Check `languageId === 'markdown'` in `code-viewer.tsx`.

**Toggle button**: Add `Raw` / `Rendered` button in header, same style as existing `Wrap` toggle:
- Inactive: transparent bg, `#444` border, `#888` text
- Active: `#333` bg, `#444` border, `#d4d4d4` text
- Only visible for `.md` files
- Default: `Rendered`

**Rendered view** — styled for dark theme:

| Element | Style |
|---------|-------|
| H1 | 24px, `#569cd6` (blue), bold, 16px margin-bottom |
| H2 | 20px, `#569cd6`, bold, 12px margin-bottom |
| H3 | 16px, `#d4d4d4`, bold, 8px margin-bottom |
| Body | 14px, `#d4d4d4`, line-height 1.6, 12px margin-bottom |
| Inline code | `#4ec9b0` (green), bg `#252526`, 2px 6px padding |
| Code blocks | Reuse existing `CodeBlock` component (Shiki highlighting) |
| Links | `#569cd6`, underlined |
| Blockquote | 3px left border `#569cd6`, 12px left padding, `#888` text |
| Lists | 8px left padding per nesting level |
| HR | 1px solid `#333` |

**Library**: `marked` for parsing markdown to tokens. Custom React renderer maps tokens to styled components. Code blocks delegate to existing `CodeBlock`.

**Persistence**: `localStorage` key `code-viewer:md-view-mode` → `'raw' | 'rendered'` (global, not per-file).

**In-file search in rendered mode**: Auto-switch to raw view when search is activated. Search always operates on raw content.

### Component Structure

```
code-viewer.tsx
  ├── (header with Raw/Rendered toggle — only for .md)
  ├── if rendered: <MarkdownRenderer content={content} />
  └── if raw: <CodeBlock ... /> (existing)

components/markdown-renderer.tsx (NEW)
  ├── Uses marked.lexer() to parse
  ├── Maps tokens to React elements
  └── Delegates code blocks to <CodeBlock />
```

---

## Feature 2: Session Resilience

### What

Preserve view state across WS disconnects, mobile app backgrounding, and page reloads. Show appropriate visual feedback for stale/offline states.

### Design

**State to persist** (all in `localStorage`):

| State | Key | Scope | Trigger |
|-------|-----|-------|---------|
| Current file path | `code-viewer:current-file:{extensionId}` | Per-workspace | On file open |
| Scroll position | `code-viewer:scroll:{extensionId}:{path}` | Per-file | Debounce 500ms on scroll |
| Word wrap | `code-viewer:wrap-enabled` | Global | On toggle |
| Font size (pinch) | `code-viewer:font-size` | Global | On pinch end. Note: requires lifting fontSize state out of `CodeBlock` to `code-viewer.tsx` — `CodeBlock` currently owns this state internally. Pass `fontSize` + `onFontSizeChange` props instead. |
| Markdown view mode | `code-viewer:md-view-mode` | Global | On toggle |

**Restore flow** (on `code-viewer.tsx` mount):
0. Read current file path from localStorage → if cached content exists in IndexedDB → **render immediately** (no grey screen, no WS wait)
1. Read wrap, font size, md-view-mode from localStorage → set state
2. After content renders, read scroll position → `scrollContainerRef.current.scrollTop = saved`
3. If content changed (hash mismatch), skip scroll restore

**Scroll cleanup**: Entries older than 7 days are purged on mount (iterate keys, check timestamp).

**Content change detection**: Store `contentLength` alongside `scrollTop`. Skip restore if length changed by >10% (no content hash — simple heuristic).

**Disconnect duration tracking**: `ConnectionStatus` component or `WsClientService` needs a `disconnectedSince: number | null` timestamp to drive the tiered UX. Set on disconnect, clear on reconnect.

**Disconnection UX** (modify `connection-status.tsx`):

| Duration | Visual |
|----------|--------|
| < 2s | Silent (no change) |
| 2–5s | Pulsing blue 3px bar (existing) |
| > 5s | 3px bar + small "Reconnect" button in bar |
| > 30s | Bar + "Connection lost. Tap to retry" |

**Cache staleness indicator**: When displaying cached content while disconnected, show subtle timestamp in file header:
```
src/index.ts  [TypeScript]  Cached 3m ago  [Wrap]
```
Style: `#888`, 10px, italic. Hidden when connected.

**Reconnect flow** (already mostly works):
1. Auto-reconnect on `visibilitychange` (existing)
2. On reconnect: re-send `selectWorkspace` (existing), silently refresh current file
3. Restore scroll position after refresh
4. Brief toast "Synced" (1.5s, fade-out) — optional, low priority

---

## Feature 3: Bookmarks

### What

Bookmark specific file + line locations for quick access. Persisted per-workspace in localStorage.

### Data Model

```typescript
interface Bookmark {
  path: string      // relative file path
  line: number      // 1-based line number
  preview: string   // first ~60 chars of the line content (for display)
  createdAt: number // timestamp
}
```

**Storage**: `localStorage` key `code-viewer:bookmarks:{extensionId}` → `Bookmark[]` (JSON)

### Interactions

**Add bookmark**: Long-press on line number gutter (>300ms).
In wrap mode (CSS counter line numbers, no separate gutter div), long-press on the line area's left edge (first 40px). Both modes must support bookmarking.
1. Haptic feedback (`navigator.vibrate(50)` if available)
2. Toast: "Bookmarked line {N}" (1.5s, bottom, fade-out)
3. Gutter updates immediately (★ prefix)

**Remove bookmark**: Long-press bookmarked line → toast "Bookmark removed"

**View bookmarks**: In file browser search dropdown (when input focused, no query):
```
★ BOOKMARKS (3)
─────────────────
★ code-viewer.tsx
  src/pages/files           :42
─────────────────
★ file-browser.tsx
  src/pages/files          :204
─────────────────
RECENT (8)
─────────────────
app.tsx
  src/pages
```

Tap bookmark → navigate to file at line with 3.5s highlight animation (reuse existing `scrollToLine`).

### Visual Indicators

**Gutter** (in code view): Bookmarked lines show `★` before line number in `#e2b93d` (gold).

**File header badge**: When current file has bookmarks, show `★{count}` badge:
```
app.tsx  [js]  ★3  [Wrap] [Symbols]
```
Style: `#e2b93d`, 11px, same row as language label.

### Component Changes

```
code-viewer.tsx
  ├── Pass bookmarkedLines={Set<number>} to CodeBlock
  ├── Add long-press handler on gutter area
  └── Add ★ badge in header

code-block.tsx
  ├── Accept bookmarkedLines prop
  └── Render ★ prefix + gold color for bookmarked lines

file-browser.tsx
  └── Add BOOKMARKS section above RECENT in search dropdown

services/bookmarks.ts (NEW)
  ├── getBookmarks(extensionId): Bookmark[]
  ├── addBookmark(extensionId, path, line, preview): void
  ├── removeBookmark(extensionId, path, line): void
  └── getBookmarksForFile(extensionId, path): Bookmark[]
```

---

## Feature 4: File Content Search

Two tiers: **in-file search** (pure frontend) and **grep** (VS Code API).

### 4a: In-File Search

**What**: Find text within the currently open file. Pure frontend, zero backend.

**UI**: Search bar slides down from header in code viewer:
```
┌──────────────────────────────────────┐
│ src/index.ts  [ts]  [Wrap] [🔍]     │  ← tap 🔍 opens search
├──────────────────────────────────────┤
│ [search input...] [↑] [↓] [✕] 3/12 │  ← search bar (44px)
├──────────────────────────────────────┤
│ code content with highlights...      │
```

**Behavior**:
- Tap 🔍 icon in header → search bar appears (slide down, 200ms)
- Type → instant highlight all matches in code (background `#e2b93d33`, border `#e2b93d`)
- Current match: stronger highlight (`#e2b93d66`)
- `↑` / `↓` buttons: cycle through matches, auto-scroll to current
- Match count: `{current}/{total}` display
- `✕` or swipe-right: close search bar, clear highlights
- Case-insensitive by default (no toggle for MVP)

**Implementation**:
- Simple `string.indexOf()` loop on the file content (already in memory)
- **Highlight strategy: DOM manipulation** — inject `<mark>` elements or use CSS Custom Highlight API after Shiki render. Avoid Shiki transformer (would re-parse on every keystroke, too slow for large files).
- Match positions: `{ line: number, startCol: number, endCol: number }[]`

### 4b: Grep (Full-Repo Search)

**What**: Search text across all files in workspace. Uses VS Code `findTextInFiles()` API.

**New WS Message**:

```typescript
// ws-types.ts additions
export const MSG_FILE_SEARCH = 'file.search' as const
export const MSG_FILE_SEARCH_RESULT = 'file.search.result' as const
export const MSG_FILE_SEARCH_ERROR = 'file.search.error' as const

export interface FileSearchPayload {
  query: string
  limit?: number      // default 50
  useRegex?: boolean   // default false
}

export interface FileSearchResultPayload {
  results: Array<{
    path: string
    line: number
    character: number
    preview: string    // line content with match
  }>
  total: number        // total matches (may exceed limit)
}
```

**Extension handler**: `handleFileSearch()` in `file-provider.ts`:
- Use VS Code search API (`workspace.findTextInFiles` or its current replacement — check API docs as this was deprecated in VS Code 1.95)
- Cap results at `limit`
- Return file path (relative), line, character, preview text

**UI**: Mode toggle in file browser search bar:

```
┌──────────────────────────────────────┐
│ [FILE ▾] [search input...] [Cancel] │  ← mode selector dropdown
├──────────────────────────────────────┤
│ Results:                             │
│ src/services/cache.ts:95             │
│   const setFileContent = (…          │  ← matching text highlighted
├──────────────────────────────────────┤
│ frontend/src/lib/cache.ts:42         │
│   async getFileTree() {              │
```

**Mode toggle**: Dropdown or segmented control with two options:
- **FILE** — current filename fuzzy search (instant, local)
- **CONTENT** — full-text search via extension (debounced 300ms)

**Result item**:
- Line 1: file path + `:line` — tappable, `#569cd6`
- Line 2: code snippet (monospace, 12px, match highlighted in `#e2b93d`)
- Tap → navigate to file at line + 3.5s highlight

**Loading state**: Spinner replaces results while searching. "No results" if empty.

**Error handling**: If extension offline, show "Search unavailable — extension disconnected"

### Search Component Structure

```
code-viewer.tsx
  └── Add 🔍 button in header → toggles InFileSearch

components/in-file-search.tsx (NEW)
  ├── Search input + prev/next/close buttons
  ├── Match count display
  └── Communicates highlight positions to CodeBlock

file-browser.tsx
  ├── Add mode toggle (FILE/CONTENT) to search bar
  ├── CONTENT mode: debounced WS request + results display
  └── SearchResultItem component for content results

extension/src/providers/file-provider.ts
  └── Add handleFileSearch() using vscode.workspace.findTextInFiles()

extension/src/extension.ts
  └── Register 'file.search': handleFileSearch
```

---

## Error Codes (for grep)

| Code | When |
|------|------|
| `NOT_CONNECTED` | Extension offline |
| `TIMEOUT` | Search took >30s |
| `INVALID_REQUEST` | Empty query |

Reuse existing `ErrorCode` values — no new codes needed.

---

## Implementation Priority

All 4 features are independent. Suggested order by impact/effort ratio:

1. **Session Resilience** — fixes existing pain point, smallest change, highest UX impact
2. **In-file Search** — pure frontend, small scope, high utility
3. **Markdown Preview** — new capability, moderate scope
4. **Bookmarks** — new capability, moderate scope
5. **Grep** — needs extension handler, largest scope

Features 1–4 are pure frontend and can be parallelized. Feature 5 needs extension + shared types changes first.

---

## Testing

- All features: Vitest unit tests for services/utilities
- All UI: Manual verification at 390x844 iPhone viewport
- Grep: Integration test via WS (same pattern as `test-tour-handlers.mjs`)
- Session resilience: Test on real iPhone (Safari background/foreground cycle)
