# Signal vs Settled Truth

Created: 2026-04-13
Last Updated: 2026-04-13
Status: Active Reference

## Why This Exists

在 event-driven 系統裡，最常見也最隱性的錯誤之一，是把「有 signal 發生」誤認成「系統真相已經穩定更新完成」。

這份文件把這個問題抽成可重用的 reference，讓後續在 watcher、cache、frontend reload、backend relay、extension push event 等場景都能直接套用。

## Core Principle

**Signal 告訴你某件事需要重新檢查。**

**Settled truth 才是可以拿來驅動 UI 或後續邏輯的穩定狀態。**

兩者不一定同時到達，也不保證由同一層提供。

## The Common Failure

典型錯誤流程：

1. filesystem / websocket / queue event 先到
2. 系統立刻把這個 signal 當成「真相已更新」
3. frontend 或下游邏輯立刻重抓資料
4. 但真正的 truth source 還沒完成更新
5. 因為沒有第二次 invalidation 或 settle follow-up，UI 永遠停在舊資料

這類 bug 看起來像：

- event 有收到，但畫面沒更新
- E2E 偶爾 timeout，平常手動操作像是「有時會自己好」
- log 顯示 reload 確實發生了，但 snapshot 內容仍舊是舊的

## Vocabulary

### Signal

表示「有事情發生了」或「你應該重新檢查」的通知。

例如：

- filesystem watcher event
- `git.statusChanged`
- websocket push event
- cache invalidation event

### Truth Source

真正承載目前狀態的來源。它可能比 signal 晚更新。

例如：

- VS Code Git API `repo.state`
- backend DB row
- file content snapshot
- resolved workspace list

### Settled Truth

已經完成更新、可安全用來驅動 UI / decision / side effect 的 truth source snapshot。

### Invalidation Signal

只代表「舊資料可能已失效」，不保證新資料已 ready。

這是大部分 watcher / push event 真正的語義。

## Practical Rule

如果一個 event 本身不直接攜帶完整新狀態，而且它所依賴的 truth source 可能異步更新，那它就應該被視為：

**invalidation signal，不是 settled snapshot**

## Real Example in Code Viewer

這次 `watch-demand` 撞到的案例就是：

### Components

- signal source: extension filesystem watcher
- truth source: VS Code Git API `repo.state`
- consumer: frontend `/git` page

### Broken flow

1. 新增 untracked file
2. filesystem watcher 先收到 event
3. extension 發 `git.statusChanged`
4. frontend 立刻 request `git.status`
5. 但那一刻 Git API 還沒把新檔案反映到 `repo.state`
6. 因為原本只發一次 signal，frontend 之後沒有再 reload
7. UI 永遠停在舊的 file list

### Why This Bug Happened

不是 watcher 沒動。

不是 frontend 沒 reload。

而是：

**`git.statusChanged` 被誤用成了「Git truth 已經穩定更新」的訊號。**

實際上它只能保證：

**「現在該重新檢查了。」**

## Correct Contract

對這類系統，比較安全的語義應該是：

- signal = invalidation
- snapshot fetch = 讀 truth source
- UI = 只信 snapshot，不信 signal 本身
- 若 truth source 可能落後 signal，需加 settle strategy

## Settle Strategies

### 1. Delayed follow-up

第一次 signal 先觸發 reload，再安排一次短延遲 follow-up。

適合：

- truth source 通常只晚一小段時間
- 成本不高
- 不需要長時間 polling

這次 Code Viewer Git watcher 用的就是這種：

- FS event 先 emit 一次
- 再加一個短 settle follow-up，等 Git API state 跟上

### 2. Retry until condition

不是固定延遲，而是等到某個條件成立才停止。

適合：

- UI 或 API 可以明確判斷「新狀態已出現」
- 測試腳本或 migration 腳本

### 3. Backend/producer emits settled snapshot directly

最強，但也最重。

只有當 producer 本身能知道「現在新狀態已經穩定」時才成立。

### 4. Explicit stale state in UI

如果無法保證很快 settle，UI 應明確呈現「正在同步 / refreshing」，而不是假裝已經完成。

## Anti-Patterns

### Anti-pattern 1: Treating signal as data

收到 event 就當資料已更新完成。

這最容易導致 race。

### Anti-pattern 2: One-shot reload on eventually consistent state

對一個可能晚更新的 truth source，只 reload 一次，然後假設足夠。

### Anti-pattern 3: Blaming flakiness on tests first

如果 E2E 穩定指出：

- signal 有到
- reload 有做
- 但 UI 還是舊的

那很可能是產品時序契約有問題，不只是測試 flaky。

### Anti-pattern 4: Confusing routing signal with demand signal

例如：

- selected workspace
- connected websocket
- local subscription callback

這些不一定代表「該開始監控」或「該相信資料已更新」。

## How To Reason About It

遇到 event-driven bug 時，先問四個問題：

1. 這個 event 到底是 signal 還是完整 snapshot？
2. 真正的 truth source 是哪一層？
3. signal 和 truth source 的更新是否可能錯開？
4. 如果 truth 可能晚到，系統有沒有 settle strategy？

只要第 3 題答案是「會」，第 4 題就不能是空白。

## Design Checklist

- event 是否只是 invalidation，而不是 state payload？
- consumer 是否明確知道真正的 truth source 是誰？
- reload 後若 truth 尚未更新，是否有 follow-up / retry / visible stale state？
- UI 是否只根據 settled snapshot 更新，而不是根據 signal 本身更新？
- E2E 是否有覆蓋「signal 先到、truth 後到」的時序落差？

## Testing Guidance

這類問題最適合用 E2E 抓，因為 unit test 很容易把多層 timing 壓平。

E2E 應明確驗：

- signal 是否真的發生
- consumer 是否真的收到並做 reload
- 最終 snapshot 是否真的反映新狀態

如果只有前兩者成立，不代表系統正確。

## Takeaway

可以把這份 reference 壓成一句話：

**Signal 不是 truth。**

更完整一點：

**Signal 只代表「該重新檢查了」；只有 settled truth 才能當作 UI 與 decision 的依據。**
