# Feature Specification: Foundation — 檔案瀏覽與語法高亮

**Feature Branch**: `001-foundation`
**Created**: 2026-02-21
**Status**: Draft
**Input**: Phase 1 Foundation — 在手機上瀏覽本地開發環境的檔案，具備語法高亮、目錄導航，並透過 code-server + Extension + Backend 三層架構提供服務。

## Clarifications

### Session 2026-02-25

- Q: 檔案 API 存取範圍——使用者能否存取已設定專案根目錄以外的路徑？ → A: 檔案存取限制在 server 端設定的 project directories 內。Server 端設定檔可增刪可存取的目錄。手機端為 read-only，只能瀏覽被設定的目錄。
- Q: 部署模式 → A: 系統一律在 Docker 中運行並 expose port，這是唯一支援的部署方式。
- Q: 存取模式 → A: 系統為 read-only viewer。唯一可編輯的是 Tour 檔案，且透過 Tour 專屬頁面處理（屬 Phase 4 scope），不屬於通用檔案編輯。手機編輯程式碼不務實。
- Q: 超大檔案的具體閾值與行為？ → A: 5MB threshold，超過後顯示前 1000 行。
- Q: PC 瀏覽器連入時畫面如何呈現？是否需要 responsive 切版？ → A: 不做 PC responsive 切版。PC 瀏覽器連入時以 mobile layout 居中顯示（max-width 480px），背景色填滿。Mobile-First 原則，PC 只是可用但不最佳化。
- Q: Foundation 階段是否需要手勢操作（swipe, long press, pinch）？ → A: Foundation 階段豁免。核心動作為 tap 展開/收合 + scroll 瀏覽，手勢互動（swipe-back 導航、long press 複製等）屬後續 Phase UX 強化 scope。Constitution 手勢 MUST 在整體產品層級滿足，不要求每個 Phase 都滿足。

## User Scenarios & Testing *(mandatory)*

### User Story 1 — 手機瀏覽專案檔案樹 (Priority: P1)

使用者在手機上開啟 Code Viewer，選擇一個已設定的專案後，看到完整的檔案樹（包含 gitignored 的檔案），可以點擊資料夾展開/收合，點擊檔案進入閱讀。

**Why this priority**: 這是整個產品的核心入口。沒有檔案樹，後續所有功能都無法使用。

**Independent Test**: 開啟 app → 選專案 → 看到檔案樹 → 點擊展開資料夾 → 確認 gitignored 檔案可見。

**Acceptance Scenarios**:

1. **Given** 使用者已連線到系統且有至少一個已設定專案，**When** 使用者選擇該專案，**Then** 系統顯示該專案根目錄的檔案與資料夾列表
2. **Given** 檔案樹已顯示，**When** 使用者點擊一個資料夾，**Then** 該資料夾展開顯示其子項目
3. **Given** 專案中存在被 `.gitignore` 排除的檔案（如 `node_modules/`、`.env`），**When** 檔案樹載入完成，**Then** 這些檔案仍然可見於檔案樹中
4. **Given** 檔案樹已展開某資料夾，**When** 使用者再次點擊該資料夾，**Then** 資料夾收合

---

### User Story 2 — 閱讀檔案內容（語法高亮）(Priority: P1)

使用者在檔案樹中點擊一個檔案，系統顯示該檔案內容，並根據檔案類型套用語法高亮。程式碼以手機友好的排版呈現（適當字體大小、可水平捲動）。

**Why this priority**: 閱讀程式碼是 code review 的核心動作，與檔案樹同為最基礎功能。

**Independent Test**: 點擊 `.ts` 檔案 → 看到語法高亮的內容 → 行號顯示 → 可上下左右捲動。

**Acceptance Scenarios**:

1. **Given** 使用者在檔案樹中，**When** 點擊一個檔案（如 `server.ts`），**Then** 系統顯示該檔案的完整內容，並有行號
2. **Given** 檔案內容已顯示，**When** 檔案為已知語言（TypeScript、JavaScript、Python、Go 等），**Then** 內容套用對應的語法高亮
3. **Given** 檔案內容已顯示，**When** 程式碼行寬超過螢幕，**Then** 使用者可水平捲動查看完整行內容
4. **Given** 檔案內容已顯示，**When** 使用者在手機上閱讀，**Then** 字體大小足以閱讀（不需額外放大）

---

### User Story 3 — 專案選擇與切換 (Priority: P2)

使用者開啟 Code Viewer 後看到可用專案列表，選擇一個專案進入檔案瀏覽。也可以切換到另一個專案。

**Why this priority**: 多專案支援是日常使用的基礎，但可以先用單一專案做 MVP。

**Independent Test**: 開啟 app → 看到專案列表 → 選擇 A 專案 → 切換到 B 專案 → 確認檔案樹更新。

**Acceptance Scenarios**:

1. **Given** 系統已設定多個專案，**When** 使用者開啟 Code Viewer，**Then** 顯示所有可用專案的列表
2. **Given** 使用者正在瀏覽 A 專案，**When** 使用者切換到 B 專案，**Then** 檔案樹更新為 B 專案的內容
3. **Given** 系統未設定任何專案，**When** 使用者開啟 Code Viewer，**Then** 顯示明確的提示訊息引導使用者設定專案

---

### User Story 4 — 系統離線時的基本可用性 (Priority: P3)

當 code-server 未啟動或斷線時，系統仍能提供基本的檔案瀏覽功能（透過 fallback 機制直接讀取檔案系統），讓使用者不至於完全無法使用。

**Why this priority**: 降級策略是架構設計的核心原則之一，但可以在基本功能穩定後再完善。

**Independent Test**: 關閉 code-server → 開啟 app → 仍可看到檔案樹 → 仍可閱讀檔案內容（語法高亮由前端處理，不受影響）。

**Acceptance Scenarios**:

1. **Given** code-server 未啟動，**When** 使用者選擇專案瀏覽檔案，**Then** 系統透過 fallback 機制仍能顯示檔案樹
2. **Given** code-server 在使用途中斷線，**When** 使用者繼續瀏覽，**Then** 系統自動切換至 fallback 模式並顯示提示
3. **Given** code-server 從離線恢復上線，**When** 系統偵測到恢復，**Then** 自動切回 Extension 模式，使用者無需手動操作

---

### Edge Cases

- 使用者嘗試開啟超大檔案（超過 5MB 的 log 或 minified JS）時如何處理？
  → 顯示前 1000 行並提示檔案已截斷
- 使用者嘗試開啟二進位檔案（圖片、編譯產物）時如何處理？
  → 系統應偵測二進位檔案並顯示檔案資訊（大小、類型），而非嘗試渲染內容
- 網路極慢或不穩定時的體驗？
  → 所有非同步操作需有載入狀態指示，逾時後顯示重試選項
- 專案路徑包含特殊字元（空白、中文）時是否正常運作？
  → 系統須正確處理任意合法檔案路徑
- Extension 啟動中（warmup 期間）使用者就開始操作？
  → 系統應顯示「正在準備」狀態，warmup 完成前可使用 fallback 功能

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 系統 MUST 顯示指定專案的完整檔案樹，包含被 `.gitignore` 排除的檔案
- **FR-002**: 系統 MUST 支援檔案樹的展開與收合操作
- **FR-003**: 系統 MUST 顯示檔案內容並附帶行號
- **FR-004**: 系統 MUST 對已知程式語言套用語法高亮
- **FR-005**: 系統 MUST 在手機上提供可閱讀的程式碼排版（適當字體大小、水平捲動）
- **FR-006**: 系統 MUST 提供專案列表供使用者選擇與切換
- **FR-007**: 系統 MUST 在 code-server 離線時透過 fallback 機制提供檔案瀏覽功能
- **FR-008**: 系統 MUST 在 code-server 上線/離線狀態變化時自動切換模式，並向使用者顯示目前狀態
- **FR-009**: 系統 MUST 偵測二進位檔案並顯示檔案資訊而非嘗試渲染
- **FR-010**: 系統 MUST 對超過 5MB 的檔案顯示前 1000 行，並提示檔案已截斷
- **FR-011**: 系統 MUST 為所有非同步操作提供載入狀態指示
- **FR-012**: 系統 MUST 正確處理包含特殊字元的檔案路徑
- **FR-013**: 系統 MUST 將檔案存取範圍限制在 server 端設定檔中定義的 project directories 內，拒絕存取範圍外的路徑
- **FR-014**: 系統 MUST 為 read-only viewer，不提供任何檔案編輯功能。Tour 編輯透過專屬頁面處理，屬後續 Phase scope

### Key Entities

- **Project（專案）**: 代表一個本地開發專案，包含名稱、根目錄路徑。來源為 server 端設定檔，可動態增刪。
- **FileNode（檔案節點）**: 代表檔案樹中的一個項目，具有名稱、路徑、類型（檔案/資料夾）、子節點（若為資料夾）。
- **FileContent（檔案內容）**: 代表一個檔案的內容，包含文字內容、語言類型（用於語法高亮）、檔案大小。
- **BridgeStatus（橋接狀態）**: 代表 Extension 與 Backend 之間連線的狀態（connected / disconnected / warming_up）。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 使用者從開啟 app 到看到檔案樹，整體流程可在 5 秒內完成（含專案選擇）
- **SC-002**: 點擊檔案後，內容（含語法高亮）在 2 秒內完成渲染
- **SC-003**: 語法高亮支援至少 20 種常見程式語言（TypeScript, JavaScript, Python, Go, Rust, Java, C, C++, HTML, CSS, JSON, YAML, Markdown, Shell, SQL, Ruby, Swift, Kotlin, Dart, PHP）
- **SC-004**: code-server 離線時，fallback 檔案瀏覽功能在 3 秒內回應
- **SC-005**: 手機上閱讀程式碼不需要額外的縮放操作即可辨識文字
- **SC-006**: gitignored 檔案的可見率為 100%（所有 gitignored 檔案都出現在檔案樹中）
- **SC-007**: 所有檔案存取請求 MUST 限制在已設定的 project directories 內，範圍外路徑存取成功率為 0%

## Assumptions

- 專案設定（名稱與路徑）來自 server 端設定檔，server 端可增刪可存取的目錄
- 認證機制透過 Cloudflared tunnel 的存取控制處理，本階段不需要在 app 層實作登入系統
- 語法高亮在前端渲染（不依賴 code-server），因此離線模式下語法高亮仍然可用
- 每次只有一個使用者同時使用系統（單人工具，不需要多使用者同時存取的考量）
- Fallback 模式下的檔案瀏覽透過 Backend 直接讀取檔案系統實現，不需要額外的索引或快取
- 系統一律在 Docker 容器中運行並 expose port，這是唯一支援的部署方式
- Foundation 階段為純 read-only viewer。Tour 編輯功能屬 Phase 4 scope，透過 Tour 專屬頁面處理
- Workspace auto-timeout（不活躍 workspace 自動移除）為後續 Phase scope，Foundation 只實作手動 add/remove
