# Demand-Driven Watch List

**Date**: 2026-04-11  
**Status**: Proposed  
**Scope**: `frontend`、`backend`、`extension` 的 watcher lifecycle 與同步協定調整。v1 不改產品主路徑的 request/response 模型。

---

## 為什麼需要這份 spec

目前 Code Viewer 的 sync model 有明顯漂移：

- extension 在 activate 後就常駐啟動 file watcher / git watcher
- frontend 的 `subscribe()` 只是本地 listener，不是跨邊界 demand signal
- `connection.selectWorkspace` 只負責 routing，卻間接成了 eager watcher 的放大器

結果是：

- 即使 frontend 沒有正在看 files / git，extension host 仍會被 workspace 事件持續喚醒
- 多個 enabled workspace 同時開著時，成本按 workspace 數量放大
- `Code Helper (Plugin)` 高 CPU 的熱點落在 filesystem callback，而不是 backend relay

這份 spec 的目的，是把「誰真的需要即時監控」正式表達成 protocol，而不是繼續讓 extension 自己猜。

---

## 問題定義

### 現況問題

1. **demand 與 watcher lifecycle 脫鉤**
   - extension 的 watcher 在 activate 時就啟動，與當前 route、可見頁面、已開檔案無關
2. **watch scope 太大**
   - file tree 目前用 workspace-wide `**/*` watcher
3. **routing signal 被誤用**
   - `selected workspace` 只回答「request 該送去哪」，不回答「現在該 watch 什麼」
4. **產品需求與監控強度不匹配**
   - code-viewer 主要是 mobile read/inspect 工具，不需要 desktop-grade 全域 live mirroring

### 真正要修的不是什麼

- 不是單純調 debounce
- 不是只靠縮小 glob pattern
- 不是把 `selected workspace` 當新的 watcher gating

真正要修的是：**watcher 是否存在，必須由 frontend demand 決定。**

---

## 目標

1. 讓 frontend 成為 watch demand 的唯一來源
2. 讓 backend 成為 watch list 的集中管理層與 aggregate 層
3. 讓 extension 只為目前有效 demand 建立 watcher；沒有 demand 時，watcher 根本不存在
4. 保留 request/response 作為主路徑；只有 stale 真的會傷 UX 的資料才保留 live watch
5. 讓多個 workspace 同時開著時，未被需求命中的 workspace 保持接近 idle

## 非目標

1. v1 不追求所有頁面都保留 live update
2. v1 不實作 generic `file.tree` live watch
3. v1 不讓 `tour.*` 進入 watch scope
4. 不以 process-level singletons 或 hidden globals 偷偷保留 eager watcher

---

## 設計原則

### 0. Watch list 是 per-extension contract，絕不能跨 extension 混包

這是本設計的第一條不可違反原則：

- backend 對 frontend 保存的是 `desiredWatchSet + selectedExtensionId`
- backend 對 extension 發送的是該 extension 自己的 `effectiveWatchSet`
- **任何 extension 都只能收到屬於自己 workspace 的 watch descriptors**

明確禁止：

- 把多個 workspace / extension 的 watch demand 合併成同一包 `watch.set`
- 讓某個 extension 收到另一個 workspace 的 `file.content@path`
- 讓全局 watcher state 跨 extension 共用

如果違反這條，後果不只是效能問題，而是 contract 本身錯誤：

- extension 會收到與自己無關的 path / topic
- watcher registry 的責任邊界會崩掉
- debugging 會從「看這個 extension 的 effectiveWatchSet」退化成「猜全局狀態到底怎麼混進來」

### 1. Routing signal 不等於 demand signal

- `connection.selectWorkspace` 只負責 relay routing
- `watch list` 才是「這個 frontend 現在需要什麼 live data」

### 2. Watch list 控制的是 watcher existence，不是 callback ignore

不可接受的做法：

- extension 永遠掛著 `**/*`
- callback 進來後才查 watch list 決定要不要 return

可接受的做法：

- extension 只為 active watch descriptors 建 watcher / listener
- watch descriptor 消失就 dispose

### 3. V1 先保留高價值 live watch

只有「目前可見且 stale 真的會誤導使用者」的資料，才有資格留在 watch set。

---

## V1 watch scope 收斂

### 保留 live watch

#### `file.content@path`

用途：

- 使用者正在看某個檔案內容
- 桌面端對同一檔案的 dirty buffer 或儲存行為，可能讓手機持續看到舊內容

scope：

- 單一 workspace
- 單一路徑 `path`

#### `git.status@workspace`

用途：

- 使用者正在看 Git 頁面
- branch / changed files stale 會直接影響判斷

scope：

- 單一 workspace

### 暫時回到 request-only

#### `file.tree`

原因：

- stale 會造成不便，但通常不會嚴重誤導
- 它也是目前最肥、最容易放大成 filesystem storm 的 watcher
- v1 先改成 page-enter reload / pull-to-refresh

#### `tour.*`

原因：

- 目前以 tab/page 進入時 request 即可
- 沒有充分證據顯示需要 live watch

---

## Watch model

### Frontend：宣告 `desiredWatchSet`

frontend 依照以下來源推導當前需求：

- `selectedWorkspaceId`
- `activeRoute`
- `activeFilePath?`

v1 對 route 的映射：

| Route / Context | desired watches |
|---|---|
| `/files/:path` | `file.content@path` |
| `/git` | `git.status@workspace` |
| `/files` | `[]` |
| `/tours*` | `[]` |
| 沒有 selected workspace | `[]` |

frontend 每次 route 或 workspace 變更時，送出**完整** `desiredWatchSet`，而不是零碎 `start/stop` 指令。

### Backend：保存與 aggregate watch list

backend 負責：

1. 為每個 frontend 保存目前的 `desiredWatchSet`
2. 依照 `selectedExtensionId` 將多個 frontend 的需求 aggregate 成每個 extension 的 `effectiveWatchSet`
3. 每次 aggregate 結果變動時，把新的 `effectiveWatchSet` 推給對應 extension

backend 不需要把 watch list 寫入磁碟；memory state 即可。

這裡的關鍵不是「全局 union」，而是：

- **per-frontend 保存**
- **per-extension aggregate**
- **per-extension 派發**

### 多 frontend 語義：同一個 extension 用「並集」，不是交集

這裡要特別釘死：

- 若多個 frontend 指向**不同** extension，backend 應各自維護各自的 `effectiveWatchSet`
- 若多個 frontend 指向**同一個** extension，backend 應對它們的 watch demand 取**並集（union）**

原因：

- 每個 frontend 都代表一個獨立 consumer
- 只要其中任何一個 frontend 仍在看某個 live topic，對應 watcher 就仍然有存在理由

交集（intersection）不可用，因為：

- frontend A 在看 `file.content@a.ts`
- frontend B 在看 `git.status@workspace`

若取交集，結果會變成空集合，兩邊都壞掉。

所以正確模型是：

- **per-frontend**：各自有自己的 `desiredWatchSet`
- **per-extension**：對所有指向該 extension 的 frontend 取 union，得到 `effectiveWatchSet`
- **per-extension dispatch**：每個 extension 只收到自己的 `effectiveWatchSet`

### Extension：根據 `effectiveWatchSet` 建立/釋放 watcher

extension 維護：

- `watchKey -> Disposable[]`

每次收到新的 `effectiveWatchSet`：

1. diff 出新增 watch keys
2. 只為新增項目建立 watcher / listener
3. diff 出消失的 watch keys
4. dispose 不再需要的 watcher / listener

---

## Protocol 提案

### Shared type

```ts
type WatchDescriptor =
  | {
      topic: 'file.content'
      path: string
    }
  | {
      topic: 'git.status'
      scope: 'workspace'
    }
```

### Frontend -> Backend

`watch.sync`

```ts
{
  watches: WatchDescriptor[]
}
```

`watch.sync.result`

```ts
{
  watches: WatchDescriptor[]
}
```

語義：

- 用完整集合覆蓋這個 frontend 先前的 watch set
- 不是增量 patch
- frontend 的 watch set 生命週期綁在「當前這條 frontend WS 連線」上，而不是綁在帳號、裝置或 workspace 本身

### Backend -> Extension

`watch.set`

```ts
{
  watches: WatchDescriptor[]
}
```

語義：

- 這是 backend aggregate 後的 `effectiveWatchSet`
- extension 以它作為唯一真相來 reconcile watcher registry

v1 不要求 `watch.set.result`。若需要觀測，可用 debug log 與測試驗證。

---

## V1 extension watcher 實作原則

### `file.content@path`

應由兩類訊號組成：

1. **dirty buffer / 編輯中內容**
   - `onDidChangeTextDocument`
   - 只有在至少有一個 `file.content` watch 存在時才掛上
   - callback 只對被 watch 的 path 工作
2. **磁碟/外部變化**
   - path-scoped `FileSystemWatcher`
   - 不再使用 workspace-wide `**/*`

### `git.status@workspace`

- 只在 `git.status@workspace` 存在時，掛 `repo.state.onDidChange()`
- Git page 關閉或切走後立即 dispose

### 明確移除的 eager 行為

1. activate 時自動啟動 file tree watcher
2. activate 時自動啟動 git watcher
3. workspace-wide `file.treeChanged` push model

---

## 前端行為調整

### 保留的 live 行為

- `CodeViewerPage` 可以繼續 listen `file.contentChanged`
- `GitChangesPage` 可以繼續 listen `git.statusChanged`

但這些 push event 只有在對應 watch 存在時才應該出現。

### 拿掉的預設 live 行為

- `FileBrowserPage` 不再預設訂閱 `file.treeChanged`
- `Tours` 頁面不新增任何 watcher

### workspace 切換時的規則

- frontend 在切換 selected workspace 後，應重新送出完整 `watch.sync`
- 若新 workspace 尚未完成 route 對應，暫時送 `[]`

### hidden / background tab 規則

`document.visibilityState` 也屬於 demand state 的一部分。

v1 建議規則：

- foreground / visible：依 route + workspace 正常推導 `desiredWatchSet`
- hidden / background：送出 `watch.sync([])`
- 回到 visible：重新送出完整 `desiredWatchSet`，並對當前 live 頁面立即補一次 request reload

原因：

- 手機瀏覽器背景 tab 的 WebSocket 很常被中止或凍結
- 即使 transport 沒立刻斷，hidden tab 也不該繼續保留 live watch demand
- 這能降低多 tab 短暫重疊時的 watcher 保留時間

注意：

- hidden 時不一定要主動 `disconnect()` 整條 WS
- 但至少要把 watch demand 清空，避免 background tab 繼續佔用 watcher
- visible 時不能只恢復 watch set，因為 hidden 期間漏掉的 event 不會自動 replay；必須補一次主動 fetch 才能保證畫面不是 stale

---

## 成功條件

1. extension activate 後，若 frontend 當前 route 沒有 live demand，extension 不建立 file/git watcher
2. 多個 enabled workspace 同時開著時，只有被 demand 命中的 workspace 維持 watcher
3. `file.tree` 與 `tour.*` 仍可透過 request/response 正常使用
4. `file.content` 與 `git.status` 在對應頁面開著時仍保有即時性
5. 重新 sample 熱的 `Code Helper (Plugin)` 時，filesystem callback 熱點顯著下降

---

## 風險與邊界

### 1. `file.content` 仍需要一個全域 document-change listener

這是 v1 可接受的折衷，但它必須滿足兩個條件：

- 只有在至少一個 `file.content` watch 存在時才掛上
- callback 只對 active watched paths 做事

### 2. 多 frontend 情境

backend aggregate 時要用 union / dedupe，而不是最後寫入者覆蓋全部。否則多裝置或多分頁會互相踩掉 watch state。

### 3. background tab 的 zombie 連線

手機瀏覽器或 Safari 可能在 background 時凍結頁面，但不保證立刻乾淨地關閉 WebSocket。

因此 v1 不應只依賴 transport close 來釋放 watch demand，還要靠：

- `visibilityState === hidden` 時主動送 `watch.sync([])`
- backend 在 frontend disconnect 時刪除該 frontend 的 watch set

### 4. cache / scroll restore 相容性

目前 file / git / tree 的 cache 與 scroll restore 都不是靠 live watch 驅動，而是靠 request 結果落地：

- file content cache：`extensionId:path`
- file tree cache：`extensionId`
- git status cache：`extensionId`
- current file：localStorage `code-viewer:current-file(:extensionId)`
- scroll restore：localStorage `code-viewer:scroll:${extensionId}:${path}`

因此 watch list 不應改變這些 key，也不應改變 restore 語義。

v1 應維持：

- page mount 時先讀 cache
- `connectionState === connected` 時再 background fetch
- watch 只負責後續 live refresh，不負責 restore

### 5. workspace 切換的短暫空窗

切 workspace 後，watch set 可能短暫為空。這是可接受的，因為正確性比短暫 live gap 更重要。

---

## 後續版本

若 v1 成功止血，再評估：

1. 是否需要 `file.tree@directory` 的 explicit live watch
2. 是否需要 `watch.set.result` 做 observability
3. 是否把 watch set 暴露到 admin/debug 面板，方便觀察 extension 目前到底掛了哪些 watcher
