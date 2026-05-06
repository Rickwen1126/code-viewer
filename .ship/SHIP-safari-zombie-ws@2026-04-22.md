# SHIP: Safari Zombie WebSocket Fix

tags: [ship, websocket, safari, mobile, reconnection]

## 0. AI Context（AI 補課，非使用者判斷）

- **Codebase 現狀**：`ws-client.ts` 已有 `visibilitychange` + `pageshow` 偵測、zombie socket 檢查（`readyState !== OPEN`）、自動重連 + exponential backoff。Backend 已有 extension heartbeat（30s interval），但 frontend ↔ backend 之間沒有 keepalive 機制。
- **技術脈絡**：Safari 的 BFCache / JS freeze 行為是已知的 WebKit 特性，不是 bug。Chrome 也有 frozen tab 但會正確觸發 `onclose`。Safari 的行為短期內不會改變（已存在多年）。
- **盲點提醒**：修復只涵蓋 WorkspacesPage 的 UI 保護。其他頁面（file browser、tour detail 等）在 WS 重連期間發 request 也會失敗，但那些頁面通常已經有 error handling + retry。Workspace 切換是唯一「看起來正常但完全無反應」的場景。
- **Survey 建議**：不需要。問題域明確，解法經過驗證。

## 1. Problem Statement

**問題**：Safari 手機長時間背景後回來，workspace 頁面看起來正常但點擊無反應，要等 30 秒才報錯
**對象**：用 Safari / PWA 瀏覽 Code Viewer 的使用者（主要是自己的 iPhone）
**成功條件**：背景恢復後 5 秒內自動偵測 + 重連，使用者看到明確的 reconnecting 狀態

## 2. Solution Space

| 做法 | 優勢 | 風險/代價 |
|------|------|-----------|
| A. 定期心跳（每 N 秒 ping） | 偵測即時，任何時候斷線都能發現 | 正常使用時持續消耗流量；增加 server 負載；手機背景時 timer 被 throttle 效果差 |
| B. Visibilitychange 觸發 ping probe | 零正常開銷，只在需要時偵測；精確命中 Safari 問題場景 | 只能在回到前景時偵測，不能提前預防；有 3 秒偵測延遲 |
| C. 在 request() 裡加 pre-flight check | 每次操作前先驗活，最精確 | 每次操作多一次 RTT；UX 變慢；改動範圍大（所有 request 路徑都受影響） |

**選擇**：B — Visibilitychange 觸發 ping probe
**原因**：問題只發生在「Safari 背景恢復」這個精確場景，用最小的改動、零正常開銷命中它

## 3. 技術決策清單

| 決策點 | 選擇 | 原因 | 備選 |
|--------|------|------|------|
| Ping 機制 | Application-level ping via `request()` | 復用現有 request/response routing，零新基礎設施 | WebSocket protocol-level ping（瀏覽器 API 不支援 client 端發送） |
| Probe timeout | 3 秒 | WiFi + Tailscale tunnel 恢復 ~2s，3s 留 buffer；false positive 成本低（快速重連） | 1s（WiFi handoff 會 false positive）、10s（偵測太慢） |
| Zombie cleanup | 抽成 `forceReconnect()` 共用方法 | 兩處使用（readyState 檢查 + ping timeout），DRY | 各自 inline（review 找到重複，已修） |
| UI 保護 | WorkspacesPage 加 `wsReady` 判斷 + banner | 這是唯一「看起來正常但不可操作」的頁面 | 全域 reconnecting overlay（太侵入，其他頁面有各自的 error handling） |

## 4. 橫向掃描

未做正式橫向掃描。設計參考了 TCP keepalive 和 load balancer health check 的 end-to-end probe pattern。

## 5. 知識風險標記

### [R]isky（大概懂但值得驗證）

- **Safari JS freeze 的精確行為**：Safari 凍結 JS 時，`WebSocket.readyState` 是真的 stale（freeze 時的快照），還是 WebKit 有延遲更新的機制？目前的觀察是 stale，但不確定是否所有 Safari 版本都一致。
  - Exit Questions:
    1. Safari freeze 時 `readyState` 的值是 freeze 瞬間的快照，還是會在 resume 時由 WebKit 先更新再把控制權還給 JS？ [B]
    2. 如果 Safari 某個版本修了 readyState stale，我們的 probe 會造成什麼行為？（已在 tour 討論：probe 不會觸發，自動退化為 dead code）[A]

- **Probe timeout 的 false positive 邊界**：3s 在 Tailscale LAN 上足夠，但如果未來用 Tailscale relay（經由 DERP server）跨國連線，RTT 可能超過 3s。
  - Exit Questions:
    1. Tailscale direct connection vs DERP relay 的 RTT 差異大概是多少？什麼情況會 fallback 到 DERP？ [A]

### [N]ice-to-know（不影響方向）

- WebSocket protocol-level ping/pong（RFC 6455 Section 5.5.2）：server 可以發，browser API 不暴露 client 端 ping
- Safari BFCache 與 `pageshow.persisted` 的關係
- `visibilitychange` 在不同瀏覽器的觸發時機差異

## 6. 開工決策

- [x] 所有 Block 已解除（無 Block，post-hoc SHIP）
- [x] Problem Statement 清晰
- [x] Solution Space 有比較過
- [x] 技術決策都有根據

**狀態**：已完成（post-hoc 整理）

## 7. 學習收穫（替代 Block 區塊）

這次修復的核心 mental model：

### "看起來正常不代表真的正常" — End-to-End Probe Pattern

**機制**：在分散式系統中，local state（`readyState`、`this.state`）是本地的判斷，不是 ground truth。要確認連線真的活著，唯一可靠的方式是送一個要求回覆的訊息（end-to-end probe），等到回覆才算確認。

**故障模式**：只看 local state → Safari freeze 製造 zombie → 使用者操作進黑洞 → 等 timeout 才發現

**設計取捨**：
- Probe 有成本（一次 RTT + timeout 等待），所以不能每次操作都做
- 觸發條件越窄，false positive 越少，但可能漏抓場景
- Timeout 太短 → false positive（網路恢復中被誤判）；太長 → 偵測慢
- 本次選擇「只在 visibilitychange 且看起來健康時觸發」— 最窄條件，零正常開銷

**跨專案通用**：TCP keepalive、HTTP health check、gRPC keepalive ping、database connection pool validation 都是同一個 pattern。差異只在觸發頻率和 timeout 設定。
