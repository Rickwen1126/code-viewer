# Demand-Driven Watch List — Implementation Plan

**Date**: 2026-04-11  
**Status**: Draft  
**Spec**: [spec.md](./spec.md)

---

## 目標

把目前 activation-time eager watchers 改成 frontend-derived watch list，並以最小改動保留兩種高價值 live watch：

- `file.content@path`
- `git.status@workspace`

`file.tree` 與 `tour.*` 先退回 request-only。

---

## 實作策略

這次不是重寫所有 sync flow，而是做一條新的 watcher control plane：

1. frontend 宣告 `desiredWatchSet`
2. backend aggregate 成 `effectiveWatchSet`
3. extension reconcile watcher registry

request/response 主路徑維持不變。

### 第一原則

`watch list` 的 control plane 必須遵守：

- `desiredWatchSet` 是 **per-frontend**
- `effectiveWatchSet` 是 **per-extension**
- `watch.set` 派發也是 **per-extension**

實作上絕對不可出現：

- 全局 union 後送給所有 extension
- 某個 extension 收到別的 workspace 的 watch descriptors
- 跨 extension 共用 watcher registry

---

## Phase 1: Shared contract

### 目標

把 watch list 變成正式 protocol，而不是口頭約定。

### 檔案

- `packages/shared/src/ws-types.ts`
- `packages/shared/src/__tests__/models.test.ts`

### 任務

1. 新增 `WatchDescriptor` type
2. 新增 message types
   - `watch.sync`
   - `watch.sync.result`
   - `watch.set`
3. 補 payload interfaces
4. 更新 shared tests，確保字串常數與 payload type 有覆蓋

### 完成標準

- frontend/backend/extension 都能 import 同一份 watch contract
- 不再需要 local ad-hoc watch payload shape

---

## Phase 2: Backend watch-state aggregation

### 目標

讓 backend 成為 watch list 的唯一聚合與轉發層。

### 檔案

- `backend/src/ws/manager.ts`
- `backend/src/ws/handler.ts`
- `backend/src/ws/relay.ts`
- `backend/src/__tests__/manager.test.ts`
- `backend/src/__tests__/relay.test.ts`

### 任務

1. 擴充 `FrontendEntry`
   - 新增 `desiredWatchSet`
2. 在 backend 本地處理 `watch.sync`
   - 更新 frontend 的 watch set
   - 回 `watch.sync.result`
3. 新增 aggregate helper
   - 依 `selectedExtensionId` 對多 frontend 做 union / dedupe
4. 新增 reconcile flow
   - aggregate 結果改變時，發 `watch.set` 給對應 extension
5. 補清理時機
   - frontend disconnect
   - workspace 切換
   - extension disconnect
6. 明確實作 union semantics
   - 同一 extension 下多 frontend 的 watch set 做 union / dedupe
   - 不使用最後寫入者覆蓋，也不使用 intersection
7. 明確實作 per-extension dispatch invariant
   - 每個 extension 只收到自己的 `effectiveWatchSet`
   - 不存在跨 extension 混包的 `watch.set`

### 完成標準

- backend 能對每個 extension 算出穩定的 `effectiveWatchSet`
- 多 frontend 不會互相覆蓋 watch state
- extension 不會收到不屬於自己 workspace 的 watch descriptors

### 風險

- 若 `watch.sync` 和 `connection.selectWorkspace` 順序交錯，可能出現短暫空集合
- 這是可接受的，但測試要覆蓋
- 若 background tab 沒有先送 `watch.sync([])`，短暫 zombie frontend 可能讓 watcher 多活一段時間

---

## Phase 3: Extension watcher registry

### 目標

把 eager watchers 拆掉，改成 `watch.set` 驅動的 registry。

### 檔案

- `extension/src/extension.ts`
- `extension/src/providers/file-provider.ts`
- `extension/src/providers/git-provider.ts`
- `extension/src/ws/client.ts`
- `extension/src/__tests__/*`（依需要新增）

### 任務

1. 移除 activate 時的 watcher 啟動
   - 不再在 `activate()` 直接呼叫 `startFileWatchers()`
   - 不再在 `activate()` 直接呼叫 `startGitWatchers()`
2. 新增 watch registry
   - `watchKey -> Disposable[]`
3. 新增 `watch.set` handler
   - diff 新舊 watch set
   - start 新增項目
   - dispose 消失項目
4. 重寫 `file.content` watcher 實作
   - path-scoped file system watcher
   - 僅在存在 `file.content` watches 時掛 `onDidChangeTextDocument`
5. 重寫 `git.status` watcher 實作
   - 只在存在 `git.status@workspace` 時掛 `repo.state.onDidChange()`

### 完成標準

- 沒有 watch demand 時，extension 不存在 file/git watcher
- `enabled=true` 只代表可連線，不代表自動監控

### 風險

- `onDidChangeTextDocument` 沒有 path-scoped API，所以 registry 內可能仍需一個共用 listener
- 必須確保它只在 watch count > 0 時存在

---

## Phase 4: Frontend route-derived watch sync

### 目標

讓 watch demand 真正從可見頁面推導，而不是散落在各頁自己猜。

### 檔案

- `frontend/src/services/ws-client.ts`
- `frontend/src/hooks/use-workspace.tsx`
- `frontend/src/hooks/use-websocket.ts`
- `frontend/src/pages/files/code-viewer.tsx`
- `frontend/src/pages/files/file-browser.tsx`
- `frontend/src/pages/git/index.tsx`
- `frontend/src/app.tsx` 或新增 route-aware hook

### 任務

1. 新增 frontend watch-sync helper / hook
   - 依 route + workspace + visibility 推出 `desiredWatchSet`
   - 送 `watch.sync`
2. `CodeViewerPage`
   - 保留 `file.contentChanged` 本地 listener
   - demand 來自 `file.content@path`
3. `GitChangesPage`
   - 保留 `git.statusChanged` 本地 listener
   - demand 來自 `git.status@workspace`
4. `FileBrowserPage`
   - 移除 `file.treeChanged` 訂閱
   - 維持 page-enter reload + pull-to-refresh
5. `Tours` 頁面
   - 不新增 watcher
6. workspace 切換時重新同步 watch set
7. hidden / background 時送 `watch.sync([])`
   - visible 時重新送出 route-derived watch set
8. visible 恢復時補一次頁面級 reload
   - `CodeViewerPage` 補 `file.read`
   - `GitChangesPage` 補 `git.status` / `git.log`

### 完成標準

- 前端沒有 route 對應需求時，`watch.sync` 送出空集合
- watch demand 能隨 route / path / workspace 切換而穩定更新
- hidden tab 不會長時間保留 live watch demand
- visible 恢復時不依賴 event replay，而是主動 reload 當前頁面資料

---

## Phase 5: 測試與驗證

### 單元/整合測試

1. shared message constants
2. backend aggregation
3. backend union semantics for multiple frontends targeting one extension
4. backend cleanup on disconnect / workspace switch
5. extension watch registry reconcile
6. frontend route/visibility -> watch set derivation

### 手動驗證

1. 開 2-3 個 enabled workspace，但只在 mobile 端選一個 workspace
2. 停在 Workspaces / Files list / Tours 頁時，extension 不應持有 file/git watcher
3. 打開某檔案時，只出現 `file.content@path`
4. 打開 Git 頁時，只出現 `git.status@workspace`
5. 同一 workspace 開兩個 frontend，分別看 file 與 git，extension 的 `effectiveWatchSet` 應是 union
6. 把其中一個 frontend 切到 background/hidden，watch set 應縮回剩下那個 foreground frontend 的需求
7. 離開頁面再回來時，current file / scroll restore / cache-first 行為維持不變
8. 重新 sample 熱的 `Code Helper (Plugin)`，確認 `uv_fs / FSReqCallback` 熱點下降

### E2E 補充

若這輪直接進實作，完成後要補：

- file viewer 開著時，桌面端修改同一路徑檔案，手機內容會更新
- Git 頁開著時，桌面端產生 git change，手機 Git 狀態會更新
- Files list 與 Tours 在沒有 live watch 的前提下仍能正常 request/refresh

---

## 建議切法

### Milestone A: control plane 先落地

- 完成 shared + backend + extension registry
- 先讓 eager watchers 消失

### Milestone B: frontend demand 接上

- route-derived `watch.sync`
- page-level listener 調整

### Milestone C: profile 與 UX 補縫

- 重新取樣 CPU
- 若有必要，再補 focus reload / visibility refresh 等小 UX 補丁

---

## Stop-Loss

1. 如果改成 watch list 後，extension host CPU 沒明顯下降，要重新 sample，避免把所有責任都算到 code-viewer
2. 如果 `file.content@path` 的 listener 成本仍偏高，v1 可退一步改成 focus reload，不要硬保 live update
3. 如果 backend aggregation 明顯比預期複雜，不把 `file.tree` 或 `tour` 混進 v1
