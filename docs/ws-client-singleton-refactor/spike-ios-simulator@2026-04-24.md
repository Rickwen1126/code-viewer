# Spike: iOS Simulator — Safari WebSocket 事件時序觀察

Created: 2026-04-24
Status: 待執行
執行者: Codex
預計時間: 30-45 min

## 目標

用 iOS Simulator + Safari Web Inspector 精確記錄 Safari/iOS PWA 在背景恢復時的 WebSocket 事件時序。**我們需要 ground truth，不是猜測。**

三輪補丁都基於「猜測 race condition → 加 guard」，每次都猜錯或猜不完整。這次用 Simulator 拿到實際數據再設計。

## 要回答的 5 個問題

| # | 問題 | 為什麼重要 |
|---|------|-----------|
| Q1 | Safari 背景凍結 30s 後恢復，`visibilitychange` 和 `ws.onclose` 哪個先觸發？間隔多久？ | 決定 race window 有多大，收口設計是否需要延遲等 onclose |
| Q2 | 背景凍結後 `ws.readyState` 的實際值是什麼？ | 決定 zombie 偵測邏輯是否正確（目前用 `readyState > OPEN`） |
| Q3 | BFCache restore 時 `pageshow persisted` 值？舊 WebSocket 狀態？ | 決定 pageshow handler 是否必要，BFCache 是否真的會保留 dead socket |
| Q4 | 快速切出切入時，是否產生多個 concurrent `openSocket()` 呼叫？ | 驗證 timer 競爭假設 |
| Q5 | 問題是「socket 建不起來」還是「socket 建起來了但 state 沒更新」？ | 決定修的是 transport 層還是 state 通知層 |

## 前置條件

### 服務狀態

Backend 和 Frontend 必須在 Mac 上跑著：
- Backend: port `4800`（確認 `lsof -i :4800` 有 LISTEN）
- Frontend: port `4801`（確認 `lsof -i :4801` 有 LISTEN）

如果沒跑，啟動方式：
```bash
cd /Users/rickwen/code/code-viewer
# Backend
cd backend && pnpm dev &
# Frontend (dev mode，有 source map)
cd frontend && pnpm dev --port 4801 --host &
```

### 網路 IP

Mac 有兩個可用 IP：
- LAN: `10.0.4.5`（本地 WiFi）
- Tailscale: `100.112.227.109`

Simulator 用 LAN IP：`http://10.0.4.5:4801`

### VS Code Extension

至少一個 VS Code 視窗要開著且 extension enabled（`codeViewer.enabled: true`），這樣 workspace list 才有內容可以操作。

## 環境設定步驟

### Step 0: 啟動 iOS Simulator

```bash
# 列出可用 device
xcrun simctl list devices available | grep iPhone

# 啟動（選 iPhone 15 或任何 iOS 17+ 裝置）
# 如果已經有 booted 的就跳過
xcrun simctl boot "iPhone 16"
open -a Simulator
```

### Step 1: 在 Simulator Safari 裡開啟前端

```bash
xcrun simctl openurl booted "http://10.0.4.5:4801"
```

或者手動在 Simulator Safari 輸入 `http://10.0.4.5:4801`。

### Step 2: 開啟 debug mode

在 Safari Web Inspector Console 執行：
```javascript
localStorage.setItem('code-viewer:debug', 'true')
location.reload()
```

### Step 3: 連接 Safari Web Inspector

1. 開 Mac 上的 **Safari**（不是 Chrome）
2. Safari menu → **Develop** → **Simulator - iPhone XX** → 選擇頁面
3. 切到 **Console** tab
4. 勾選 **Preserve Log**（重要！背景恢復後 console 不清除）

如果 Develop menu 沒出現：Safari → Settings → Advanced → 勾 "Show features for web developers"

### Step 4: 確認基線

Console 應該看到：
```
[ws] state: disconnected → connecting (0 listeners)
[ws] state: connecting → connected (5 listeners)
```

選一個 workspace 進入 file view，確認功能正常。

## 實驗步驟

**每個實驗結束後，把完整 console output 複製到結果區域。**

格式要求：每條 log 前面標注相對時間戳（從背景恢復那一刻起算為 T+0）。

---

### 實驗 1: 基線 — 正常連線

**目的**：確認 log 格式正確，建立正常連線的 baseline。

**步驟**：
1. 重新載入頁面（`location.reload()`）
2. 等待 connected
3. 選 workspace → 進 file view
4. 記錄全部 console log

**預期**：
```
[ws] state: disconnected → connecting
[ws] pageshow: persisted=false, ws=0, state=connecting
[ws] state: connecting → connected
```

**記錄**：
```
（貼 console output）
```

---

### 實驗 2: 短暫背景（3 秒）

**目的**：確認短暫背景是否觸發任何 reconnect 行為。

**步驟**：
1. 確認已 connected + 在 file view
2. 按 Home 鍵切到背景（Simulator: `Cmd+Shift+H`，或 `xcrun simctl ui booted home`）
3. 等 3 秒
4. 點 app icon 切回前景
5. 記錄 console log（從 `visibilitychange: hidden` 開始）

**要記錄的數據**：
- `visibilitychange` hidden 是否觸發？
- `visibilitychange` visible 觸發時 `ws.readyState` 值是什麼？
- probe（ping）是否被送出？結果？
- state 是否有變化？

**記錄**：
```
（貼 console output）
```

---

### 實驗 3: 長時間背景（30 秒）

**目的**：這是 bug 最常出現的場景。確認 Safari 凍結 JS 後 WebSocket 的實際狀態。

**步驟**：
1. 確認已 connected + 在 file view
2. 按 Home 鍵切到背景
3. **等 30 秒**（用 Mac 上的計時器，不要提前切回）
4. 切回前景
5. 記錄 console log

**要記錄的數據**：
- `visibilitychange: hidden` 的時間點
- 背景期間是否有任何 log（`onclose`？`onerror`？）
- `visibilitychange: visible` 觸發時：
  - `ws.readyState` 的值（0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED）
  - `state` 的值（connecting/connected/disconnected/reconnecting）
- `visibilitychange` 和 `onclose` 哪個先出現？間隔多少 ms？
- probe（ping）是否被送出？結果？
- 最終有沒有成功回到 `connected`？花了多久？

**記錄**：
```
（貼 console output）
```

---

### 實驗 4: 超長背景（2 分鐘）

**目的**：確認更長時間背景的行為是否跟 30s 不同（TCP keepalive timeout 通常 60s）。

**步驟**：
1. 確認已 connected
2. 按 Home 鍵
3. **等 2 分鐘**
4. 切回
5. 記錄 console log

**要記錄的數據**：（同實驗 3，額外注意）
- 是否有 backoff reconnect 的 log（表示 onclose 在背景期間觸發了）
- 切回時 `state` 是 `reconnecting` 還是仍然 `connected`？

**記錄**：
```
（貼 console output）
```

---

### 實驗 5: 快速切換壓力測試

**目的**：驗證多個事件源競爭 `openSocket()` 的假設。

**步驟**：
1. 確認已 connected
2. 快速執行以下循環（手動或 CLI）：
   ```bash
   for i in {1..5}; do
     xcrun simctl ui booted home
     sleep 1.5
     xcrun simctl openurl booted "http://10.0.4.5:4801"
     sleep 1.5
   done
   ```
3. 最後等 5 秒讓狀態穩定
4. 記錄全部 console log

**要記錄的數據**：
- 每次切回時 `visibilitychange` 和 `pageshow` 是否都觸發？
- 是否出現多個 `state: ... → connecting` 連續出現（表示多個 openSocket 競爭）？
- 最終 state 是什麼？是否穩定在 `connected`？
- 是否出現 `Zombie connection detected` 的 warn？

**記錄**：
```
（貼 console output）
```

---

### 實驗 6: BFCache（Safari 瀏覽器內，非 PWA）

**目的**：確認 BFCache 是否影響 WebSocket 狀態。

**步驟**：
1. 在 Simulator Safari（不是 PWA）開 `http://10.0.4.5:4801`
2. 確認 connected
3. 在同一個 tab 輸入新 URL（例如 `https://apple.com`）導航離開
4. 按 Safari 的返回按鈕回到前端頁面
5. 記錄 console log

**要記錄的數據**：
- `pageshow` 是否觸發？`persisted` 值？
- 返回後 `ws.readyState` 值？
- 是否自動重連？

**記錄**：
```
（貼 console output）
```

---

### 實驗 7: PWA 模式（Home Screen App）

**目的**：確認 PWA standalone 模式的行為是否跟 Safari tab 不同。

**步驟**：
1. 在 Simulator Safari 開 `http://10.0.4.5:4801`
2. 點 Share → Add to Home Screen
3. 從 Home Screen 開啟 PWA
4. 確認 connected
5. 重複實驗 3（背景 30s → 切回）
6. 記錄 console log

**要記錄的數據**：（同實驗 3，額外注意）
- PWA 的 `pageshow persisted` 是否跟 Safari tab 不同？
- PWA 是否更容易被系統 kill（沒有 log = 被 kill 了）？

**記錄**：
```
（貼 console output）
```

---

## 結果整理格式

實驗全部跑完後，整理成這個表格：

### 事件時序表

| 實驗 | 背景時間 | visibilitychange hidden? | 背景期間 onclose? | 恢復時 readyState | 恢復時 state | visibilitychange vs onclose 順序 | probe 結果 | 最終恢復? | 恢復耗時 |
|------|---------|-------------------------|-------------------|-------------------|-------------|--------------------------------|-----------|----------|---------|
| 2 | 3s | | | | | | | | |
| 3 | 30s | | | | | | | | |
| 4 | 2min | | | | | | | | |
| 5 | 壓力測試 | | | | | | | | |
| 6 | BFCache | N/A | | | | | | | |
| 7 | PWA 30s | | | | | | | | |

### Q1-Q5 回答

根據實驗數據回答：

1. **Q1**: visibilitychange 和 onclose 的順序與間隔 → （填入）
2. **Q2**: 背景凍結後 readyState 的實際值 → （填入）
3. **Q3**: BFCache pageshow persisted 值 → （填入）
4. **Q4**: 快速切換是否產生 concurrent openSocket → （填入）
5. **Q5**: 問題是 transport 還是 state → （填入）

### 意外發現

列出任何不在預期內的行為：
- （填入）

## 注意事項

- **Preserve Log 必須開啟** — 否則背景恢復後 console 被清空，等於白做
- **用 dev server（port 4801 pnpm dev）** — production build 的 log 是 minified 的，看不到 function 名
- **每個實驗之間 reload 一次** — 確保乾淨的初始狀態，避免上一輪的 timer 影響下一輪
- **如果 Simulator 的 CoreSimulatorService 報錯** — 重啟：`sudo launchctl kickstart -k system/com.apple.CoreSimulatorService` 然後重開 Simulator
- **記錄要包含完整 console output** — 不要只貼你認為重要的部分，可能有我們沒預期到的 log
- **Web Inspector 斷線** — 如果切背景後 Web Inspector 斷開，表示 Safari 把 page 完全 kill 了（不是凍結），這本身就是重要數據，記錄下來
