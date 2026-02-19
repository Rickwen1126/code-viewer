<!--
Sync Impact Report
- Version change: N/A → 1.0.0 (initial ratification)
- Added principles:
  1. Mobile-First 設計
  2. Review 功能優先
  3. VSCode 能力最大化
  4. Extension API 委託
  5. 後端極簡
  6. UI/UX 至上
  7. 繁體中文文件規範
- Added sections:
  - Core Principles (7 principles)
  - 技術約束
  - 開發工作流
  - Governance
- Removed sections: N/A (initial creation)
- Templates requiring updates:
  - .specify/templates/plan-template.md ✅ no update needed
  - .specify/templates/spec-template.md ✅ no update needed
  - .specify/templates/tasks-template.md ✅ no update needed
  - .specify/templates/commands/ — no command files exist
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

MUST 盡可能利用 VSCode / code-server 已有的能力，避免重複實作。

- 語言支援（LSP、語法解析、diagnostics）MUST 完全委託 VSCode
- 所有 code intelligence 功能 MUST 以 VSCode Extension API
  為主要資料來源
- 不得自行實作任何程式語言的 parser 或 type checker
- 搜尋功能可例外使用 ripgrep 直接執行
  （因不依賴 LSP 且效能更佳）

**理由**：VSCode 生態系已涵蓋數百種語言的支援，
自行實作不僅浪費資源，品質也必然不如 VSCode 原生支援。

### IV. Extension API 委託

非必要 MUST NOT 自行實作功能，
MUST 從 VSCode Extension API 取得所需能力。

- 檔案系統操作 MUST 透過 `workspace.fs` API
- 程式碼導航 MUST 透過 `execute*Provider` 系列 API
- Git 狀態 MUST 透過 Git Extension API
- 只有在 Extension API 確實不提供的功能，才允許自行實作
- 自行實作前 MUST 先確認 Extension API 無法滿足需求並記錄理由

**理由**：委託給 Extension API 確保功能的正確性與一致性，
同時大幅降低維護成本。

### V. 後端極簡

後端 MUST 保持最簡單的架構，主要職責為 proxy / pass-through。

- 後端 MUST NOT 包含業務邏輯，
  除非該邏輯無法在前端或 Extension 中執行
- API 設計 MUST 以透傳 Extension 回應為主，避免加工轉換
- 搜尋（ripgrep）與檔案系統直接存取為允許的例外
- 快取層 SHOULD 保持簡單（記憶體快取為主）
- 資料庫使用 SHOULD 限制在必要場景（如 Q&A 問答儲存）

**理由**：後端越簡單，維護成本越低、除錯越容易。
複雜邏輯應集中在 VSCode Extension 和前端 UI。

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

## 技術約束

- **前端框架**：React + Shiki（語法高亮在瀏覽器端渲染）
- **後端框架**：Hono（已有基礎建設）
- **VSCode 後端**：code-server（headless 模式）
- **通訊協定**：Extension 主動以 WebSocket 連向 Backend
- **部署方式**：Docker Compose（含 Cloudflared tunnel）
- **降級策略**：code-server 離線時 MUST 自動降級至
  Tree-sitter / ctags fallback，基本功能不中斷
- **Workspace 管理**：透過 `workspace.updateWorkspaceFolders()`
  動態管理，不活躍的 workspace SHOULD 自動 timeout 移除

## 開發工作流

- 功能開發 MUST 遵循 Spec → Plan → Tasks 流程
- 每個 User Story MUST 可獨立測試與交付
- Code review MUST 驗證是否符合本 Constitution 的原則
- 新增自行實作的功能前，MUST 先確認 Extension API 無法滿足
  並在 PR 中記錄理由
- 前端變更 MUST 在實際行動裝置上驗證（非僅模擬器）

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

**Version**: 1.0.0 | **Ratified**: 2026-02-19 | **Last Amended**: 2026-02-19
