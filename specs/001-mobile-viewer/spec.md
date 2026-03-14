# Feature Specification: Mobile Code Viewer

**Feature Branch**: `001-mobile-viewer`
**Created**: 2026-03-14
**Status**: Draft
**Input**: PRD v2 — Desktop VS Code 的 Mobile 延伸，把 VS Code 的檔案瀏覽、LSP、Git、Copilot 能力搬到手機上，觸控優化呈現。

## User Scenarios & Testing *(mandatory)*

### User Story 1 — 手機瀏覽專案檔案 (Priority: P1)

使用者在通勤途中打開手機，連上自己電腦上正在執行的 VS Code，
瀏覽目前開啟的專案檔案樹，點選任一檔案即可看到語法高亮的程式碼，
包含 gitignored 檔案和尚未存檔的修改。

**Why this priority**: 這是產品存在的最基本理由 — 在手機上看 code。
沒有檔案瀏覽，其他所有功能都無法成立。

**Independent Test**: 開啟手機 app，看到 Desktop VS Code 中的專案目錄結構，
點選任一檔案可看到有語法高亮的程式碼內容。

**Acceptance Scenarios**:

1. **Given** 使用者有多個 VS Code 視窗正在執行，各自的 Extension 已連線，
   **When** 使用者在手機上開啟 Mobile Viewer，
   **Then** 先看到工作區選擇頁面，列出所有已連線的 VS Code 實體（顯示專案名稱與路徑）
2. **Given** 使用者在工作區選擇頁面，
   **When** 選擇其中一個 VS Code 實體，
   **Then** 進入該 workspace，看到完整檔案樹（含 gitignored 檔案）
2. **Given** 使用者正在手機上瀏覽檔案樹，
   **When** 點選一個 `.ts` 檔案，
   **Then** 看到有語法高亮、行號的程式碼，可觸控滑動瀏覽
3. **Given** Desktop VS Code 中有一個未存檔的修改檔案，
   **When** 使用者在手機上瀏覽該檔案，
   **Then** 看到的是含未存檔修改的最新內容，且有視覺標示表示未存檔
4. **Given** Desktop VS Code 未執行或 Extension 未連線，
   **When** 使用者開啟 Mobile Viewer，
   **Then** 看到明確的離線狀態提示，已快取的檔案內容仍可瀏覽

---

### User Story 2 — 手機上的 Code Intelligence (Priority: P2)

使用者在手機上閱讀程式碼時，可以 tap 一個 symbol 查看其型別資訊，
長按跳轉到定義，查看所有引用，或瀏覽檔案的 symbol 大綱。
所有智慧均來自 Desktop VS Code 的 LSP。

**Why this priority**: Code intelligence 是「看 code」和「讀懂 code」的差距。
沒有跳轉和型別資訊，手機上的閱讀體驗與純文字無異。

**Independent Test**: 在手機上 tap 一個函式名稱，看到其型別 hover，
長按跳轉到該函式的定義檔案。

**Acceptance Scenarios**:

1. **Given** 使用者在手機上瀏覽一個 TypeScript 檔案，
   **When** tap 一個變數名稱，
   **Then** 看到該變數的型別資訊與文件說明（hover tooltip）
2. **Given** 使用者看到一個函式呼叫，
   **When** 長按或使用「Go to Definition」操作，
   **Then** 跳轉到該函式的定義位置（可能在不同檔案）
3. **Given** 使用者在瀏覽一個較長的檔案，
   **When** 開啟 symbol 大綱面板，
   **Then** 看到該檔案所有 class、function、variable 的結構列表，
   tap 任一項可跳轉到對應位置
4. **Given** 使用者想知道某個函式在哪些地方被使用，
   **When** 選擇「Find All References」操作，
   **Then** 看到所有引用位置的列表，tap 任一項可跳轉

---

### User Story 3 — 手機上的 Git 狀態 (Priority: P3)

使用者想在手機上快速了解目前的 Git 狀態：
在哪個 branch、哪些檔案被修改了、修改了什麼。

**Why this priority**: Git 狀態是 code review 的基礎上下文 —
知道改了什麼才能決定要看什麼。優先序低於直接看 code 但高於 AI 功能。

**Independent Test**: 在手機上看到目前的 branch 名稱和修改檔案列表，
tap 任一修改檔案可看到行級 diff。

**Acceptance Scenarios**:

1. **Given** Desktop VS Code 中有一個 Git 專案，
   **When** 使用者在手機上查看 Git 狀態，
   **Then** 看到目前的 branch 名稱和修改檔案列表（新增/修改/刪除標示）
2. **Given** 修改檔案列表顯示中，
   **When** 使用者 tap 一個修改過的檔案，
   **Then** 看到行級 diff（新增行、刪除行、修改行的視覺差異）

---

### User Story 4 — 接續 Copilot Chat 對話 (Priority: P4)

使用者在電腦上跟 Copilot 討論了一個設計問題，離開電腦後想在手機上
看到剛才的對話歷史，並繼續追問。Copilot 的回答會以 streaming 方式
即時顯示在手機上。

**Why this priority**: Copilot 整合是本產品的核心差異化，
但需要先有穩定的檔案瀏覽和 code intelligence 基礎。

**Independent Test**: 在手機上看到 Desktop VS Code 中的 Copilot Chat 歷史，
送出一個追問，看到 streaming 回答。

**Acceptance Scenarios**:

1. **Given** Desktop VS Code 中有既存的 Copilot Chat session，
   **When** 使用者在手機上開啟 Chat 頁面，
   **Then** 看到所有 session 列表，可選取任一 session 閱讀完整對話歷史
2. **Given** 使用者正在手機上閱讀一個 Chat session，
   **When** 在輸入框打字並送出追問，
   **Then** 看到 Copilot 的回答以 streaming 方式逐字顯示
3. **Given** 使用者在手機上開啟一個新 Chat，
   **When** 送出問題，
   **Then** 回到 Desktop VS Code 時可看到這個 session 也出現在 Chat 歷史中

---

### User Story 5 — 手機上 Review AI 產生的程式碼修改 (Priority: P5)

Copilot 在 Desktop 上產生了程式碼修改建議，使用者想在手機上
看到修改內容的 diff，決定要 approve 或 reject 這些修改。
也包含 Copilot 請求使用工具時的 accept/skip 決策。

**Why this priority**: Edit review 是 Copilot 工作流的關鍵一環，
但使用頻率低於 Chat 對話，且技術複雜度較高。

**Independent Test**: 在手機上看到 Copilot 建議的 diff，
tap approve 後回 Desktop 看到修改已被接受。

**Acceptance Scenarios**:

1. **Given** Desktop VS Code 中 Copilot 產生了 pending edits，
   **When** 使用者在手機上開啟 Review 頁面，
   **Then** 看到每個修改檔案的 diff（新增/刪除/修改行的視覺差異）
2. **Given** 使用者正在手機上 review 一個修改，
   **When** tap「Approve」按鈕，
   **Then** Desktop VS Code 中的修改被接受並套用
3. **Given** 使用者正在手機上 review 一個修改，
   **When** tap「Reject」按鈕，
   **Then** Desktop VS Code 中的修改被丟棄
4. **Given** Copilot 在 Desktop 請求使用一個工具（例如寫入檔案），
   **When** 使用者在手機上看到 tool approval 通知，
   **Then** 可以 accept 或 skip 該工具使用

---

### User Story 6 — 手機上瀏覽 Code Tour (Priority: P6)

使用者的專案中有 `.tours/` 目錄下的 CodeTour 檔案，
想在手機上按步驟閱讀 Tour：每一步顯示對應的程式碼片段與說明文字。
Read-only，與 VS Code 的 CodeTour 體驗一致。

**Why this priority**: Code Tour 是既有功能的延續，
design.pen 中已有完整畫面設計（Tour List + Tour Detail）。
但相對於核心的檔案瀏覽和 Copilot 整合，Tour 的使用頻率較低。

**Independent Test**: 在手機上看到專案的 Tour 列表，
選擇一個 Tour 後逐步瀏覽，每步看到對應程式碼和說明。

**Acceptance Scenarios**:

1. **Given** workspace 中有 `.tours/` 目錄且含有 Tour 定義檔，
   **When** 使用者在手機上開啟 Tours 頁面，
   **Then** 看到所有 Tour 的列表（標題、步驟數、進度狀態）
2. **Given** 使用者選擇了一個 Tour，
   **When** 進入 Tour 詳情頁，
   **Then** 看到目前步驟的程式碼片段（語法高亮）與說明文字
3. **Given** 使用者正在閱讀某個 Tour 步驟，
   **When** tap「Next Step」或 swipe left，
   **Then** 前進到下一步，程式碼片段和說明文字同步更新
4. **Given** 使用者看到步驟中的 `View in Code Viewer` 連結，
   **When** tap 該連結，
   **Then** 跳轉到 Code Viewer 的對應檔案和行號位置

---

### Edge Cases

- Desktop VS Code 在使用者操作手機途中關閉或斷線怎麼辦？
  → 手機端 MUST 即時反映連線狀態，已載入的內容繼續可瀏覽，
  需要即時資料的操作（LSP、Chat）顯示離線提示
- 手機送出 Chat 訊息後、回答完成前斷線怎麼辦？
  → 重連後 MUST 能恢復 session 狀態，不遺失對話
- Desktop 同時開啟多個 VS Code 視窗（多個 Extension 實體）怎麼辦？
  → Backend 與每個 Extension 各自建立獨立 WS 連線，
  手機端顯示工作區選擇頁面列出所有已連線實體，使用者選一個進入
- 使用者正在手機操作某個 workspace，想切換到另一個怎麼辦？
  → MUST 能隨時回到工作區選擇頁面切換
- 某個 VS Code 視窗被關閉（Extension 斷線）怎麼辦？
  → 工作區選擇頁面即時移除該實體；若使用者正在操作該 workspace，
  顯示斷線提示並引導回到選擇頁面
- 非常大的檔案（例如 10 萬行的 generated code）怎麼辦？
  → MUST 採用分段載入策略，避免手機記憶體溢出
- Copilot 回答包含程式碼區塊時怎麼辦？
  → Chat 中的程式碼區塊 MUST 也有語法高亮，與檔案瀏覽一致

## UI/UX 體驗設計 *(mandatory)*

### 設計方向

**視覺識別**：Dark Terminal Luxury — 以 VSCode Dark+ 色調為基礎，
為觸控場景重新設計的沉浸式閱讀體驗。不是 Desktop 的縮小版，
是為手機而生的 code 閱讀器。

**核心體驗原則**：

- **沉浸式閱讀** — 程式碼是主角，UI chrome 退到最小。
  全螢幕沉浸，只在需要時浮現控制項
- **手勢驅動** — 觸控手勢是第一公民，按鈕是 fallback。
  swipe、long press、pinch 構成主要互動語彙
- **即時回饋** — 每個觸控都有視覺回饋，不讓使用者懷疑「按到了嗎？」
  transition 和 micro-interaction 傳達狀態變化
- **深色舒適** — 通勤和夜間使用為主要場景，
  深色主題不是選項而是預設，對比度經過閱讀舒適性調校

### 導航架構

**兩層導航**：Tab Bar（全域切換）+ Stack Navigation（層級深入）

**Tab Bar（底部常駐）**：

| Tab | 功能 | 對應 User Story |
|-----|------|----------------|
| Workspaces | VS Code 實體選擇 / 當前 workspace 總覽 | US1 入口 |
| Files | 檔案樹瀏覽 | US1 |
| Git | Branch 狀態、修改列表、diff | US3 |
| Tours | Code Tour 列表與步驟瀏覽 | US6 |
| Chat | Copilot 對話 session 列表與對話 | US4 |
| Review | Pending edits、tool approval | US5 |

**Stack Navigation（向右推入）**：

- 檔案樹 → 檔案內容 → Symbol action sheet
- Git 修改列表 → 行級 diff
- Chat session 列表 → 對話內容
- Review 檔案列表 → Diff 詳情

**導航手勢**：

- **Swipe right（從左邊緣）** → 返回上一層（Stack pop）
- **Tab bar tap** → 切換全域分頁，回到該分頁的頂層
- **返回工作區選擇** → Tab bar 長按 Workspaces 或專屬返回手勢

### 觸控互動語彙

程式碼閱讀場景的觸控操作 MUST 一致且可預測：

| 手勢 | 程式碼區域的行為 | 其他區域的行為 |
|------|----------------|---------------|
| **Tap** | 顯示 hover tooltip（型別、文件） | 標準選取/導航 |
| **Long press** | 彈出 action sheet（Go to Def、References、Type Def 等） | Context menu |
| **Swipe left/right** | 水平捲動程式碼（長行） | Stack navigation |
| **Swipe up/down** | 垂直捲動 | 垂直捲動 |
| **Pinch** | 程式碼字體縮放 | — |
| **Double tap** | 選取整個 token/word | — |

### 狀態視覺語言

系統有多種即時狀態，MUST 有清晰且不干擾的視覺表達：

| 狀態 | 視覺呈現 |
|------|---------|
| **已連線** | 工作區卡片顯示綠色連線指示點，無額外干擾 |
| **重連中** | 頂部顯示細長的脈動進度條，不遮擋內容 |
| **已斷線** | 頂部常駐 banner 提示離線，可操作已快取內容 |
| **Loading（檔案/LSP）** | 內容區域 skeleton loading，保持 layout 穩定 |
| **Streaming（Chat）** | 文字逐字浮現，游標閃爍表示仍在生成 |
| **Pending review** | Review tab 顯示 badge 數字，表示有待處理項目 |
| **未存檔修改** | 檔案名稱旁顯示圓點標記 |

### 畫面清單

**已有設計（可沿用，需微調）**：

| 畫面 | 來源 | 調整項目 |
|------|------|---------|
| Workspace Selector | design.pen「Repo Selector」 | 改為顯示已連線 VS Code 實體，加入連線狀態指示 |
| File Browser | design.pen「File Browser」 | 直接沿用 |
| Code Viewer + Action Sheet | design.pen「Code Viewer」 | 直接沿用 |
| References List | design.pen「References List」 | 直接沿用 |
| Media Viewer | design.pen「Media Viewer」 | 低優先，可沿用 |
| Tour List | design.pen「Tour List」 | 直接沿用 |
| Code Tour Detail | design.pen「Code Tour」 | 直接沿用，含步驟導航、程式碼片段、Annotations |

**需新設計的畫面**：

| 畫面 | 對應 User Story | 設計重點 |
|------|----------------|---------|
| Git Changes | US3 | 修改檔案列表 + inline diff 檢視，新增/修改/刪除的色彩區分 |
| Chat Session List | US4 | Session 卡片列表，顯示標題、最後活動時間、turn 數 |
| Chat Conversation | US4 | 對話氣泡 + streaming 動畫 + 程式碼區塊語法高亮 |
| Edit Review | US5 | 逐檔 diff 檢視 + approve/reject 操作區 |
| Tool Approval | US5 | 工具名稱、參數摘要、accept/skip 操作 |
| Connection Status | — | 離線 banner、重連動畫、斷線引導 |

### 設計資產沿用

既有的設計系統 MUST 完整沿用到 v2，確保視覺一致性：

- **Design Tokens**（`docs/tokens.md`）：色彩、字型、間距、圓角、陰影
- **色彩系統**：VSCode Dark+ 1:1 對應，含 syntax highlighting 色彩
- **字型**：JetBrains Mono（code）+ Inter（UI text）
- **圖標**：Lucide icon set
- **螢幕基準**：iPhone 402×874px，最小觸控目標 44px

## Requirements *(mandatory)*

### Functional Requirements

**連線與狀態**

- **FR-001**: 系統 MUST 在使用者開啟 Mobile Viewer 時自動嘗試連線到已設定的 Backend
- **FR-002**: 系統 MUST 即時顯示 Desktop VS Code 的連線狀態（已連線/斷線/重連中）
- **FR-003**: 系統 MUST 在斷線後自動嘗試重連，不需使用者手動操作
- **FR-004**: Backend MUST 能同時與多個 VS Code Extension 實體建立 WS 連線（一對多）
- **FR-005**: 系統 MUST 提供工作區選擇頁面，列出所有已連線的 VS Code 實體（專案名稱、路徑、連線狀態）
- **FR-006**: 使用者 MUST 能隨時切換到不同的已連線 VS Code 實體
- **FR-007**: Frontend 與 Backend 之間的通訊 MUST 使用 WebSocket（即時推送、streaming）

**檔案瀏覽**

- **FR-010**: 系統 MUST 顯示 Desktop VS Code workspace 的完整檔案樹
- **FR-011**: 系統 MUST 顯示 gitignored 檔案（與 Desktop VS Code 一致）
- **FR-012**: 系統 MUST 顯示未存檔的檔案內容（dirty buffer）
- **FR-013**: 系統 MUST 對檔案內容提供語法高亮，支援所有主流程式語言
- **FR-014**: 系統 MUST 支援觸控滑動瀏覽程式碼，回應流暢無卡頓
- **FR-015**: 系統 MUST 在離線時仍可瀏覽已快取的檔案內容

**Code Intelligence**

- **FR-020**: 系統 MUST 提供 Go to Definition 功能
- **FR-021**: 系統 MUST 提供 Find All References 功能
- **FR-022**: 系統 MUST 提供 Hover 資訊（型別、文件）
- **FR-023**: 系統 MUST 提供 Document Symbol 大綱瀏覽
- **FR-024**: 所有 Code Intelligence 功能的資料 MUST 來自 Desktop VS Code 的 LSP

**Git**

- **FR-030**: 系統 MUST 顯示目前的 branch 名稱
- **FR-031**: 系統 MUST 顯示修改檔案列表（新增/修改/刪除狀態）
- **FR-032**: 系統 MUST 提供行級 diff 檢視

**Copilot Chat**

- **FR-040**: 系統 MUST 顯示 Desktop VS Code 中既存的 Copilot Chat session 列表
- **FR-041**: 系統 MUST 顯示完整的 Chat 對話歷史（使用者訊息 + Copilot 回答）
- **FR-042**: 使用者 MUST 能在手機上送出新訊息給 Copilot
- **FR-043**: Copilot 的回答 MUST 以 streaming 方式即時顯示
- **FR-044**: Chat 中的程式碼區塊 MUST 有語法高亮

**Edit Review**

- **FR-050**: 系統 MUST 顯示 Copilot 產生的 pending edits diff
- **FR-051**: 使用者 MUST 能 approve 或 reject 每個修改
- **FR-052**: 系統 MUST 顯示 Copilot 的 tool approval 請求
- **FR-053**: 使用者 MUST 能 accept 或 skip tool 使用

**Code Tour**

- **FR-070**: 系統 MUST 讀取 workspace 中 `.tours/` 目錄的 Tour 定義檔
- **FR-071**: 系統 MUST 顯示 Tour 列表（標題、步驟數、完成進度）
- **FR-072**: 系統 MUST 逐步顯示 Tour 內容（程式碼片段 + 說明文字 + 行標註）
- **FR-073**: 使用者 MUST 能在步驟間前進/後退導航
- **FR-074**: Tour 步驟中的程式碼片段 MUST 有語法高亮
- **FR-075**: Tour 步驟 MUST 能連結到 Code Viewer 的對應檔案位置

**UI/UX**

- **FR-060**: 所有觸控目標 MUST 至少 44x44pt
- **FR-061**: 版面配置 MUST 以單手操作為主要考量
- **FR-062**: 手勢操作（swipe 返回、long press 觸發 context menu）MUST 優先於按鈕
- **FR-063**: 系統 MUST NOT 使用 hover 作為主要互動方式

### Key Entities

- **VS Code Instance**: 一個正在執行的 Desktop VS Code 視窗，
  對應一個 Extension WS 連線。使用者可能同時有多個 instance 在執行。
- **Workspace**: VS Code Instance 中開啟的專案，
  包含檔案樹、Git 狀態、LSP 能力。
- **File**: 專案中的檔案，屬性包含路徑、內容、語法類型、
  是否 gitignored、是否有未存檔修改。
- **Chat Session**: 一段 Copilot 對話，包含多個 turn
  （使用者訊息 + Copilot 回答），隸屬於某個 workspace。
- **Pending Edit**: Copilot 建議的程式碼修改，
  包含目標檔案、diff 內容、approve/reject 狀態。
- **Tool Request**: Copilot 請求執行的工具操作，
  包含工具名稱、參數、accept/skip 狀態。
- **Code Tour**: `.tours/` 目錄下的 Tour 定義，
  包含標題、步驟列表、每步對應的檔案位置與說明文字。

### Assumptions

- 使用者與 Desktop VS Code 在同一 Tailscale tailnet 內，
  Mobile 可透過 Tailscale IP 連到 Backend
- 單一使用者場景，不需要考慮多使用者權限管理
- Desktop VS Code 執行中為正常使用前提，離線為 degraded mode
- 使用者已有 GitHub Copilot 訂閱（Copilot 功能的前提）
- 所有三端通訊均使用 WebSocket：Extension↔Backend（資料通道）、Frontend↔Backend（即時推送 + streaming）
- 一個 VS Code 視窗 = 一個 Extension 實體 = 一條 WS 連線

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 使用者可在 5 秒內從開啟 app 到看見專案檔案樹
- **SC-002**: 點選檔案後 2 秒內看到有語法高亮的完整內容
- **SC-003**: Go to Definition 操作在 3 秒內完成跳轉
- **SC-004**: Copilot Chat streaming 回答的首字延遲不超過 5 秒
- **SC-005**: 所有觸控操作的回應延遲低於 200ms（不含網路往返）
- **SC-006**: 離線時已快取的檔案可在 1 秒內開啟
- **SC-007**: 使用者完成一次完整的 code review 流程
  （瀏覽檔案→看 diff→approve/reject）不需要回到電腦
