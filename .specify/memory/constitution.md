<!--
Sync Impact Report
- Version change: 1.0.0 → 1.1.0 (MINOR — new principle added, technical constraints materially updated)
- Modified principles:
  - §III "VSCode 能力最大化": mechanism changed from code-server to Desktop VS Code Extension
  - §V "後端極簡": scope narrowed to pure WS relay + session cache
- Added principles:
  - §VIII "Copilot 鏡像整合"
- Added sections: N/A
- Removed sections: N/A
- Modified sections:
  - 技術約束: VSCode 後端、部署方式、降級策略、Workspace 管理全部更新
- Templates requiring updates:
  - .specify/templates/plan-template.md ✅ no update needed (Constitution Check is dynamic)
  - .specify/templates/spec-template.md ✅ no update needed
  - .specify/templates/tasks-template.md ✅ no update needed
  - .specify/templates/commands/ — directory does not exist
- Follow-up TODOs: none
-->

# Code Viewer Constitution

## Core Principles

### I. Mobile-First 設計

所有 UI 設計 MUST 以行動裝置為首要目標進行設計，
而非從桌面版本降級適配。

- 所有互動元素 MUST 符合觸控操作標準（最小觸控目標 44x44pt）
- 版面配置 MUST 以單手操作為主要考量
- 手勢操作（swipe、long press、pinch）MUST 優先於按鈕操作
- 禁止使用 hover 作為主要互動方式（行動裝置無 hover）
- 字體大小 MUST 確保在行動裝置上的可讀性

**理由**：本專案存在的核心原因是解決行動端瀏覽 VSCode 體驗差的問題，
如果 UI 不是 mobile-first，則失去專案存在的意義。

### II. Review 功能優先

功能開發的優先序 MUST 以 code review 使用場景為最高優先。

- 檔案瀏覽、程式碼閱讀、跳轉定義等 review 核心功能 MUST 優先實作
- 編輯、除錯等非 review 功能 SHOULD NOT 在初期實作
- 功能排序發生衝突時，有利於 review 的功能 MUST 勝出
- Tour 整合與 Q&A 標註系統屬於 review 輔助功能，
  優先序次於核心 review

**理由**：行動端最常見的使用場景是閱讀與審查程式碼，
而非編寫程式碼。聚焦 review 能讓產品在最核心場景上做到最好。

### III. VSCode 能力最大化

MUST 盡可能利用使用者本機 Desktop VS Code 已有的能力，避免重複實作。

- 語言支援（LSP、語法解析、diagnostics）MUST 完全委託
  使用者本機的 Desktop VS Code
- 所有 code intelligence 功能 MUST 以 VSCode Extension API
  為主要資料來源
- 不得自行實作任何程式語言的 parser 或 type checker
- 搜尋功能可例外使用 ripgrep 直接執行
  （因不依賴 LSP 且效能更佳）

**理由**：使用者的 Desktop VS Code 已具備完整的語言支援生態系，
包含已安裝的 Extensions、LSP servers、以及 Copilot 等 AI 能力。
透過 Extension 直接存取這些能力，比自行架設 code-server 更穩定、
更完整、且維護成本更低。

### IV. Extension API 委託

非必要 MUST NOT 自行實作功能，
MUST 從 VSCode Extension API 取得所需能力。

- 檔案系統操作 MUST 透過 `workspace.fs` API
- 程式碼導航 MUST 透過 `execute*Provider` 系列 API
- Git 狀態 MUST 透過 Git Extension API
- AI 能力 MUST 透過 `vscode.lm` API 或 Copilot Commands
- 只有在 Extension API 確實不提供的功能，才允許自行實作
- 自行實作前 MUST 先確認 Extension API 無法滿足需求並記錄理由

**理由**：委託給 Extension API 確保功能的正確性與一致性，
同時大幅降低維護成本。

### V. 後端極簡

後端 MUST 保持最簡單的架構，職責限縮為 WebSocket relay
與 session 快取。

- 後端 MUST NOT 包含業務邏輯，所有智慧均在 Extension 端
- 後端的主要角色為 WebSocket relay：
  Mobile ↔ Backend ↔ Extension（Desktop VS Code）
- Session 狀態（對話歷史、檔案狀態）SHOULD 以記憶體快取為主
- 後端 MUST NOT 直接存取程式碼或執行 code intelligence
- 資料庫使用 SHOULD 限制在必要場景（如持久化 session）

**理由**：後端越簡單，維護成本越低、除錯越容易。
所有智慧集中在使用者本機的 VS Code Extension，
後端只負責把 Mobile 和 Desktop 連起來。

### VI. UI/UX 至上

UI/UX 品質是本專案最重要的功能，
MUST 優先於技術完備性。

- 使用者體驗 MUST 優先於功能數量
- 動畫、過渡效果、載入狀態 MUST 精心設計
- 錯誤狀態 MUST 提供清晰的使用者提示，
  而非技術性錯誤訊息
- 每個功能上線前 MUST 在實際行動裝置上測試體驗
- 效能（載入速度、回應時間）直接影響 UX，MUST 列入設計考量

**理由**：本專案的核心差異化在於提供比 VSCode web 更好的
行動端體驗，如果 UI/UX 不夠好，使用者沒有理由使用本產品。

### VII. 繁體中文文件規範

所有 SPEC、PLAN、TASKS 文件 MUST 以繁體中文撰寫。

- 規格書（spec.md）MUST 使用繁體中文
- 實作計畫（plan.md）MUST 使用繁體中文
- 任務清單（tasks.md）MUST 使用繁體中文
- 程式碼中的變數名稱與註解 SHOULD 使用英文（國際慣例）
- API 文件與技術規格可使用英文

**理由**：繁體中文為團隊主要溝通語言，
使用母語撰寫規格文件能提高理解精確度並降低溝通成本。

### VIII. Copilot 鏡像整合

Copilot 相關功能 MUST 鏡像 VS Code 原生行為，
MUST NOT 自行實作 AI 對話或程式碼生成邏輯。

- Chat 對話 MUST 透過 `vscode.lm` API 或
  `workbench.action.chat.open` + `previousRequests` 達成
- Edit review MUST 透過 `chat.review.apply/discard`、
  `chat.undoEdit/redoEdit` 等 Commands 達成
- Tool approval MUST 透過 `chat.acceptTool/skipTool`、
  `chat.acceptElicitation` 等 Commands 達成
- Session 接續 MUST 透過讀取 `.jsonl` session 檔案 +
  `openSessionInEditorGroup` 達成
- API 變動追蹤 MUST 透過 `microsoft/vscode`（MIT）與
  `microsoft/vscode-copilot-chat`（MIT）開源碼 diff 監控

**理由**：VS Code Copilot 的所有互動皆可透過 Public API
與 Commands 程式化操作（已由實驗 Phase A/B/C 全面驗證）。
鏡像而非重造確保功能完整且隨 VS Code 更新自動受益。
兩個核心 repo 皆為 MIT 開源，API 變動可第一時間追蹤。

## 技術約束

- **前端框架**：React + Shiki（語法高亮在瀏覽器端渲染）
- **後端框架**：Hono（輕量 WebSocket relay）
- **VSCode 整合**：Desktop VS Code Extension（使用者本機安裝）
- **通訊協定**：Extension 主動以 WebSocket 連向 Backend
  （Extension MUST NOT 開啟任何 port）
- **AI 能力**：透過 `vscode.lm` API 存取使用者已訂閱的
  Copilot 模型（50+ models，含 GPT、Claude、Gemini）
- **部署方式**：Backend 可獨立部署（Docker 或直接執行），
  Extension 以 `.vsix` 安裝至使用者本機 VS Code
- **前置條件**：使用者 MUST 在本機執行 Desktop VS Code
  並安裝本專案 Extension，Backend 需可從 Mobile 端存取
- **降級策略**：Desktop VS Code 離線時，Mobile 端 MUST
  顯示明確的離線狀態提示，已快取的檔案內容 SHOULD 仍可瀏覽
- **API 穩定度分層**：
  1. Public API（⭐⭐⭐⭐⭐）：`vscode.lm`、LSP、
     `workspace.fs`、Git — 有版本保證
  2. Commands（⭐⭐⭐⭐）：`chat.open`、`review.apply`、
     `acceptTool` — 透過開源 source diff 追蹤
  3. 檔案/SQLite（⭐⭐⭐）：chatSessions `.jsonl`、
     `state.vscdb` — 主力用 Public API 可不依賴

## 開發工作流

- 功能開發 MUST 遵循 Spec → Plan → Tasks 流程
- 每個 User Story MUST 可獨立測試與交付
- Code review MUST 驗證是否符合本 Constitution 的原則
- 新增自行實作的功能前，MUST 先確認 Extension API 無法滿足
  並在 PR 中記錄理由
- 前端變更 MUST 在實際行動裝置上驗證（非僅模擬器）
- Extension API 使用 SHOULD 優先選擇穩定度最高的層級

## Governance

本 Constitution 為專案最高指導原則，
所有設計與實作決策 MUST 符合上述原則。

- 修訂 Constitution MUST 記錄變更內容、理由與影響範圍
- 修訂版本號遵循語意化版本（Semantic Versioning）：
  - MAJOR：原則刪除或根本性重新定義
  - MINOR：新增原則或大幅擴充既有原則
  - PATCH：措辭修正、錯字修復、非語意性調整
- 所有 PR MUST 驗證是否符合 Constitution 原則
- 複雜度超出原則限制的設計 MUST 附上正當理由

**Version**: 1.1.0 | **Ratified**: 2026-02-19 | **Last Amended**: 2026-03-14
