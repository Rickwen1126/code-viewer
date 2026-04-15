# Code Viewer Positioning And Ecosystem Survey

Created: 2026-04-15  
Last Updated: 2026-04-15  
Status: Working draft

## Summary

這輪 survey 後的結論很清楚：

- GitHub 上確實有很多「在手機或 browser 上用 VS Code」的相近方案。
- 但大多數解法不是把整個 VS Code 搬進 browser，就是在手機上重做一個 editor / IDE。
- `Code Viewer` 真正特別的地方，不是它也是 mobile code tool，而是它採用：
  `Desktop VS Code authority -> extension extract -> relay -> mobile-optimized viewer`

換句話說，它不是在重造 IDE，也不是在 browser 中重跑一個完整版 VS Code。

## 問題定義

`Code Viewer` 真正要解的問題不是：

- 怎麼在手機上完整寫 code
- 怎麼在手機 browser 裡跑整套 IDE

而是：

- 用手機進行 AI 協作開發時，如何高品質地做 code review / preview / navigate
- 同時保留 desktop 上已經最強的能力：workspace、Git、LSP、Copilot、CodeTour、既有 extension 生態

這個問題定義很重要，因為它直接決定產品該長什麼樣。

## 核心判斷

### 1. `Code Viewer` 不是 browser IDE

`code-server` / `openvscode-server` 這條路，是把 `VS Code / Code-OSS` 本體搬到 server/browser 模式。

它們的本質是：

- VS Code workbench 仍是主 UI
- browser 只是承載那個 workbench 的容器
- 為了可在 browser 運作，直接 patch/改造上游 VS Code

這條線很強，但問題是：

- 手機瀏覽器上的 interaction model 很差
- UI 本質仍然是 desktop IDE
- 很多能力即使 technically 能跑，也不代表手機上好用

### 2. `Code Viewer` 不是 mobile code editor

另一類專案是在手機上直接做 editor / IDE / Android port。

這類工具也有價值，但它們通常缺少：

- Desktop VS Code 的 workspace authority
- 完整 Git / LSP / extension host 能力
- 既有 Copilot / 開發現場環境
- 跟桌面現場完全對齊的 project context

所以它們比較像：

- mobile-first local editor
- 便攜開發環境
- 輕量修改工具

而不是針對真實 desktop 開發現場的高保真 companion。

### 3. `Code Viewer` 真正強的是 authority model

`Code Viewer` 的強項不只是 UI，而是 authority 的選擇：

- authority 在 Desktop VS Code
- extension 負責讀取真正的工作狀態
- backend 是 relay，不複製 business logic
- mobile 端專注在最適合手機的檢視與導航體驗

這個模型有一個非常強的特性：

> 不需要在手機端重新追趕 VS Code 的 backend 能力。

因為真正的 backend 已經是 Desktop VS Code 本身。

## 跟相近方案的差異

### A. `coder/code-server`

Repo: <https://github.com/coder/code-server>

它的做法不是自製專用 UI，而是：

- 直接把上游 `microsoft/vscode` 當 submodule
- build 時 patch VS Code
- 讓 VS Code workbench 在 browser/server 模式下運作

關鍵訊號：

- `.gitmodules` 指向 `microsoft/vscode`
- `build:vscode`
- 大量 `patches/*.diff`

這代表它的方向是：

> 把 VS Code 帶到 browser

不是：

> 把 VS Code 能力投影到一個專用產品 UI

### B. `gitpod-io/openvscode-server`

Repo: <https://github.com/gitpod-io/openvscode-server>

這條線更明確：

- 它自己就說只做「讓 VS Code 跑在 server scenario 所需的最小改動」
- 核心仍然是 browser-accessible VS Code

所以它也是 browser IDE 路線，不是 mobile companion 路線。

### C. `Acode` / `VSCodeAndroid` / `vsmobile` 這類

代表：

- <https://github.com/Acode-Foundation/Acode>
- <https://github.com/Fundiman/VSCodeAndroid>
- <https://github.com/7HR4IZ3/vsmobile>

這類通常在解：

- 手機上的 local editor
- Android 上的 VS Code-like app
- 行動裝置上的獨立開發環境

但它們多半不是：

- 對接 Desktop VS Code authority
- 對接 desktop Git / LSP / Copilot / CodeTour 現場
- 用 mobile UI 承接 desktop 現場的高保真 review/navigation

## 為什麼這條路是對的

### 1. 真正強的 backend 不在手機端

在這個問題上，最強的 backend 其實已經存在：

- Desktop VS Code
- workspace model
- Git API
- LSP providers
- extension host
- Copilot

所以比較聰明的策略不是在手機上重做一份，而是保留 authority 在原本最強的系統。

### 2. view 應該為場景重做，而不是為了完整而照搬

手機上的需求不是完整 IDE，而是：

- 看檔案
- 導覽
- 搜尋
- 看 diff
- 看 CodeTour
- 快速來回跳轉

這些需求值得一個重新設計過的 interaction model。  
反之，如果只是把整個 VS Code workbench 塞進手機瀏覽器，通常會落入 technically works but practically painful。

### 3. `Code Viewer` 的價值在於「投影」，不是「移植」

最準確的產品描述應該是：

> `Code Viewer` 把 Desktop VS Code 的 authority 與工作狀態，投影到手機上更適合 review / preview / navigation 的產品介面。

這是它跟 browser IDE 或 mobile editor 最本質的差異。

## 實際產品定位建議

避免把 `Code Viewer` 說成：

- mobile VS Code
- browser IDE
- code editor for phone

比較準的說法是：

- mobile companion for Desktop VS Code
- desktop-authority mobile code review tool
- phone-first viewer for real VS Code workspaces

一句話版本：

> `Code Viewer` is a mobile-first companion for Desktop VS Code, not a browser IDE.

## 競品判斷

### 直接競品

目前看下來，直接競品不多。

原因是很少專案同時滿足：

- Desktop VS Code authority
- extension-based extraction
- relay architecture
- mobile-specific review UI

### 鄰近比較對象

比較合理的鄰近比較對象是：

- `code-server`
- `openvscode-server`
- mobile code editors
- Android VS Code ports

但這些工具大多解的不是同一題。

## 工作結論

這輪整理後，可以把 `Code Viewer` 的特殊性濃縮成三句話：

1. 它不是把 IDE 硬搬到手機。
2. 它保留最強的 authority 在 Desktop VS Code。
3. 它針對手機真正需要的 review / preview / navigate 場景，做專用產品介面。

因此，`Code Viewer` 的主要優勢不只是「UI 比別人好看」，而是：

> 它用更正確的系統切分，避開了重做 VS Code backend 與在手機上強行承接 desktop IDE 的兩個大坑。
