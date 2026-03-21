# Code Viewer PRD v2

**Version**: 1.0 | **Date**: 2026-03-14 | **Author**: Rick

## 1. Problem

**原有痛點**（仍然成立）：

1. **必須 push 到 git 才能看** — 與 local 開發優先的工作流衝突
2. **gitignore 的檔案看不到** — generated code、config、build artifacts 被排除
3. **Sourcegraph 太重** — 完整 SG server 只為了手機看 code
4. **Code intelligence 受限** — 未設定 SCIP indexer 時跳轉精度等同 ctags

**新增痛點**（Copilot 時代）：

5. **手機上沒有 AI 輔助** — Copilot Chat、edit review、tool approval 全部只能在 Desktop 操作，離開電腦就斷了
6. **對話無法跨裝置延續** — 在 Desktop 跟 Copilot 討論到一半，手機上看不到也接不上
7. **Mobile VS Code Web 體驗極差** — vscode.dev 在手機上幾乎無法使用，鍵盤佔半螢幕、觸控不友善

## 2. Target User

**主要使用者**：開發者本人（Rick）

- 日常在 Desktop VS Code 開發，使用 Copilot 做 code review、AI 對話、edit review
- 離開電腦後（通勤、沙發、bed）想用手機延續工作：
  - 看剛才在改的 code
  - 接續 Copilot 對話
  - Review Copilot 產生的 edit（approve / reject）
  - 標記問題，回電腦再處理
- 技術背景深，不需要降低門檻，但要求體驗流暢

**使用情境**：

| 情境 | 頻率 | 動作 |
|------|------|------|
| 通勤讀 code | 每天 | 瀏覽檔案、跳轉定義、看 symbol 結構 |
| 接續 Copilot 對話 | 每天 | 看歷史、問追問、看回答 |
| Review AI edits | 常見 | 看 diff、approve/reject changes |
| 標記問題 | 偶爾 | 選行範圍、寫問題、回電腦用 AI 回答 |
| 分享程式碼片段 | 偶爾 | 選行範圍、複製/截圖 |

**前置條件**：

- 使用者本機 MUST 正在執行 Desktop VS Code
- VS Code MUST 已安裝 Code Viewer Bridge Extension
- 使用者 MUST 有 GitHub Copilot 訂閱（用於 AI 功能）

## 3. Solution

**一句話定位**：Desktop VS Code 的 Mobile 延伸 — 把你電腦上 VS Code 的所有能力（檔案、LSP、Copilot）透過 Extension 搬到手機上，觸控優化呈現。

**架構概覽**：

```
Desktop VS Code          Backend (Hono)         Mobile Viewer (React)
┌────────────────┐       ┌───────────────┐       ┌───────────────┐
│ Code Viewer    │       │               │       │               │
│ Extension      │──WS──▶│  WS relay     │◀─HTTPS─│  Shiki        │
│                │       │  Session cache│       │  Touch UI     │
│ - workspace.fs │       │  Auth         │       │  Chat UI      │
│ - LSP proxy    │       │               │       │  Diff review  │
│ - Git API      │       └───────────────┘       └───────────────┘
│ - vscode.lm    │
│ - Chat cmds    │       Extension 是 WS client
└────────────────┘       不在使用者電腦開 port
```

**三層職責**：

| 層 | 職責 | 關鍵字 |
|---|------|--------|
| **Extension** | 所有智慧：LSP、檔案、Git、Copilot LM、Chat Commands | 資料提供者 |
| **Backend** | 純 relay：WS 轉發、session 快取、auth | 管道 |
| **Mobile Viewer** | 純呈現：語法高亮、touch UI、Chat/Diff 互動 | 體驗層 |

**核心原則**：Extension 拿得到的，Mobile 就能呈現。Backend 不加工，只搬運。

## 4. Features

### P1 — Core（MVP，離開這些就不成立）

| Feature | 說明 |
|---------|------|
| 檔案瀏覽 | 樹狀結構 + 搜尋，含 gitignored 檔案、未存檔修改 |
| 檔案內容 | 語法高亮（Shiki）、行號、觸控 scroll |
| Code intelligence | Go to definition、references、hover、symbol 列表 — 全部來自 VS Code LSP |
| Git 狀態 | Branch、修改檔案列表、行級 diff |
| 離線提示 | Desktop VS Code 斷線時，明確告知使用者，已快取內容仍可瀏覽 |

### P2 — Copilot 整合（核心差異化）

| Feature | 說明 |
|---------|------|
| Chat 對話 | 瀏覽既有 Copilot Chat 歷史、送新訊息、看 streaming 回答 |
| Session 接續 | 手機上看到 Desktop 的 Chat session，可接續對話 |
| Edit review | 看 Copilot 產生的程式碼修改 diff，approve / reject |
| Tool approval | Copilot 要求使用工具時，手機上可 accept / skip |

### P3 — 增強（有了更好，MVP 可不做）

| Feature | 說明 |
|---------|------|
| 全文搜尋 | ripgrep 驅動 |
| Q&A 標註 | 選行範圍標記問題，回電腦用 AI 回答 |
| Tour 整合 | CodeTour 步驟在 viewer 裡渲染 |

## 5. Non-Goals

- **不做程式碼編輯** — 手機上寫 code 體驗極差，不值得投入
- **不做 terminal** — 超出 review 場景
- **不自建 AI** — 所有 AI 能力來自使用者的 Copilot 訂閱，不自行呼叫 API
- **不支援無 Desktop VS Code 的場景** — 電腦必須開著 VS Code，這是設計前提不是缺陷
- **不做多人協作** — 這是個人工具

## 6. Key Design Decisions

| 決策 | 為什麼 |
|------|--------|
| Desktop VS Code 而非 code-server | 實驗驗證 code-server Extension Host 不可靠；Desktop 有完整 Copilot、50+ models |
| Extension 是 WS client 不是 server | 不在使用者電腦開 port，安全且穿透 NAT |
| 鏡像 Copilot 而非重造 | vscode + vscode-copilot-chat 皆 MIT 開源，API 可追蹤，重造無意義 |
| 語法高亮在前端做 | Shiki 在瀏覽器跑，不需要 Extension 傳 token map |
| Backend 極簡 relay | 業務邏輯在 Extension，Backend 越薄越好維護 |

## 7. Phases

| Phase | 交付物 | 可獨立 demo |
|-------|--------|-------------|
| **1. 連線骨架** | Extension ↔ Backend ↔ Mobile 三端通訊建立 | 手機看到 VS Code 連線狀態 |
| **2. 檔案瀏覽** | 樹狀目錄 + 檔案內容 + Shiki 高亮 | 手機上瀏覽任意專案檔案 |
| **3. Code Intelligence** | Definition / References / Hover / Symbols | 手機上 tap 跳轉、看型別 |
| **4. Copilot Chat** | Chat 歷史 + 送訊息 + streaming 回答 | 手機上跟 Copilot 對話 |
| **5. Edit Review** | Diff 呈現 + approve/reject + tool approval | 手機上 review AI 修改 |
| **6. 增強功能** | 搜尋、Q&A、Tour | 完整體驗 |
