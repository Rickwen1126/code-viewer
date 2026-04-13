# Semantic Location History — Implementation Plan

**Created**: 2026-04-12  
**Last Updated**: 2026-04-13  
**Status**: Draft  
**Spec**: [spec.md](./spec.md)  
**Audit**: [cache-audit.md](./cache-audit.md)

---

## 目標

在不破壞既有 user-friendly 體驗的前提下，把 semantic navigation 正規化為：

- browser-history-first
- semantic location URL-addressable
- `push / replace / unwind` 三種操作分工明確

這次實作不是單純把 state 從 localStorage 搬到 URL，而是：

1. 先定義 location contract
2. 再盤點目前所有 local cache / route state / restore 機制
3. 只移除那些已被新 contract 取代、且不再提供高價值 UX 的部分

---

## 第一原則

### 1. Browser correctness first

凡是使用者感知為「我去另一個地方看東西」的操作，都應參與 browser history。

### 2. 不要把好用 UX 當成 accidental complexity 直接刪掉

目前有些 UX 雖然靠 localStorage / cache / route state 實現，但對使用者很有價值，不能因為新 contract 進場就直接移除。

### 3. 先盤點，再簡化

Phase 1 的目標是讓導航正確，不是一次清空所有舊狀態機制。  
任何 local cache / restore 行為若暫時還在提供高價值 UX，就先保留，等新 contract 穩定後再決定是否降級為 fallback 或移除。

### 4. 保留行為，不保留舊 code

這次遷移的契約是：

- 保留的是 user-visible behavior
- 不是某個 localStorage key、某段 route state、或某個目前碰巧生效的舊 implementation

若新的 URL-based semantic location contract 能更直接地 cover 舊 UX，就以新 contract 為主；舊機制只需保留到：

- 仍提供額外價值，或
- 在過渡期仍是必要 fallback

---

## Current Status Snapshot

截至 `2026-04-13`，以下基礎能力已落地：

1. **Phase 0 audit 已建立**
   - `cache-audit.md` 已盤點 current cache / restore / preference / performance cache
2. **Canonical file semantic location 已落地**
   - file URL 已支援 `line` / `endLine`
   - same-file 與 cross-file code jump 已參與 history
3. **Tour / Git detour contract 已落地**
   - `Back to Tour` / `Back to Diff` 已用 `unwind`
4. **Opaque `workspaceKey` public contract 已落地**
   - public deep link 不再以 absolute `rootPath` 為 canonical identifier
5. **`/files/*` media preview 已落地**
   - image / video preview 已可在 file viewer 中顯示

因此後續優先順序不再是「先 cleanup 再擴功能」，而是：

1. 先補齊 **E2E contract / checklist**
2. 再完成本輪剩餘 feature tranche
3. 跑一次完整 full E2E regression
4. 最後才做 state cleanup
5. cleanup 後再跑一次 full E2E regression

### Current execution note

- `extension Copy Mobile Link` 已明確延後，記錄於 `docs/todo/2026-04-13.md`
- 目前 active implementation slice 改為 **Phase 2 state cleanup**
- Phase 2 的第一刀應優先清掉已被 canonical URL contract 取代的 legacy location truth，而不是先碰 convenience restore / preference / cache
- Tour progress 這輪的方向是：detail route 只信 URL，resume UX 留在列表入口處理
- current-file 這輪的方向是：workspace-scoped stable key 為主，舊 `extensionId/global` key 只保留 migration fallback

---

## Phase 0: Current Cache / Restore Audit

### 目標

在開始改 navigation code 前，先釐清目前所有與「位置、返回、restore、cache」相關的實作，並把使用者已經受益的 UX 明確列出。

### 檔案

- `frontend/src/app.tsx`
- `frontend/src/hooks/use-workspace.tsx`
- `frontend/src/services/cache.ts`
- `frontend/src/pages/files/file-browser.tsx`
- `frontend/src/pages/files/code-viewer.tsx`
- `frontend/src/pages/tours/tour-detail.tsx`
- `frontend/src/pages/git/index.tsx`
- 其他實際發現有 location/cache 角色的檔案

### Audit 產物

Phase 0 不是只做一次口頭盤點，而是要落成可持續更新的 audit 文件：

- `docs/semantic-location-history/cache-audit.md`

這份 audit 至少要包含：

- storage key / cache store 名稱
- 讀寫位置
- 使用者可感知的 UX
- 類型分類
  - canonical location
  - convenience restore
  - preference
  - performance cache
  - transient UI state
- Phase 1 策略
  - keep
  - keep-as-fallback
  - migrate-to-URL
  - evaluate-in-phase-2
- 備註
  - 若某個 UX 是多個機制共同形成，要明確寫出組合關係

### 任務

1. 建立一份 **location/cache behavior matrix**
   - state 來源
     - URL path/query
     - `history.state` / `location.state`
     - localStorage
     - IndexedDB cache
   - state 類型
     - canonical location
     - convenience restore
     - preference
     - transient UI state
2. 逐條記錄目前帶來的 UX
   - 是否 user-visible
   - 是否高價值
   - 是否應保留
   - Phase 1 保留 / Phase 2 再處理 / 可直接淘汰
3. 明確找出「目前其實很好用」的行為來源
   - 不只記錄表象，也記錄是哪些 storage key / cache path / route state 共同造成
4. 補出 migration safety list
   - 哪些舊機制 Phase 1 不可碰
   - 哪些只能降級為 fallback，不能立即刪
5. 為每個高價值 UX 補一個「replacement path」
   - 舊 implementation 是什麼
   - 新 contract 如何 cover
   - 遷移後舊機制是保留、降級 fallback、還是移除

### 目前已知 must-preserve 候選

以下行為在進 implementation 前就先視為高價值 UX 候選，除非 audit 證明不是：

1. **Initial redirect 直接回上次檔案**
   - `app.tsx` 會從 `code-viewer:selected-workspace` + `code-viewer:current-file(:extensionId)` 直接決定入口
2. **Recent files 清單**
   - `file-browser.tsx` 會維護 `code-viewer:recent-files`
3. **從 recent file 回到上次看的位置**
   - `code-viewer.tsx` 會對每個 `workspace + path` 保存 `code-viewer:scroll:*`
   - recent file 點進去後沒有 `scrollToLine` 時，會走 scroll restore
4. **File Browser 自動展開到 current file**
   - `file-browser.tsx` 會讀 `code-viewer:current-file` 與 `code-viewer:expanded-dirs`
5. **Workspace reload 後自動 rebind**
   - `use-workspace.tsx` 會用 `code-viewer:selected-workspace` 在 reconnect 後做 `connection.selectWorkspace`
6. **Code Viewer cache-first**
   - `cache.ts` 的 IndexedDB `file-content`
7. **Git cache-first**
   - `cache.ts` 的 IndexedDB `git-status`
8. **Tour 進度恢復**
   - `tour-detail.tsx` 的 `tour-progress:<extensionId>:<tourId>`
9. **閱讀偏好**
   - `code-viewer:font-size`
   - `code-viewer:wrap-enabled`
   - `code-viewer:md-view-mode`
10. **Chat new session 自動帶入 current file**
   - `chat/conversation.tsx` 會讀 `code-viewer:current-file`

### 至少要盤點的當前 UX

1. **Recent files -> reopen file**
   - 目前來自 `code-viewer:recent-files`
2. **從 recent file 點回去時仍回到上次看的位置**
   - 目前由 `code-viewer:current-file` + per-file scroll localStorage + `CodeViewerPage` scroll restore 共同形成
3. **File Browser 自動展開到 current file**
   - 目前來自 `code-viewer:current-file` + expanded dirs restore
4. **Workspace reload 後自動 rebind**
   - 目前來自 `code-viewer:selected-workspace`
5. **Code Viewer cache-first 顯示**
   - 目前來自 IndexedDB `file-content`
6. **Git 頁 cache-first 顯示**
   - 目前來自 IndexedDB `git-status`
7. **Tour step 恢復**
   - 目前主要來自 `tour-progress:<extensionId>:<tourId>`
8. **各種偏好設定**
   - word wrap
   - markdown raw/rendered
   - font size
9. **不應升格成 canonical URL 的 state**
   - search panel
   - hover popover
   - toast
   - Step+ toggle

### 完成標準

- 有一份可讀的 behavior matrix
- 能回答「某個 UX 是靠什麼做出來的」
- 能回答「這個 UX 在 Phase 1 要保留、降級為 fallback、還是可移除」
- 能回答「新的 URL/history contract 是否已經完整 cover 這個 UX」
- 任何改 navigation 的 PR / milestone 都必須明確對照這份 audit，而不是默默假設 cache 行為不重要
- Phase 1 實作前，不再需要靠印象判斷哪些 state 可以刪

---

## Phase 1: Canonical Semantic Location (Completed)

### 目標

先讓 location 真相進 URL，並讓 semantic navigation 正確進入 browser history。

### 任務

1. File location URL 化
   - `/files/:path?line=&endLine=`
2. Code jump `push`
   - same-file jump 也必須創造真正的 history entry
3. URL 成為 file location 真相
   - `location.state.scrollToLine` 在這階段可暫留為 fallback，不再當 primary truth
4. 確保 refresh / direct entry 可還原 file location

### 完成標準

- file semantic location 不再依賴 `location.state` 才能正確還原
- Back/Forward 能處理 same-file 與 cross-file code jump

---

## Phase 2: Tour / Git Context Integration (Completed)

### 目標

把 Tour 和 Git 納入同一套 semantic location history contract。

### 任務

1. Tour step URL 化
   - `/tours/:tourId?step=N`
2. Tour Next / Prev 用 `replace`
3. Tour -> Code 用 `push`
4. Git diff -> Code 用 `push`
5. `Back to Tour` / `Back to Diff` 用 `unwind`
   - 優先回到已存在的 anchor entry
   - 不建立新的 fake return page
6. detour metadata 存於 `history.state`
   - 不進 canonical URL

### 完成標準

- Tour 內部步驟不污染 browser history
- 從 Tour/Git detour 進 code 後可精準 unwind 回 anchor
- 不出現 history loop

---

## Phase 3: External Deep-Link Public Identity Hardening (Completed)

### 目標

把目前已經可用的 deep-link stack，從 interim 的 `workspace=<rootPath>` 收斂成正式的 public contract：

- public URL 使用 opaque `workspaceKey`
- backend 維護 live key map 解析到 `rootPath`
- `rootPath` 不再出現在 canonical public deep links

### 為什麼這是一個獨立階段

這不是單純 rename query param，而是 public contract hardening：

- 牽涉 shared / backend / frontend resolver / CLI
- 牽涉隱私面與連結穩定性
- 目前 branch 已有可工作的 MVP，因此這一階段的目標是「替換 public identifier」，不是推翻整個 deep-link flow

### 任務

1. 定義 `workspaceKey` contract
   - opaque
   - public-safe
   - 不可直接暴露 `rootPath`
2. backend 維護 live key map
   - `workspaceKey -> rootPath`
   - `rootPath -> workspaceKey`
3. workspace list / admin surfaces 補上 `workspaceKey`
   - 給 frontend resolver 與 CLI 使用
4. `/api/links/file` 改以 `workspaceKey` 作為 public output contract
   - 若 migration 需要，可暫時接受 `rootPath` 作為輸入，但輸出不可再暴露它
5. `/open/file` resolver 改消費 `workspaceKey`
   - 不再拿 URL query 直接比對 `rootPath`
6. CLI `link file`
   - 本地可繼續接受 `--workspace <rootPath>`
   - 但輸出 link 前必須先向 backend resolve 成 `workspaceKey`
7. 規劃 migration / compatibility
   - 已存在的 `workspace=<rootPath>` link 如何過渡
   - 是否提供 backend 端兼容解析期

### 完成標準

- public deep link 不再包含 absolute local workspace path
- 同一個 live workspace 在 reconnect 後，link identity 不會無謂變動
- backend / frontend / CLI 共用同一套 `workspaceKey` contract
- 使用者仍可從 agent / CLI / copied link 直接打開正確 workspace 與 file

---

## Phase 4: E2E Contract Expansion

### 目標

先把 `/e2e-test` 的 pass contract 與 checklist 擴成能覆蓋本輪 feature tranche，而不是在功能還沒疊完時反覆重跑一份過時的 full checklist。

### 任務

1. 補 semantic link / deep-link 的 checklist
   - `/open/file`
   - `Back to Tour`
   - `Back to Diff`
2. 補 media preview 的 checklist
   - image preview
   - video preview
3. 為本輪尚未完成的 feature 預留 checklist 與 pass criteria
   - Git media-aware flow
   - `link diff`
   - `link tour-step`
   - extension `Copy Mobile Link`
4. 明確區分兩種測試：
   - **focused feature E2E**：每個功能完成後立即驗
   - **full regression `/e2e-test`**：整輪 feature tranche 完成後才跑
5. 明確補上 mixed-surface validation 規則
   - 若功能起點在 backend / CLI / extension，必須先在來源 surface 驗證 URL 產出
   - 再用 mobile web 消費該 URL，證明端到端可用

### 完成標準

- `/e2e-test` skill 已反映本輪 feature tranche 的新能力
- 每個新功能都有明確的 focused E2E 驗證目標
- full checklist 不再只反映舊功能集

---

## Phase 5: Remaining Feature Tranche

### 目標

完成本輪已明確決定要一起交付、且會改變 user-facing capability 的剩餘功能。

### 任務

1. Git media-aware flow
   - 在 Git flow 中對 binary / media 檔案提供合理的 preview / open path
2. `link diff`
   - 讓 agent / CLI / backend 能直接產出 diff deep link
3. `link tour-step`
   - 讓 agent / CLI / backend 能直接產出某個 tour step 的 deep link
4. extension `Copy Mobile Link`
   - 直接從 desktop VS Code 取得可在 mobile web 打開的 canonical URL

### 交付方式

- 每完成一個 feature，就補對應 focused E2E
- 此階段 **不** 以 full `/e2e-test` 作為主要節奏
- 除非 feature 影響既有 checklist 項目，否則不先跑整包 regression

---

## Phase 6: Full Feature Regression Gate

### 目標

在本輪 feature tranche 全部落地後，再跑一次完整 `/e2e-test`，驗證整體功能疊加後仍然可用。

### 任務

1. 用更新後的 checklist 跑完整 `/e2e-test`
2. 補齊新增功能的缺口
3. 若 full regression 揭露契約缺陷，先修功能/契約，再進 cleanup

### 完成標準

- 全部已完成功能都被 full checklist 覆蓋
- 不存在只在 focused E2E 通過、整體 regression 卻失敗的狀態

---

## Phase 7: State Simplification After Stability

### 目標

在 feature tranche 已定型、且 full regression 已先證明可用之後，再清理哪些舊機制已不再是 location 真相。

### 任務

1. 對照 Phase 0 matrix，重新分類：
   - canonical truth
   - fallback restore
   - preference only
   - removable
2. 降級或移除被 URL 取代的 location-like state
3. 保留高價值 convenience UX
   - 例如 last file reopen
   - 例如 scroll restore
   - 例如 auto-expand-to-current-file
4. 補 migration notes
   - 哪些行為是 intentional retained UX
   - 哪些舊行為已不再保證

### 為什麼 cleanup 放在這裡

這一階段 side effect 最大。若在 feature tranche 期間就先 cleanup，會同時混雜：

- 新能力擴張
- E2E checklist 擴張
- location truth / fallback 重整

這會讓失敗來源變得難以隔離。因此 cleanup 明確放在：

- 新功能已齊
- full regression 已先跑過

之後再做，語義最乾淨。

### 原則

- URL 應成為 location truth
- localStorage / IndexedDB 可以繼續承擔：
  - preferences
  - performance cache
  - convenience restore

但不應再悄悄成為 semantic navigation correctness 的唯一來源

---

## Phase 8: Post-Cleanup Full Regression Gate

### 目標

在 state cleanup 完成後，再跑一次完整 `/e2e-test`，證明「保留行為、不保留舊 code」這個契約成立。

### 任務

1. 用與 Phase 6 相同的 full checklist 重跑
2. 對照 `cache-audit.md` 驗證 must-preserve UX
3. 補出 cleanup regression 或缺失

### 完成標準

- semantic URL / history contract 仍正確
- must-preserve UX 仍存在
- 已移除或降級的舊 state 不再偷偷成為唯一真相來源

---

## 驗證方式

### Navigation correctness

1. same-file Go to Definition -> Back 返回原 line
2. cross-file Go to Definition -> Back 返回原 file + line
3. Tour Next / Prev 不製造一格一格的 browser history
4. Tour -> Code -> `Back to Tour` 直接 unwind 回原 step
5. Git diff -> Code -> `Back to Diff` 直接 unwind 回原 diff
6. direct link / copied link / generated link 都能直接打開正確 semantic location

### UX preservation

1. recent files 仍可用
2. recent file reopen 後仍盡量回到上次位置
3. File Browser 仍能展開到 current file
4. workspace reload 後仍能自動 rebind
5. cache-first 體感不要明顯退化
6. new link-producing surfaces 產出的 URL 可被 mobile web 直接消費

### Guardrail

如果某個「看起來 accidental」的機制，實際上承載了高價值 UX，必須：

- 明確記錄
- 決定保留或重建
- 不可在沒有替代方案的情況下直接刪除

---

## 建議切法

### Milestone A

- 完成 Phase 0 audit
- 補 behavior matrix
- 鎖定哪些 UX 是 must-preserve

### Milestone B

- 完成 file semantic URL
- 完成 code jump `push`

### Milestone C

- 完成 Tour/Git context integration
- 完成 `unwind`

### Milestone D

- 更新 `/e2e-test` contract
- 補 semantic link / media preview / upcoming feature checklist

### Milestone E

- 完成本輪剩餘 feature tranche
- 每個 feature 補 focused E2E

### Milestone F

- 跑完整 `/e2e-test`

### Milestone G

- state simplification
- fallback/UX cleanup

### Milestone H

- cleanup 後再跑完整 `/e2e-test`
