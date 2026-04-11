# SHIP: code-viewer-demand-driven-sync

version: v1
tags: [ship, code-viewer, performance, extension-lifecycle, demand-driven]

## Relations
- ship_plan_for [docs/demand-driven-watch-list/plan.md]

## 1. Problem Statement
**問題**：目前 Code Viewer extension 在 VS Code activate 後就常駐啟動 file/git watchers，主動監控 workspace 並 push event，導致多個 workspace 同時開著時 `Code Helper (Plugin)` 出現高 CPU，即使前端沒有主動請求 file/git 資料

**對象**：自己，以及日常會同時打開多個 repo / workspace 的開發流程

**成功條件**：
- extension idle 時只維持 websocket、workspace register、必要 heartbeat，不主動監控 file/git 變化
- file tree / file read / git status / git log 回到 frontend demand-driven request，不因 activate 就開始跑
- `selected workspace` 只作 routing，不被誤用成 demand signal
- 如果未來需要 live update，必須是 explicit subscription，而不是 activation-time eager watch
- 關掉不必要 VS Code 後只是暫時止血；即使之後再開多個 enabled workspace，沒有前端需求時也不應出現 extension host 自轉

## 2. Solution Space
| 做法 | 優勢 | 風險/代價 |
|------|------|-----------|
| **回到 pure request/response baseline：移除 activation-time file/git watchers，前端頁面進入時才 request，必要時手動 refresh / reconnect reload** | 最符合原始原則；能最快消除 idle overhead；機制單純，容易驗證 CPU 是否下降 | 會失去自動更新體驗；少數頁面可能要補 refresh / focus reload |
| **加 explicit `watch.start / watch.stop` 協定，由前端按 topic/scope 訂閱，backend 做 ref-count，extension 只在有 subscriber 時才啟動 watcher** | 保留 live update，同時維持 demand-driven；長期模型正確 | 需要跨 `shared/backend/extension/frontend` 改協定；改動中等 |
| **保留現在 push 模型，只把 watcher 縮窄、加 debounce、或用 selected workspace 當 gating** | 改動最小；短期可能降一些 CPU | 與原則背道而馳；無法保證 idle 真正沒有 demand 時不做事；`selected workspace` 不是需求訊號 |

**選擇**：v1 先回到 pure request/response baseline；若之後證明確實需要 live update，再做 explicit `watch.start / watch.stop`

**原因**：這次問題不是「哪個 debounce 不夠」，而是 sync model 本身錯置。先把系統拉回 demand-driven baseline，才能重新建立什麼資料該 request、什麼資料值得 watch 的邊界。

## 3. 技術決策清單
| 決策點 | 選擇 | 原因 | 備選 |
|--------|------|------|------|
| Extension activate 後的常駐能力 | 只保留 websocket、message routing、commands、workspace register | 這些是基礎連線能力，不代表前端已經需要 file/git live data | activate 時直接掛 file/git watchers |
| File/Git 資料同步模型 | 以 frontend request/response 為主 | 符合「熱區由 frontend 送過來」原則；沒有 demand 就不該有監控 | extension eager push |
| `connection.selectWorkspace` 的語義 | 僅作 routing / current target，不作 demand signal | 被選中不代表正在看 file tree/git/status，更不代表需要 live watch | 把 selected workspace 當 watcher 開關 |
| Frontend `subscribe()` 的角色 | 目前只算前端本地 listener，不算跨邊界需求協定 | 現在 subscribe 不會回傳到 backend/extension，所以不能宣稱系統是 demand-driven | 沿用現狀並假設 backend/extension 知道需求 |
| 未來 live update 的模型 | 若真的需要，再加 explicit `watch.start/watch.stop(topic, scope)` | 先證明 live update 有真需求，再為它付協定複雜度 | 直接保留 global watcher |
| 效能驗證方式 | watcher 拔掉後重新 sample extension-host，確認熱點是否消失 | 這次問題是 runtime 行為，不是只靠 code review 就能結案 | 只憑理論推斷完成 |

## 4. 現場證據
- backend process `node` 本身接近 idle，不是主要熱源；高熱落在 `Code Helper (Plugin)`
- 對熱的 `Code Helper (Plugin)` 取樣後，call graph 主要落在 `uv_fs -> node::fs::AfterInteger -> FSReqCallback::Resolve`，比較像 filesystem callback storm，不像 WebSocket retry
- extension 目前在 activate 時就啟動 file watcher 與 git watcher，而不是等到真正有 frontend demand
- frontend 的 `subscribe()` 只存在於前端本地，不會自動轉成 backend/extension 可理解的 demand signal
- backend 上同時有多個 workspace 連到 `:4800`，表示 eager watcher 的成本是按 workspace 數量放大的

## 5. Demand-Driven 基礎知識
- **Routing signal 不等於 demand signal。**
  `selected workspace` 只是在說「之後 request 要路由到哪個 extension」，不是在說「這個 extension 現在應該啟動哪些監控」。
- **Frontend local listener 不等於跨邊界 subscription。**
  `subscribe('file.treeChanged')` 如果只在 frontend 內部註冊 callback，而沒有把需求傳回 backend/extension，那整體系統仍然是 push-first。
- **Watcher 的成本發生在 callback 前，不是在 callback 裡 skip 才開始。**
  如果 watcher 本身是 `**/*`，那麼就算 callback 裡對 `.git/` 或 `node_modules/` return，事件喚醒與 callback 進場的成本已經發生了。
- **Idle baseline 應該先定義清楚。**
  對這個系統來說，idle baseline 應該是「workspace 開著、frontend 不一定在線、沒有 page-level file/git 需求」時，extension 不主動做 file/git 監控。
- **Live update 是加值能力，不是預設權利。**
  只有當某個頁面或某種資料真的因為 stale 而明顯傷害 UX，才值得用 explicit watch 模型去換取額外複雜度。

## 6. 知識風險標記

### [B]lock（不理解，會影響方向）

- [ ] **B1 Routing signal 與 demand signal 的邊界**
  - 解什麼問題：避免把 `selected workspace`、websocket connected、frontend local subscribe 誤認成「extension 應該開始監控」
  - 用錯會怎樣：會做出看似有 gating、實際上仍然 eager 的半套設計，CPU 問題只被藏起來，不會真的消失
  - 為什麼選這做法：這次要修的是 sync model，不是單純幫現有 watcher 換更小的條件
  - Exit Questions:
    1. 為什麼 `connection.selectWorkspace` 只能當 routing 資訊，不能直接當 watcher 開關？ [A]
    2. 如果 9 個前端各自選了 9 個 workspace，但都沒打開 files/git 頁面，系統應該保留哪些常駐能力？ [A]
    3. `subscribe()` 目前停在哪一層，缺了哪段協定才讓需求無法傳到 extension？ [A]
  - 狀態：未解除

- [ ] **B2 File watcher 成本模型**
  - 解什麼問題：理解為什麼「callback 裡 skip noisy paths」不等於「沒有監控成本」
  - 用錯會怎樣：會低估 `createFileSystemWatcher('**/*')` 對高變動 workspace 的影響，繼續把問題當成 debounce 或 reconnect bug
  - 為什麼選這做法：這次 sample 已經顯示熱點偏向 `uv_fs` / `FSReqCallback`
  - Exit Questions:
    1. 在 VS Code / Node 這條路徑上，watcher 的喚醒成本發生在 callback 前還是 callback 內？ [A]
    2. 為什麼 `.claude`、log/jsonl/session/generated assets 這類 workspace 會把 `**/*` watcher 放大成 event storm？ [A]
    3. 最小 spike 要怎麼設，才能確認移除 activation-time watcher 後 extension-host CPU 確實下降？ [B]
  - 狀態：未解除

### [R]isky（大概懂但不確定）

- **R1 哪些資料真的需要 live update**
  - 我知道 file tree / git status 不該默認常駐 watch，但哪些 UX 如果沒有 push 會真的明顯退化，還值得再明確切一次
  - Exit Questions:
    1. 哪些頁面資料可以接受 page-enter reload / focus reload / manual refresh？ [A]
    2. 哪些資料若沒有 live update，會讓使用者做出錯誤判斷，而不是只是多按一次 refresh？ [A]

- **R2 Dirty state 與 tree/git 變化應否拆開**
  - 我大致知道 unsaved buffer state 比一般 file tree 變化更接近即時訊號，但邊界還值得再明確
  - Exit Questions:
    1. `file.contentChanged`、`file.treeChanged`、`git.statusChanged` 這三類訊號是否應該拆成不同 demand policy？ [A]
    2. 如果只保留一種近即時訊號，最值得留下的是哪一種？ [A]

### Spike 計畫（B 類 Exit Questions 分群）
- Spike 1: `disable-eager-watchers-and-profile`
  - 覆蓋 B2 Q3
  - 做什麼：在本地分支暫時拔掉 activation-time file/git watchers，只保留 websocket / request-response，重新 sample `Code Helper (Plugin)` 並比對 CPU 與 call graph
  - 預計時間：30 min

### [N]ice-to-know（不影響方向）
- websocket reconnect 的精確 backoff 參數
- backend heartbeat 對 idle CPU 的細節影響
- 未來 `watch.start/watch.stop` 的 payload syntax

## 7. 開工決策
- [ ] 所有 [B]lock 已解除
- [x] [B]lock ≤ 3 個
- [x] Problem Statement 清晰
- [x] Solution Space 有比較過
- [x] 技術決策已有初步根據，不是純 vibe picking

**狀態**：待補

## 8. Stop-Loss Checks
- 如果拔掉 activation-time watcher 之後，`Code Helper (Plugin)` idle CPU 仍然沒有明顯下降，就停止假設 `code-viewer` 是唯一根因，重新取樣其他 extension
- 如果要實作 `watch.start/watch.stop` 才能驗證 baseline 是否有效，就先停在 pure request/response，不把 v2 協定混進 v1 止血
- 如果某個 workflow 確實需要 live update，也不能退回 global watcher；只能走 explicit subscription + scope 限縮
