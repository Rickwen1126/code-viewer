# SHIP: code-viewer-deep-link-media

tags: [ship, code-viewer, deep-link, media-preview]

## Relations
- ship_plan_for [待討論：todo-code-viewer-deep-link-media@2026-04-02]

## 1. Problem Statement
**問題**：讓使用者與 agent 能用穩定的 deep link 直接打開指定 workspace/file/range，並讓同一個 `/files` 觀看面能承載 image/video 預覽
**對象**：自己，以及在 code review / agent-assisted workflow 中需要快速跳到特定檔案內容的人
**成功條件**：
- 從 workflow / agent / CLI 產出的 link，不依賴 `location.state`，重新整理後仍能打開正確 workspace/file/line
- deep link 不綁定會隨 VS Code 重開而改變的 runtime identity
- `/files/:path` 對文字檔維持現狀，對 image/video 能直接 inline preview
- image/video 不走現有 `file.read` 文字 WS payload 模型

## 2. Solution Space
| 做法 | 優勢 | 風險/代價 |
|------|------|-----------|
| **Canonical deep link + backend link API + HTTP asset endpoint，重用 `/files` viewer** | agent 可直接產生 link、URL 可分享/重整、media 能走適合的 transport、維持單一路由心智模型 | 要補 backend REST/asset surface、workspace resolution contract、video 可能要處理 `Range` |
| 只補 CLI/button，維持現在 `navigate(..., { state })` 與 text-only viewer | 改動最小、幾乎不碰 backend | 不是真正 deep link；重整/外部打開會丟 line/range；agent workflow 價值低；媒體還是沒解 |
| 做 backend-minted opaque link/token + 獨立 `/media` / `/review` route | 可以隱藏內部 path/identity，未來可擴展更多分享場景 | 狀態複雜度高、要管理 token/session、目前對本地單機 workflow 太重 |

**選擇**：Canonical deep link + backend link API + HTTP asset endpoint，重用 `/files`
**原因**：這是唯一同時解掉「agent 可嵌入工作流程」、「重整後仍成立」、「media transport 合理」三個需求的方案，而且能把 deep link 當成後續 Git/Tour/Review link 的共同基礎設施

## 3. 技術決策清單
| 決策點 | 選擇 | 原因 | 備選 |
|--------|------|------|------|
| 對外 workspace 識別 | canonical link 以 `rootPath` 為主，runtime 再 resolve 到當前 `extensionId` | `extensionId = hostname-pid`，重開 VS Code 會變，不適合當 public contract | 直接用 `extensionId`、只用 display name |
| Deep link 格式 | `/open/file?...` 作 resolver，最後落到 `/files/:path?line=&endLine=` | 讓外部入口、workspace resolve、URL state 分工清楚 | 直接把全部塞進 `/files/*`、繼續用 `location.state` |
| Link 生成介面 | backend REST `GET /api/links/file` + CLI `code-viewer link file` | agent/workflow 需要 machine interface；CLI 只是 ergonomics layer | 只做 frontend copy button、只做 CLI 不做 API |
| Media transport | binary/media 走 HTTP asset endpoint；text 繼續走 `file.read` over WS | 圖片/影片與文字編輯模型不同；video 預期需要 `Range` | `file.read` 回 base64、全部塞 WS |
| Viewer surface | 保持 `/files/:path` 單一 viewer，依 `mimeType/previewType` 切換 renderer | 不增加新的導航心智負擔；deep link 不需分 text/media 兩套 | 另開 `/media/:path` |
| 交付順序 | 先 deep link / link API，再 image，再 video | deep link 是 agent workflow 的基礎建設；圖片比影片 transport 簡單 | 一次把 deep link + image + video 全綁一起 |

## 4. Deep Link 基礎知識

- **Deep link 是「可重建目標狀態」的 URL，不是單純可點網址。**
  它的核心不是能打開頁面，而是打開後能直接落到指定資源與上下文，例如某個 workspace、某個 file、某一行。
- **URL state 與 transient state 要分開。**
  `line=120` 這種重整後還該存在的資訊要放進 URL；像「剛剛從哪個按鈕點來」、「要不要做 smooth scroll animation」這種只影響當下互動的東西，才適合放 transient navigation state。
- **Resolver route 的角色是「把穩定輸入解成當前執行期可用的目標」。**
  這就是為什麼會有 `/open/file?...`。外部 link 不應直接依賴 runtime 細節；resolver 先根據 stable identifier 找到當前可用 workspace，再導向真正的 viewer route。
- **Stable identity 跟 runtime identity 不一樣。**
  在這個系統裡，`extensionId` 是 runtime identity，因為它會跟著 VS Code process 改變；`rootPath` 比較接近 stable identity，所以比較適合出現在 deep link contract。
- **Link API / CLI 的價值不是方便複製，而是讓 agent workflow 可組合。**
  一旦 deep link 有正式 contract，agent、CLI、extension command、UI copy button 都能共用同一套 link 生成邏輯，而不是各自拼字串。
- **一個好 deep link 通常有兩段。**
  外部入口用 resolver（例如 `/open/file?...`），內部 viewer 用 canonical route（例如 `/files/...?...`）。這樣 viewer 保持單純，resolver 專心做 identity resolve、workspace selection、fallback。

### Learning Checklist（context-preserving）

- [ ] **L1 Deep link solves what problem**
  目標：能用自己的話說出「deep link 不是打開頁面，而是重建指定狀態」
- [ ] **L2 URL state vs transient state**
  目標：能判斷 `line/endLine/workspace/path` 哪些必須進 URL，哪些只該存在一次導頁記憶裡
- [ ] **L3 Stable identity vs runtime identity**
  目標：能說出為什麼 `extensionId` 不能當 public contract，而 `rootPath` 比較接近 canonical identifier
- [ ] **L4 Resolver route 的角色**
  目標：能說出 `/open/file?...` 為什麼存在，以及它跟 `/files/:path?...` 的分工
- [ ] **L5 Agent-friendly link API**
  目標：能說出為什麼 backend link API / CLI 比單純 copy button 更有工作流價值
- [ ] **L6 Text transport vs media transport**
  目標：能說出為什麼 image/video 不應直接沿用 `file.read` 的 WS text payload
- [ ] **L7 Why video often needs Range**
  目標：能說出 `<video>` seek / replay 為什麼常依賴 `206 Partial Content`

**建議學習順序**：
- Phase A（deep link foundation）：L1 → L2 → L3 → L4
- Phase B（workflow integration）：L5
- Phase C（media preview foundation）：L6 → L7

**開工切點**：
- Milestone A（deep link / link API）最少要先完成 L1-L4
- Media preview 若只做 image，可在 L6 基本清楚後前進
- Video preview 進 implementation 前，至少要完成 L7 或做完對應 spike

## 5. 知識風險標記

### [B]lock（不理解，會影響方向）

- [ ] **B1 Workspace identity 的 public contract**
  - 解什麼問題：讓 deep link 在 VS Code reload / reopen 後仍能找到正確 workspace
  - 用錯會怎樣：如果 link 綁定 `extensionId`，只要 extension instance 變了，之前產出的 link 就全部失效
  - 為什麼選這做法：目前系統的 `extensionId` 來自 `hostname-pid`，屬於 runtime identity，不是 stable workspace identity
  - Exit Questions:
    1. 為什麼 `extensionId` 不能當 public deep link 的 canonical workspace identifier？ [A]
    2. 如果同一個 repo 重新開窗後 extension instance 變了，deep link 應該靠什麼重新 resolve？ [A]
    3. `rootPath` 當 canonical identifier 的代價是什麼？哪些情況會讓它不夠理想？ [A]
  - 狀態：未解除

- [ ] **B2 Media transport 與 text transport 的邊界**
  - 解什麼問題：讓 image/video preview 可用，同時不破壞目前 `file.read` 的文字檔模型
  - 用錯會怎樣：如果把 image/video 硬塞進 `file.read`，會帶來 base64 膨脹、記憶體壓力、快取混亂，影片還可能無法順利 seek/stream
  - 為什麼選這做法：文字檔需要 dirty buffer / languageId / lineCount；media 需要的是合適的 binary delivery，兩者不是同一個 transport 問題
  - Exit Questions:
    1. 哪些需求讓 `file.read` 的 text payload model 不適合 image/video？ [A]
    2. 為什麼 video preview 大概率需要 HTTP `Range` / `206`，而不是單次完整回傳？ [A]
    3. 我們最小要做什麼 spike，才能確認 iPhone/Chrome 對 `<video>` + asset endpoint 的 seek 行為可接受？ [B]
  - 狀態：未解除

### [R]isky（大概懂但不確定）

- **R1 Deep link 的 URL state contract**
  - 我知道 line/range 不能再放 `location.state`，但 `/open/file` resolver 與 `/files/:path` 最終 URL 應該怎麼分工，還值得先講清楚
  - Exit Questions:
    1. 哪些 state 必須存在 URL 裡，哪些 state 可以繼續留在 transient navigation state？ [A]
    2. 為什麼把 workspace selection 放進 resolver route，會比在 `CodeViewerPage` 裡臨時補邏輯更穩？ [A]

- **R2 Auth boundary for generated links**
  - 目前 backend 可以啟用 `CODE_VIEWER_SECRET`，但 deep-link API / asset endpoint 的 auth contract 還沒定
  - Exit Questions:
    1. 如果 backend 開了 secret，為什麼不能直接把 secret embed 在 copied URL？ [A]
    2. 這條 link 是偏向「同機 trusted local use」還是要保留未來的分享能力？兩者會怎麼影響 auth 設計？ [A]

- **R3 Media preview 的 MVP 邊界**
  - 我大致知道 image 應先於 video，但哪些格式要進 MVP、哪些要 best-effort 還沒明確定義
  - Exit Questions:
    1. Image MVP 應該先支援哪些格式，哪些可以延後？ [A]
    2. `mov` / codec 差異如果在不同瀏覽器表現不一致，MVP 應該把它視為 bug 還是 best-effort？ [A]

### Spike 計畫（B 類 Exit Questions 分群）

- Spike 1: `video-asset-range-probe` → 覆蓋 B2 Q3
  - 做什麼：做最小 asset endpoint 或 throwaway route，提供一個 sample mp4，驗證 browser 對 `Range` / `206`、seek、replay、reload 的行為
  - 預計時間：30 min

### [N]ice-to-know（不影響方向）
- Image thumbnail / poster frame 自動產生策略
- copy link UI 最終放在 file header、diff header、還是 extension command
- browser codec matrix 的完整細節

## 6. 開工決策
- [ ] 所有 [B]lock 已解除
- [x] [B]lock ≤ 3 個
- [x] Problem Statement 清晰
- [x] Solution Space 有比較過
- [x] 技術決策已有初步根據，不是純 vibe picking

**狀態**：待補
