# HTML Rendered Toggle Preview — Implementation Plan

Created: 2026-05-31 14:56
Last Updated: 2026-05-31 14:56
Status: Draft

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

## Open Questions

1. `Rendered` mode 是否需要保留 diagram 內建的下載能力？
   - Phase 1 預設先不當必做
2. eligibility 是否永遠只靠 `docs/architecture/**/*.html`？
   - 若未來 artifact 類型變多，可能要增加 generator marker
3. 是否要把 markdown 與 HTML 的 toggle UI 抽成同一個 header component？
   - 第一版不必先做；等 HTML behavior 穩定再整理
