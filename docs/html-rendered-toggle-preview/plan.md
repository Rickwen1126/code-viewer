# HTML Rendered Toggle Preview — Implementation Plan

Created: 2026-05-31 14:56
Last Updated: 2026-06-12 14:52
Status: Implemented frontend-only; asset proxy remains future work

## Goal

讓 Code Viewer 能把 repo 內的架構圖 HTML artifact 當成一級閱讀物，但維持
source-first 原則：

- 同一個 `.html` 檔可以在 `Source` 與 `Rendered` 之間切換
- 預設永遠先開 `Source`
- 只有使用者明確切到 `Rendered` 才把它當網頁 artifact 看

這次的主要對象是 `diagram-html` 產出的單檔自含 HTML，預設位置是：

```text
docs/architecture/**/*.html
```

## Non-goals

- 不把所有 `.html` 都自動改成網頁預覽
- 不在 Phase 1 擴充 shared `file.preview` protocol
- 不在 Phase 1 解一般 multi-file HTML asset 問題
- 不在 Phase 1 改寫 markdown renderer 或重做整個 file viewer

## Current Snapshot

目前已知的現況：

1. `markdown` 已經有同檔 raw/rendered toggle，但它是 frontend 內部 renderer，不是通用 file preview protocol。
2. 現有 `file.preview` pipeline 只支援 `image | video`。
3. `/files/*` 本來就把細節狀態放在 query string，`LastLocationTracker` 也會保留 `pathname + search`，所以 `view=rendered` 這種狀態天然能參與 history / refresh / restore。
4. `diagram-html` 目前輸出單檔自含 HTML，不需要另外起 local static server。
5. Commit `dfe8be4 feat(files): render html previews` 已提供 frontend-only HTML render：File View 對 `languageId === 'html'` 顯示既有 `Rendered` / `Raw` 按鈕，rendered mode 以 sandboxed `iframe srcDoc` 顯示目前檔案內容。
6. Commit `f4d509c fix(files): allow scripts in html render sandbox` 讓 iframe 使用 `sandbox="allow-scripts"` 但仍不給 `allow-same-origin`，所以單檔 script-driven diagram HTML 可以執行自己的初始化程式，同時不能取得 Code Viewer app origin。
7. 目前 frontend-only renderer 不會解析 repo-local 相對資源；例如 `<link href="./style.css">`、`<img src="./asset.png">`、`<script src="./app.js">` 仍缺少 backend asset proxy 才能完整顯示。

## Product Contract

### 1. Toggle, not auto-render

HTML preview 必須是 explicit toggle，不是 extension-based auto preview。

使用者打開 HTML 檔時：

- 預設進 `Source`
- 只有檔案符合 eligibility gate 時，header 才顯示 `Source | Rendered`
- 使用者手動切到 `Rendered` 後，才進入 iframe 預覽

### 2. Route contract

沿用現有 `/files/*` query contract，新增：

```text
?view=rendered
```

規則：

- `source` 是預設值，URL 可省略 `view`
- `rendered` 才顯式寫進 query
- 非法值一律 normalize 回 source
- 如果檔案不符合 eligibility gate，就算 URL 帶了 `view=rendered` 也回 source

### 3. Eligibility gate

Phase 1 只開給明確的架構圖 artifact：

- 副檔名是 `.html`
- 相對路徑位於 `docs/architecture/`

先不要把 generic HTML 一起拉進來，避免：

- 一般前端頁面或 template 檔也突然變成 renderable
- 未整理的相對 asset / script 問題混進第一版

之後若 scope 擴大，再評估第二層 signal，例如 generator marker 或 meta tag。

### 4. Rendered mode contract

Rendered mode 是 inspect-first，不是 edit-first：

- 以 sandboxed `iframe` 顯示 artifact
- 進入 rendered mode 後，line click / hover / definition / references / annotation 等 code affordance 停用
- source view 保留現有 code viewer 能力，不做退化

## UX Strategy

這次要沿用的是 **markdown 的 UX 心智模型**，不是直接共用 markdown renderer：

- 同一檔案可在 `Source` / `Rendered` 間切換
- 預設 source
- rendered 是閱讀 artifact 的另一個 surface

但 HTML 與 markdown 的 implementation 分開處理：

- markdown 繼續走既有 `MarkdownRenderer`
- HTML rendered mode 走 `iframe`

Phase 1 不強求把 markdown / HTML 抽成同一套「通用 view-mode framework」，先把 product behavior 做穩。

## Implementation Plan

## Phase 1: Route and state contract

### Files

- `frontend/src/services/file-location.ts`
- `frontend/src/pages/open/open-file.tsx`
- `frontend/src/pages/files/code-viewer.tsx`

### Tasks

1. 擴充 `FileLocationQuery`
   - 新增 `view?: 'rendered'`
2. 更新 `buildFileLocationUrl()` / `parseFileLocationQuery()`
   - `rendered` 寫入 query
   - `source` 省略 query
3. 更新 `open/file` resolver
   - deep link 若帶 `view=rendered`，要能保留
4. 明確定義 normalize 規則
   - 非法值或不符合 eligibility 的檔案都回 source

### Done when

- `view=rendered` 可穩定參與 browser history / refresh / restore
- 不需要新增另一條 HTML 專用 route

## Phase 2: Frontend-only rendered mode

### Files

- `frontend/src/pages/files/code-viewer.tsx`
- `frontend/src/services/file-preview.ts` 或新增小型 helper

### Tasks

1. 新增 HTML eligibility helper
   - 先用 `path.startsWith('docs/architecture/') && path.endsWith('.html')`
2. 在 file viewer header 顯示 `Source | Rendered` toggle
   - 只對 eligible HTML 顯示
3. rendered mode 使用既有 `file.read` 內容
   - 不走 `file.preview`
   - 前端用 `Blob` / object URL 建立 iframe `src`
4. 切換 lifecycle
   - path 改變或 mode 改變時，更新 / revoke object URL
5. rendered mode UI 降級
   - 停用 code click / hover / annotation affordance
   - 顯示簡單 mode label，讓使用者知道現在在看 artifact，不是 source

### Done when

- 同一個 eligible HTML 檔可在 source / rendered 間切換
- rendered mode 不需要 backend / extension 新增新 protocol
- 非 eligible HTML 維持原本 source 行為

## Phase 3: Sandbox and safety boundary

### Goal

讓 rendered HTML 在 Code Viewer 裡像「放在玻璃箱內展示」，而不是取得 app 主頁的能力。

### Tasks

1. `iframe` 使用 sandbox
   - Phase 1 預設 `allow-scripts`
   - 不給 `allow-same-origin`
2. 明確接受第一版限制
   - 某些下載行為（例如 diagram 內建 `Export SVG`）可能先不開
3. 若後續需要 export/download
   - 再獨立評估是否增加 `allow-downloads`
   - 不跟第一版綁在一起

### Done when

- rendered HTML 不會直接取得 Code Viewer 主頁上下文
- 第一版的互動重點先放在閱讀與基本高亮，不把下載能力當 blocking item

## Phase 4: Verification

### Unit / component

- `file-location` query parse/build 測試新增 `view=rendered`
- eligibility helper 測試
- file viewer 對 eligible HTML 顯示 toggle
- file viewer 對 non-eligible HTML 不顯示 toggle

### E2E / manual

至少驗證：

1. 開 `docs/architecture/**/*.html` 預設是 source
2. 切到 rendered 後會顯示 iframe 內容
3. refresh 後仍維持 rendered
4. back / forward 行為正確
5. 非 `docs/architecture/` 的 HTML 不會突然變 rendered page
6. markdown raw/rendered 行為不被這次改動破壞

## Why Phase 1 stays frontend-only

目前 `file.preview` contract 在 shared / extension / frontend 三層都假設只有：

```text
image | video
```

如果把 HTML 也硬塞進這條管線，會把第一版 scope 擴大成：

- shared preview kind 變更
- extension provider preview logic 變更
- frontend preview rendering tree 變更

但這次需求真正要的是：

```text
同一個 HTML 檔要有 Source / Rendered toggle
```

不是 generic preview MIME 擴充。

所以第一版先做：

- route query contract
- frontend toggle
- frontend iframe render

未來若真的要支援 generic HTML artifact 或 multi-asset web preview，再考慮新增：

- `file.preview.html`
- 或新的 rendered artifact protocol

## Backend Asset Proxy Design

### Why it is needed

`iframe srcDoc` 的 HTML 是一個沒有實體 URL 的文件。瀏覽器看到相對路徑時，沒有辦法自然知道 `./style.css` 應該回到 repo 裡跟目前 HTML 同資料夾的檔案。

所以 asset proxy 的工作不是「再 render 一次 HTML」，而是提供一個受控 HTTP surface，讓 iframe 裡的資源 request 能被轉成：

```text
iframe URL request -> backend route -> selected workspace extension -> validated file read -> HTTP response
```

### Recommended shape

新增 backend HTTP route，形式可以是：

```text
GET /api/workspaces/:workspaceRef/assets/*path
```

或 query 版：

```text
GET /api/assets?workspace=<workspaceRef>&path=<repo-relative-path>
```

建議優先用 path route，因為它可以讓 iframe 裡的相對路徑比較像真實網站：

```text
/api/workspaces/ws_x/assets/docs/architecture/diagram.html
/api/workspaces/ws_x/assets/docs/architecture/style.css
/api/workspaces/ws_x/assets/docs/architecture/image.png
```

HTML rendered mode 不再只用 `srcDoc`，而是建立一個 iframe URL：

```text
iframe.src = backendAssetUrl(workspaceKey, htmlPath)
```

backend 收到 HTML request 後回傳 `text/html`，並且用同一路由服務同資料夾下的 CSS/image/font 等資源。

### Backend request flow

現有 frontend request flow 是：

```text
frontend WS -> backend relay -> selected extension -> backend relay -> frontend WS
```

asset proxy 是 HTTP route，不屬於某個 frontend WebSocket pending request。因此 backend 需要一個新的 internal helper：

```text
requestExtension(extensionId, msg, timeoutMs) -> Promise<WsMessage>
```

這個 helper 應該和 `relayFrontendToExtension()` 使用相同的概念：

- 產生 request id
- 發送 message 到 extension ws
- 用 `replyTo` 等待 extension response
- timeout 後 reject
- response/error 都要清掉 pending entry

但它不應該假裝自己是 frontend，也不該把 response route 給 frontend ws。

### Extension protocol options

有兩個可行方向：

1. Reuse `file.preview` for known binary media and `file.read` for text assets.
   - Pros: shared protocol 幾乎不用擴。
   - Cons: HTTP route 要自己根據副檔名決定讀法與 MIME；目前 `file.preview` 只支援 image/video，font、wasm、pdf、css/js 都不完整。
2. Add a dedicated `file.asset` protocol.
   - Payload: `{ path: string; maxBytes?: number }`
   - Result: `{ path, mimeType, encoding: 'base64' | 'utf-8', data, size, etag? }`
   - Pros: asset proxy 邏輯清楚，MIME/size/caching 可集中處理。
   - Cons: shared types + extension provider + backend route 都要加一條 protocol。

Recommendation: 用 dedicated `file.asset`。Asset proxy 是 HTTP serving concern，不應該把 `file.preview` 從 image/video 拉成萬用檔案讀取 API。

### Security requirements

1. Workspace boundary
   - 必須沿用 extension 端 `validatePath()`，避免 `../` 讀出 workspace 外檔案。
   - Backend 自己也要 normalize path，拒絕空 path、absolute path、含 NUL byte 的 path。
2. Workspace identity
   - route 必須帶 `workspaceRef`，並用 `manager.findWorkspaceByReference()` 找 connected workspace。
   - stale/offline workspace 回 `409` 或 `404`，不要 fallback 到其他 workspace。
3. MIME allowlist
   - 第一版只允許 HTML 常見閱讀資源：
     - `text/html`
     - `text/css`
     - `text/javascript` / `application/javascript`
     - image MIME
     - font MIME
     - `application/json`
     - maybe `image/svg+xml`
   - 不要直接 serve 任意檔案成 `application/octet-stream`，避免 asset proxy 變成任意檔案下載入口。
4. Size limit
   - CSS/JS/HTML/font/image 都要有 byte limit。
   - 第一版可用單一上限，例如 10MB；video 不納入 asset proxy，繼續走既有 media preview。
5. Sandbox interaction
   - iframe 若要執行 repo-local JS，必須考慮是否從 `sandbox=""` 升到 `sandbox="allow-scripts"`。
   - 不建議加 `allow-same-origin`，否則 iframe 內容會更接近同源 app，隔離會變弱。
6. Auth / secret
   - 如果 `CODE_VIEWER_SECRET` 啟用，asset route 也要遵守同一套授權。
   - 但 iframe 的子資源 request 不容易手動帶 secret query；若要支援 secret，建議用短效 signed asset token，而不是把 long-lived secret 寫進每個 iframe URL。

### Correctness requirements

1. Relative URL resolution
   - `diagram.html` 裡的 `./style.css` 要 resolve 成同資料夾下的 `style.css`。
   - `../shared/theme.css` 也應 resolve，但仍不能逃出 workspace。
2. Base URL
   - 用 iframe `src` 指向 backend asset HTML route，比 `srcDoc + <base>` 更自然。
   - 若保留 `srcDoc`，就必須 inject `<base href="/api/workspaces/ws_x/assets/<dir>/">`，但這會改寫 HTML 且容易踩 `<head>` 缺失/重複 base 的問題。
3. Cache behavior
   - 第一版可 `Cache-Control: no-cache`，確保 VS Code dirty/read changes 不被瀏覽器長期快取吃掉。
   - 後續可加 ETag，但必須處理 extension 端 dirty buffer 與 filesystem stat 的差異。
4. Dirty buffer
   - HTML 主檔如果在 VS Code 開著且 dirty，`file.asset` 是否要回 dirty buffer？
   - 建議主 HTML 和 text assets 都優先讀 open document dirty content；binary assets 讀 filesystem。
5. Content rewriting
   - 第一版不要 rewrite HTML/CSS/JS URL，先靠 route base URL 解相對路徑。
   - 只有在遇到 absolute-root path (`/assets/app.css`) 時，再考慮是否提供 workspace-root base semantics。

### Product requirements

1. Keep source-first affordance
   - 使用者仍能回 Raw/Source 看原始 HTML。
2. Make asset support visible
   - 如果 asset load 失敗，iframe 內可能只顯示 broken image；Code Viewer 外層至少要能在 debug mode 提供最近 asset request failures。
3. Do not break markdown
   - Markdown renderer 不應走 asset proxy。
4. Mobile constraints
   - HTML iframe 必須在 mobile viewport 內可 scroll，不要被 outer File View scroll 和 iframe inner scroll 互相卡住。

### Testing requirements

Unit:

- backend route rejects missing workspace, stale workspace, unsafe path, unsupported MIME, oversized file
- path resolver handles `./`, `../`, URL-encoded spaces, and rejects traversal outside workspace
- `file.asset` MIME detection maps CSS/JS/image/font/SVG/HTML correctly

Integration:

- backend HTTP asset route sends request to extension and returns bytes with correct `Content-Type`
- timeout from extension returns `504`
- extension error maps to `404`/`400` instead of hanging

E2E:

- HTML file with `./style.css` changes visible styling in iframe
- HTML file with `./image.png` renders image
- HTML file with `../shared/theme.css` works inside workspace
- traversal attempt like `../../.ssh/id_rsa` fails
- frontend Raw/Rendered toggle still works after refresh and back/forward

### Open design questions before asset proxy implementation

1. Should JS be allowed?
   - Answer for frontend-only `srcDoc`: yes, iframe uses `allow-scripts` but still not `allow-same-origin`.
   - Still decide separately whether a future backend asset proxy should allow repo-local external JS files.
2. Should generic `.html` be supported, or only artifact directories?
   - The current shipped frontend toggle supports generic HTML by languageId.
   - Asset proxy increases risk enough that route-level allowlist may still start with `docs/architecture/` or generator-marked artifacts.
3. How should `CODE_VIEWER_SECRET` work with iframe subresources?
   - Simple no-secret local mode is easy.
   - Secret-enabled mode likely needs signed short-lived asset URLs.
4. Is dirty-buffer support required for linked CSS/JS?
   - Main HTML dirty buffer is valuable.
   - Dirty linked assets require extension to look up open documents by resolved path for every text asset.

## Open Questions

1. `Rendered` mode 是否需要保留 diagram 內建的下載能力？
   - Phase 1 預設先不當必做
2. eligibility 是否永遠只靠 `docs/architecture/**/*.html`？
   - 若未來 artifact 類型變多，可能要增加 generator marker
3. 是否要把 markdown 與 HTML 的 toggle UI 抽成同一個 header component？
   - 第一版不必先做；等 HTML behavior 穩定再整理
