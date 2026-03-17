# MUP 範例說明

本文件描述 `poc/examples/` 中的範例 MUP。每個展示不同的協議能力。

---

## 總覽

| MUP | Grid | 函式 | 展示能力 |
|-----|------|------|---------|
| [Counter](#counter-計數器) | 1×1 | `setCount`, `getCount` | 基礎雙向 function call |
| [Pixel Art](#pixel-art-像素畫布) | 2×2 | `setPixels`, `clear`, `getGrid` | LLM 驅動的像素顯示 |
| [Drum Machine](#drum-machine-鼓機) | 2×2 | `setPattern`, `setBPM`, `play`, `stop`, `clear`, `getState` | 複雜狀態 + Web Audio |
| [Sticky Notes](#sticky-notes-便利貼) | 2×2 | `addNote`, `removeNote`, `editNote`, `getNotes`, `clearAll` | 完整 CRUD 操作 |
| [Camera](#camera-相機) | 2×2 | `capturePhoto`, `startCamera`, `stopCamera` | 瀏覽器權限 + 多模態 `image` 內容 |
| [File Organizer](#file-organizer-檔案管理) | 2×2 | `getStatus`, `listFiles`, `createFolder`, `moveFile`, `readFileText` | File System Access API |
| [Chart](#chart-圖表) | 2×2 | `renderChart`, `clear`, `getData` | LLM → 視覺化資料管線 |
| [Timer](#timer-計時器) | 1×1 | `start`, `pause`, `reset`, `getStatus` | 狀態轉換時 `updateState` |
| [Dice](#dice-骰子) | 1×1 | `roll`, `getLastRoll` | 單顆 d6，互動娛樂 |

---

## Counter（計數器）

**檔案：** `counter.html`

MUP 的 "hello world"。一個數字、兩個按鈕、兩個函式。

**展示重點：**
- 最簡單的 manifest
- `registerFunction` 同時包含讀取和寫入操作
- 使用者點擊時 `notifyInteraction`
- `updateState` 讓 LLM 隨時知道狀態
- `onReady` 初始化

**Demo 流程：** 載入 → LLM 呼叫 `setCount(42)` → 使用者點 +/- → LLM 透過 badge 看到互動 → LLM 呼叫 `getCount()` 讀取當前值。

---

## Pixel Art（像素畫布）

**檔案：** `pixel-art.html`

16×16 像素顯示器，用 `<canvas>` 渲染。LLM 呼叫 `setPixels` 來繪圖。

**展示重點：**
- **LLM → 視覺化管線**：LLM 產生像素資料，MUP 渲染顯示
- `inputSchema` 中的物件陣列（像素座標 + 顏色）
- `<canvas>` 搭配 `image-rendering: pixelated` 呈現銳利像素風
- `ResizeObserver` 實現響應式渲染

**Demo 流程：** 使用者說「畫一個愛心」→ LLM 呼叫 `setPixels` 傳入紅色愛心座標 → Canvas 渲染愛心 → 使用者看到像素畫。

---

## Drum Machine（鼓機）

**檔案：** `drum-machine.html`

4 軌、16 步的音序器，用 Web Audio 合成音色。LLM 可以作曲。

**展示重點：**
- 複雜狀態管理（4 個樂器 × 16 步 + BPM + 播放狀態）
- 多個函式，各有不同的參數類型
- 在 MUP 中使用 Web Audio API
- 豐富的 `updateState`，包含結構化資料

**Demo 流程：** 使用者說「做一個 hip-hop 節拍」→ LLM 呼叫 `setPattern` 設定 kick、snare、hihat → 呼叫 `setBPM(90)` → 呼叫 `play` → 使用者聽到節拍，可以自己微調。

---

## Sticky Notes（便利貼）

**檔案：** `sticky-notes.html`

一塊可拖拉、可編輯、有顏色的便利貼板。

**展示重點：**
- 完整 CRUD：新增、編輯、刪除、列出、清除
- `inputSchema` 中的 enum 類型（顏色選項）
- 基於 Pointer Events 的拖放
- `contenteditable` 行內編輯
- 每張便利貼有可見的 ID，方便 LLM 參照

**Demo 流程：** 使用者說「幫我腦力激盪生日派對的點子」→ LLM 多次呼叫 `addNote`，使用不同顏色 → 使用者拖拉重新排列 → 編輯文字 → LLM 看到互動。

---

## Camera（相機）

**檔案：** `camera.html`

即時相機畫面 + 拍照功能。LLM 收到 base64 編碼的照片。

**展示重點：**
- manifest 中的 `permissions: ["camera"]`
- function result 中的多模態 `image` 內容類型
- Landing 狀態 → Active 狀態的 UI 切換
- `updateState` 回報相機開/關狀態
- 自動啟動：`capturePhoto` 會在相機未開啟時自動啟動

**Demo 流程：** 使用者問「你看到什麼？」→ LLM 呼叫 `capturePhoto` → 相機自動啟動 → 照片以 `{ type: "image", data: "base64...", mimeType: "image/jpeg" }` 回傳 → LLM 描述照片內容。

---

## File Organizer（檔案管理）

**檔案：** `file-organizer.html`

透過 File System Access API 瀏覽和整理本地檔案。

**展示重點：**
- `permissions: ["file-system-access"]`
- 複雜的多步驟操作（瀏覽、列出、搬移、讀取）
- 使用者發起的動作 — LLM 無法直接觸發（資料夾選取器需要 user gesture）
- 麵包屑導航
- `updateState` 回報已開啟的資料夾名稱

**Demo 流程：** 使用者點「Choose Folder」→ LLM 看到「Folder opened: Downloads」→ LLM 呼叫 `listFiles` → 看到雜亂的檔案 → 呼叫 `createFolder("images")` → 呼叫 `moveFile` 來整理。

---

## Chart（圖表）

**檔案：** `chart.html`

資料視覺化：在 Canvas 上渲染長條圖、折線圖、圓餅圖。

**展示重點：**
- **LLM → 視覺化管線**：LLM 生成資料，MUP 渲染成圖表
- 複雜的 `inputSchema`，包含巢狀物件和陣列（datasets）
- Canvas 渲染，支援正確的縮放和 DPI 處理
- 使用者可切換圖表類型；LLM 也可以設定圖表類型
- `ResizeObserver` 實現響應式渲染

**Demo 流程：** 使用者問「顯示 Q1-Q4 銷售比較」→ LLM 呼叫 `renderChart({ type: "bar", labels: ["Q1","Q2","Q3","Q4"], datasets: [{label: "2024", data: [120,150,180,200]}] })` → 圖表出現 → 使用者點「Pie」切換檢視方式。

---

## Timer（計時器）

**檔案：** `timer.html`

倒數計時器，搭配 SVG 圓環進度條。

**展示重點：**
- **每次狀態轉換都 `updateState`**：LLM 知道計時器何時啟動、暫停、重置、完成
- LLM 可以啟動/暫停/重置計時器
- 完成通知：LLM 知道計時器何時結束
- SVG 動畫（用 `stroke-dashoffset` 的進度圓環）

**Demo 流程：** 使用者說「設定 2 分鐘計時器」→ LLM 呼叫 `start({ seconds: 120 })` → 圓環開始動畫 → 計時器歸零 → LLM 看到「Timer completed!」→ 可以回應使用者。

---

## Dice（骰子）

**檔案：** `dice.html`

一顆六面骰，CSS 渲染骰面點陣 + 擲骰動畫。

**展示重點：**
- 有趣的互動用途 — 遊戲、決策、隨機生成
- 純 CSS 骰面渲染（d6 點陣圖案）
- 擲骰動畫
- 擲骰歷史記錄

**Demo 流程：** 使用者說「幫我擲一下」→ LLM 呼叫 `roll()` → d6 動畫骰出 4 → LLM 說「你擲出 4！」

---

## 協議功能覆蓋表

| 功能 | 使用的範例 MUP |
|------|--------------|
| `registerFunction` | 全部 9 個 |
| `onReady` | 全部 9 個 |
| `updateState` | 全部 9 個 |
| `notifyInteraction` | Counter、Drum Machine、Sticky Notes、Camera、File Organizer、Chart、Timer、Dice |
| `requestResize` | —（目前無，候選：Chart、Sticky Notes） |
| `permissions` | Camera、File Organizer |
| `text` 內容 | 全部 9 個 |
| `data` 內容 | Counter、Drum Machine、Pixel Art、Sticky Notes、File Organizer、Chart、Timer、Dice |
| `image` 內容 | Camera |

| Headless MUP (0×0) | —（目前無） |
