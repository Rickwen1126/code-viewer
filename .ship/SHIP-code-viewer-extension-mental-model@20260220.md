# SHIP: Code Viewer Extension 心智模型

tags: [ship, vscode-extension, code-viewer, mental-model]

## Relations
- ship_plan_for [[vscode-mobile-view-prd]]

## 1. Problem Statement

**問題**：實驗 6/6 全過，但我不理解背後的機制。如果直接進入開發，我會是在 vibe coding——不知道為什麼能跑、不知道什麼時候會壞、無法 review AI 寫的 extension code。

**對象**：自己（Code Viewer 專案的開發者）

**成功條件**：能用自己的話解釋 extension 架構的運作原理，能預測「改這個會影響什麼」，能看出 AI 寫的 extension code 裡的問題。

## 2. Solution Space

不適用（這是學習/知識確認 SHIP，不是技術方案選擇 SHIP）。

技術方案已在 PRD + 實驗中確認：code-server + Extension API proxy + WebSocket bridge。
本 SHIP 聚焦於「我夠不夠理解這個方案來正確實作它」。

## 3. 技術決策清單

| 決策點 | 選擇 | 原因 | 備選 |
|--------|------|------|------|
| Extension runtime | code-server (Node.js extension host) | 完整 API、不需桌面 VSCode | Desktop extension（多 instance 路由問題） |
| 通訊方式 | Extension 主動 WebSocket 連 Backend | 不開 port、自動重連 | Backend 連 Extension（需 Extension 開 port） |
| LSP 資料來源 | `execute*Provider` 命令 | 直接用 VSCode 已有能力 | 自建 language server（成本太高） |
| 檔案存取 | `workspace.fs` API | 不 respect gitignore、含未存檔修改 | 直接讀 filesystem（少了 VSCode 抽象層） |
| 語法高亮 | Shiki（前端） | 不經 Extension、減少傳輸 | Extension 端做 token map（資料量大） |
| Extension 打包 | esbuild bundle | vsce 不含 node_modules | webpack（也行但 esbuild 更快） |

## 4. 橫向掃描

未做。Extension 開發是新領域，沒有參考專案可比。

## 5. 知識風險標記

### [B]lock（不理解，會影響方向）— 3 個

#### B1: Extension Host 架構
**為什麼不懂這個會影響選擇**：如果不理解 extension code 跑在哪個 process、能存取什麼資源，我就無法判斷：為什麼 `ws` 能用、為什麼 `fs` 能存取、為什麼某些 API 只在 Node.js host 有用。遇到 bug 時不知道從哪層開始查。

- 解什麼問題：Extension Host 是 VS Code 用來跑 extension 的獨立 Node.js child process，提供完整 Node.js 能力 + vscode API，同時與 UI 隔離
- 用錯會怎樣：如果宣告成 `"browser"` 而非 `"main"`，extension 會跑在瀏覽器 web worker sandbox 裡，只拿到輕量 API 子集，所有核心能力（fs、ws、executeProvider、Git API）全部不可用
- 為什麼選這做法：我們需要嫁接 VS Code 的能力（LSP、Git、Diagnostics），vscode API 物件只有在 Extension Host 內部才拿得到。另外設獨立 Backend 是因為 Extension Host 的 lifecycle 不可控（parent process 隨時可能殺掉它），Backend 確保 UI/UX 連續性 + fallback 能力

Exit Questions:
1. ✅ Extension code 跑在 server 端獨立的 Node.js child process（Extension Host），擁有完整 Node.js 能力（fs, network, child_process）
2. ✅ 瀏覽器的 `WebSocket` 是瀏覽器 API，Extension Host 是 Node.js process 沒有這個全域物件，必須用 npm 的 `ws` package
3. ✅ `"main"` 欄位指定 Node.js host，`"browser"` 欄位指定 web worker host。我們必須用 `"main"` 因為需要完整 Node.js + vscode API

狀態：✅ 已解除

---

#### B2: Provider / Command 模式
**為什麼不懂這個會影響選擇**：`executeDefinitionProvider` 是整個 LSP proxy 的核心。如果不理解這個 command 背後是誰在提供資料、什麼條件下會回空、什麼條件下會慢，我就無法設計 Backend 的 retry/fallback 策略，也無法判斷回傳結果是否正確。

- 解什麼問題：`execute*Provider` 是 VS Code 的統一查詢窗口，把請求轉給有註冊對應 provider 的語言 extension，語言 extension 再透過 LSP 問背後的 Language Server（真正的 compiler/parser）
- 用錯會怎樣：如果沒有安裝對應語言的 extension（例如只有 TypeScript 卻開 .py），provider 查詢會回空陣列——不是 bug，是沒有人註冊來處理這個語言
- 為什麼選這做法：我們 leverage VS Code 已經包裝好的 API 界面，不需要自己直接跟各語言的 Language Server 用 LSP 通訊，否則等於自己重建一個 VS Code

Exit Questions:
1. ✅ VS Code command system 找到有註冊對應語言 provider 的 extension 來回答；沒安裝就回空陣列
2. ✅ LSP 是語言 extension 和背後 Language Server（如 tsserver）之間的通訊協定；我們的 bridge extension 不實作任何 provider，只消費 VS Code 已有的結果
3. ✅ warmup 是 Language Server（如 tsserver）在建立專案型別圖譜的過程；不同查詢需要不同深度的圖譜——reference/symbols 較早可用，hover/definition 需要完整型別推導才能回答

狀態：✅ 已解除

---

#### B3: Extension 生命週期
**為什麼不懂這個會影響選擇**：WebSocket 連線的建立時機、斷線重連策略、資源清理都取決於 extension 的生命週期。如果不理解 activate/deactivate 的時機，我的 WebSocket bridge 可能在錯誤的時候連線、或者在 extension 被殺掉時留下殭屍連線。

- 解什麼問題：Extension lifecycle 由 VS Code 控制——activationEvents 決定何時啟動，deactivate() 是清理機會。Extension Host 綁在 server session 不綁在瀏覽器連線，但首次需要瀏覽器連入喚醒
- 用錯會怎樣：如果 deactivate() 不關 WebSocket，Backend 不知道 extension 已死，無法切換 fallback，手機端會收到大量錯誤；如果用 `*` activation，在語言 extension 還沒註冊完 provider 時就建連線，拿不到任何有用資料
- 為什麼選這做法：`onStartupFinished` 確保所有語言 extension 和 Git extension 都就緒後才啟動，WebSocket 連線建立時 provider 已可用

Exit Questions:
1. ✅ `onStartupFinished` 等 VS Code 完全就緒後才 activate；`*` 太早，語言 extension 可能還沒註冊完 provider
2. ✅ [Spike 已驗證] 無瀏覽器連入時 Extension Host 不存在；瀏覽器連入後啟動；瀏覽器關閉後 Extension Host 仍存活（綁在 server session，至少 4 分鐘不死）
3. ✅ context.subscriptions 自動 dispose VS Code 的東西（command、event listener）；WebSocket 等自己開的資源要在 deactivate() 手動關閉

狀態：✅ 已解除

---

### [R]isky（大概懂但不確定）

#### R1: Extension 打包機制
我知道要用 esbuild bundle，也踩過 `ws` 沒被打包的坑，但不完全理解：為什麼 vsce 不打包 node_modules？VSIX 格式到底是什麼？`--external:vscode` 的意義？

Exit Questions:
1. VSIX 檔案裡面包含什麼？為什麼 vsce 故意不把 node_modules 打包進去？ **[A]**

#### R2: Workspace 模型（single vs multi-root）
實驗中 `updateWorkspaceFolders()` 成功了，但我不確定：什麼是「multi-root workspace」？為什麼從 single 變 multi-root 會觸發 extension restart？這對我的 WebSocket 連線有什麼影響？

Exit Questions:
1. single-folder workspace 和 multi-root workspace 在 extension 行為上的具體差異是什麼？為什麼轉換時 extension 會 restart？ **[A]**

#### R3: `extensionDependencies` 機制
我知道要宣告 `"extensionDependencies": ["vscode.git"]`，但不清楚如果不宣告會怎樣。Git extension 的 API 是怎麼暴露出來給其他 extension 用的？

Exit Questions:
1. `extensionDependencies` 跟 npm 的 `dependencies` 有什麼不同？如果不宣告直接呼叫 `getExtension('vscode.git')`，最壞情況是什麼？ **[A]**

---

### Spike 計畫（B 類 Exit Questions 分群）

只有一個 B 類 exit question：**B3 Q2**（code-server 無瀏覽器連入時的 extension host 行為）

- **Spike 1**: Extension Host 生死觀察
  - 覆蓋：B3 Q2
  - 做什麼：啟動 code-server Docker，不開瀏覽器，觀察 extension host 是否啟動。然後開瀏覽器觸發 activate，再關掉瀏覽器，觀察 extension host 和 WebSocket 連線是否存活。用 `docker exec` + process list 觀察。
  - 預計時間：15 min

---

### [N]ice-to-know（不影響方向）

- Open-VSX vs Microsoft Marketplace 的政治問題
- WebView API（本專案不需要）
- Extension 測試框架（`@vscode/test-electron`）
- Extension 發布流程（我們不上 marketplace）
- `proposed API` / Insiders-only API

## 6. 開工決策

- [x] 所有 [B]lock 已解除（B1 ✅ B2 ✅ B3 ✅）
- [x] [B]lock ≤ 3 個（剛好 3 個）
- [x] Problem Statement 清晰
- [x] Solution Space 有比較過（在 PRD 階段已完成）
- [x] 技術決策都有根據

**狀態**：✅ 可開工
