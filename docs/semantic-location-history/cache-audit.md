# Semantic Location Cache Audit

**Created**: 2026-04-12  
**Last Updated**: 2026-04-13  
**Status**: Draft

This audit exists to preserve high-value UX while semantic location moves toward URL-backed navigation truth.

## Reading Guide

- `canonical location`: 應由 URL / browser history 表達的語義位置
- `convenience restore`: 不決定 correctness，但能提升 UX 的 restore 行為
- `preference`: 使用者偏好
- `performance cache`: 為了 cache-first / offline-friendly 體感
- `transient`: 只屬於當下 UI，不應升格為 canonical

## Current Behavior Matrix

| Surface | Storage / Key | Source | UX | Type | Phase 1 | Replacement path |
|---|---|---|---|---|---|---|
| Initial redirect | `code-viewer:selected-workspace` | `frontend/src/app.tsx` | App 進來時先回上次 workspace | convenience restore | keep | 目前已透過 stored workspace snapshot + `workspaceKey` 讀取 current-file；後續可再演進成 last semantic location snapshot |
| Initial redirect | `code-viewer:current-file:${workspaceKey}` | `frontend/src/app.tsx`, `frontend/src/pages/files/code-viewer.tsx` | App 進來時直接回 selected workspace 的上次檔案 | convenience restore | keep | 目前已改成 stable workspace key；之後可改成從 canonical file URL / last-location snapshot 重建 |
| Initial redirect migration fallback | `code-viewer:current-file:${extensionId}` / `code-viewer:current-file` | `frontend/src/app.tsx`, `frontend/src/services/current-file.ts` | 舊資料仍可讀取，不打斷升級 | migration fallback | keep-temporarily | 不再寫入；Phase 2 後段再評估何時完全移除 |
| Workspace rebind | `code-viewer:selected-workspace` | `frontend/src/hooks/use-workspace.tsx` | reload / reconnect 後自動重新 select workspace | convenience restore | keep | 目前已改為先 `listWorkspaces` 再用 `workspaceKey`/`rootPath` resolve live workspace，不再直接信任 cached `extensionId` |
| Recent files | `code-viewer:recent-files` | `frontend/src/pages/files/file-browser.tsx` | 最近檔案捷徑 | convenience restore | keep | 不被 URL 取代；屬高價值 convenience |
| Current file marker | `code-viewer:current-file:${workspaceKey}` | `frontend/src/app.tsx`, `frontend/src/pages/files/file-browser.tsx`, `frontend/src/pages/files/code-viewer.tsx` | File Browser 高亮目前檔案、展開路徑、每個 workspace 記住最後檔案 | convenience restore | keep | 目前已改成 stable workspace key；未來可改為 last semantic location snapshot |
| Expanded directories | `code-viewer:expanded-dirs` | `frontend/src/pages/files/file-browser.tsx` | File Browser 記住展開狀態 | convenience restore | keep | 不需 URL 化，維持 local convenience |
| File scroll restore | `code-viewer:scroll:${extensionId}:${path}` | `frontend/src/pages/files/code-viewer.tsx` | 再次打開同檔案時回到上次看的位置 | convenience restore | keep-as-fallback | canonical `line/endLine` 會處理精準 location；scroll restore 留作 reopen fallback |
| File location from navigation | `location.state.scrollToLine` | `frontend/src/pages/files/code-viewer.tsx` | 點 jump / View in Code 時跳到指定行 | canonical location candidate | removed-in-phase-2 | 已由 `/files/:path?line=&endLine=` 取代；不再作為 location truth |
| File content cache | IndexedDB `file-content` | `frontend/src/services/cache.ts`, `frontend/src/pages/files/code-viewer.tsx` | cache-first 顯示檔案內容 | performance cache | keep | 與 semantic URL 並存，不衝突 |
| File tree cache | IndexedDB `file-tree` | `frontend/src/services/cache.ts`, `frontend/src/pages/files/file-browser.tsx` | cache-first 顯示 tree | performance cache | keep | 與 semantic URL 並存，不衝突 |
| Workspace list cache | IndexedDB `workspaces` | `frontend/src/services/cache.ts` | 離線或 reconnect 前先顯示 workspace list | performance cache | keep | 與 semantic URL 並存，不衝突 |
| Git status cache | IndexedDB `git-status` | `frontend/src/services/cache.ts`, `frontend/src/pages/git/index.tsx` | cache-first 顯示 Git page | performance cache | keep | 與 semantic URL 並存，不衝突 |
| Chat session cache | IndexedDB `chat-sessions` | `frontend/src/services/cache.ts`, `frontend/src/pages/chat/conversation.tsx` | chat 離線重開可看舊 session | performance cache | keep | 不在這次 location migration 範圍內 |
| Chat file auto-attach | `code-viewer:current-file:${workspaceKey}` | `frontend/src/pages/chat/conversation.tsx` | new chat 自動附上目前 workspace 的目前檔案 | convenience restore | keep | 目前已改成 workspace-scoped current-file，避免跨 workspace 污染 |
| Tour progress | `tour-progress:${extensionId}:${tourId}` | `frontend/src/pages/tours/tour-detail.tsx`, `frontend/src/pages/tours/index.tsx` | 從 Tour list reopen 時回到上次 step | convenience restore | keep-as-entry-fallback | `/tours/:tourId?step=` 已是 canonical；localStorage 只保留給列表入口 resume convenience |
| Word wrap | `code-viewer:wrap-enabled` | `frontend/src/pages/files/code-viewer.tsx` | 保留閱讀偏好 | preference | keep | 不需 URL 化 |
| Markdown mode | `code-viewer:md-view-mode` | `frontend/src/pages/files/code-viewer.tsx` | 保留 rendered/raw 偏好 | preference | keep | 不需 URL 化 |
| Font size | `code-viewer:font-size` | `frontend/src/components/code-block.tsx` | 保留 pinch zoom 字級 | preference | keep | 不需 URL 化 |

## Known Composite UX

### Recent file 點進去後回到上次看的位置

這不是單一 key 的效果，而是至少三層共同形成：

1. `code-viewer:recent-files`
   - 讓使用者能重新點到該檔案
2. `code-viewer:current-file:${workspaceKey}`（migration 期間仍可讀舊 key）
   - 讓系統知道目前檔案與 workspace 對應
3. `code-viewer:scroll:${extensionId}:${path}`
   - `CodeViewerPage` 在沒有 `scrollToLine` 時恢復舊 scrollTop

Phase 1 不應破壞這個組合。即使 file location 之後 URL 化，scroll restore 仍應保留為 fallback / convenience restore。

### App 重新打開時直接回到上次 workspace + file

這也是組合行為：

1. `code-viewer:selected-workspace`
2. `code-viewer:current-file:${workspaceKey}`
3. migration fallback：`code-viewer:current-file:${extensionId}` / `code-viewer:current-file`

`app.tsx` 的 `InitialRedirect` 目前直接依賴這組資料。Phase 1 若改入口路由，必須明確保留或等價重建。

## Early Classification

### 評估原則

每個項目都要用這個問題來判斷，不是問「舊 code 要不要留」，而是問：

1. 這個行為對使用者真的有價值嗎？
2. 新的 semantic URL / browser history contract 能不能更直接地 cover 它？
3. 如果能，舊機制是該：
   - 移除
   - 降級 fallback
   - 或保留成 preference / performance cache

### 應升格為 URL 真相

- file path + line + endLine
- tour id + current step
- git diff target path + commit/status context

### 應保留為 fallback / convenience

- per-file scroll restore
- recent files
- current file memory for app reopen
- expanded dirs
- selected workspace for reconnect

### 應保留為 preference

- wrap
- markdown mode
- font size

### 不應升格成 canonical URL

- search panel open state
- hover popover
- toast state
- Step+ toggle

## Migration Guardrails

1. 不可在 Phase 1 直接刪除 `code-viewer:scroll:*`
   - 它目前承載了「回到上次看的位置」這個高價值 UX
2. 不可在沒有替代入口 restore 的情況下拿掉 `InitialRedirect` 所依賴的 current-file keys
3. Tour 的 local progress 在 step URL 真正落地前，不可直接移除
4. 偏好型 storage 不應和 location migration 一起清理

## Phase 2 Progress

### Completed in current slice

- `location.state.scrollToLine`
  - 已從 file location primary truth 移除
  - canonical file URL 現在是唯一的 semantic location 來源
  - reopen / scroll convenience restore 仍保留，不受這刀影響

- `tour-progress:${extensionId}:${tourId}`
  - 已不再作為 `TourDetailPage` route truth
  - canonical tour URL 現在是唯一 step location 來源
  - localStorage 只保留給 Tour list reopen convenience

- `code-viewer:current-file:${workspaceKey}`
  - 已成為 current-file convenience restore 的 primary key
  - 舊的 `:${extensionId}` 與 global key 只保留讀取 fallback，不再寫入
  - 這讓 app reopen / file highlight / chat auto-attach 不再跨 workspace 污染

- `code-viewer:selected-workspace`
  - reconnect / reload 已改為 stable identity resolve
  - persisted snapshot 仍保留，但 `extensionId` 不再被直接當作 selection authority
  - 這讓 VS Code restart 後的 workspace rebind 不再依賴舊 runtime id
