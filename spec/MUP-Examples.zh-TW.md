# MUP 範例說明

> **注意：** 原始範例 MUP 已移至 `archive/examples/`。目前活躍的 MUP 是 `mups/slides/` 中的**簡報套件** — 詳見[主 README](../README.zh-TW.md)。

本文件描述原始的範例 MUP。每個展示不同的協議能力。

---

## 總覽

### basic/

| MUP | Grid | 函式 | 展示能力 |
|-----|------|------|---------|
| [Counter](#counter計數器) | 1×1 | `setCount`, `getCount` | 基礎雙向 function call |
| [Timer](#timer計時器) | 1×1 | `start`, `pause`, `reset`, `setTime`, `getStatus` | 狀態轉換時 `updateState` |
| [Dice](#dice骰子) | 1×1 | `roll`, `getLastRoll` | 多骰子投擲，互動娛樂 |
| [Chess](#chess西洋棋) | 1×1 | `makeMove`, `getBoard`, `resetGame` | 與 LLM 對弈的回合制遊戲 |

### creative/

| MUP | Grid | 函式 | 展示能力 |
|-----|------|------|---------|
| [Pixel Art](#pixel-art像素畫布) | 1×1 | `setPixels`, `fillRect`, `clear`, `getGrid` | LLM 驅動的像素顯示 |
| [Slides](#slides簡報) | 2×2 | `createPresentation`, `addSlide`, `updateSlide`, `removeSlide`, `getSlides`, `setTheme` | 簡報製作器，多種版面配置 |

### data/

| MUP | Grid | 函式 | 展示能力 |
|-----|------|------|---------|
| [Chart](#chart圖表) | 1×1 | `renderChart`, `clear`, `getData`, `setType` | LLM → 視覺化資料管線 |

### media/

| MUP | Grid | 函式 | 展示能力 |
|-----|------|------|---------|
| [Camera](#camera相機) | 1×1 | `capturePhoto`, `startCamera`, `stopCamera` | 瀏覽器權限 + 多模態 `image` 內容 |
| [Voice](#voice語音) | 1×1 | `startListening`, `stopListening`, `speak`, `getTranscript` | 語音轉文字 + 文字轉語音 |
| [Drum Machine](#drum-machine鼓機) | 1×1 | `setPattern`, `toggleStep`, `setBPM`, `play`, `stop`, `clear`, `getState` | 複雜狀態 + Web Audio |

### productivity/

| MUP | Grid | 函式 | 展示能力 |
|-----|------|------|---------|
| [Sticky Notes](#sticky-notes便利貼) | 1×1 | `addNote`, `moveNote`, `removeNote`, `editNote`, `getNotes`, `clearAll`, `setNotifications` | 完整 CRUD + 位置控制 |
| [Kanban](#kanban看板) | 2×1 | `addTask`, `moveTask`, `removeTask`, `getTasks`, `clearBoard`, `addColumn` | 拖放式任務管理看板 |

---

## Counter（計數器）

**檔案：** `basic/counter.html`

MUP 的 "hello world"。一個數字、兩個按鈕、兩個函式。

**展示重點：**
- 最簡單的 manifest
- `registerFunction` 同時包含讀取和寫入操作
- 使用者點擊時 `notifyInteraction`
- `updateState` 讓 LLM 隨時知道狀態
- `onReady` 初始化

**Demo 流程：** 載入 → LLM 呼叫 `setCount(42)` → 使用者點 +/- → LLM 透過 badge 看到互動 → LLM 呼叫 `getCount()` 讀取當前值。

---

## Timer（計時器）

**檔案：** `basic/timer.html`

倒數計時器，搭配 SVG 圓環進度條。

**展示重點：**
- **每次狀態轉換都 `updateState`**：LLM 知道計時器何時啟動、暫停、重置、完成
- LLM 可以啟動/暫停/重置計時器
- 完成通知：LLM 知道計時器何時結束
- SVG 動畫（用 `stroke-dashoffset` 的進度圓環）

**Demo 流程：** 使用者說「設定 2 分鐘計時器」→ LLM 呼叫 `start({ seconds: 120 })` → 圓環開始動畫 → 計時器歸零 → LLM 看到「Timer completed!」→ 可以回應使用者。

---

## Dice（骰子）

**檔案：** `basic/dice.html`

一顆六面骰，CSS 渲染骰面點陣 + 擲骰動畫。

**展示重點：**
- 有趣的互動用途 — 遊戲、決策、隨機生成
- 純 CSS 骰面渲染（d6 點陣圖案）
- 擲骰動畫
- 擲骰歷史記錄

**Demo 流程：** 使用者說「幫我擲一下」→ LLM 呼叫 `roll()` → d6 動畫骰出 4 → LLM 說「你擲出 4！」

---

## Chess（西洋棋）

**檔案：** `basic/chess.html`

西洋棋棋盤，使用者與 LLM 對弈。使用簡單的座標記譜法（如 `e2e4`）。

**展示重點：**
- 使用者與 LLM 之間的回合制遊戲互動
- `notifyInteraction` 回報使用者的移動
- 座標記譜法（起始格 + 目標格）
- LLM 作為對手，而非只是助手

**Demo 流程：** 使用者點擊棋子移動 → LLM 看到移動 → LLM 呼叫 `makeMove("e7e5")` → 棋盤更新 → 輪到使用者。

---

## Pixel Art（像素畫布）

**檔案：** `creative/pixel-art.html`

16×16 像素顯示器，用 `<canvas>` 渲染。LLM 呼叫 `setPixels` 來繪圖。

**展示重點：**
- **LLM → 視覺化管線**：LLM 產生像素資料，MUP 渲染顯示
- `inputSchema` 中的物件陣列（像素座標 + 顏色）
- `<canvas>` 搭配 `image-rendering: pixelated` 呈現銳利像素風
- `ResizeObserver` 實現響應式渲染

**Demo 流程：** 使用者說「畫一個愛心」→ LLM 呼叫 `setPixels` 傳入紅色愛心座標 → Canvas 渲染愛心 → 使用者看到像素畫。

---

## Markdown

**檔案：** `creative/markdown.html`

Markdown 渲染器。可渲染 LLM 生成的內容，或從工作區載入 `.md` 檔案。

**展示重點：**
- Markdown 渲染：標題、列表、程式碼區塊、表格、連結
- `mup.system('workspace.read', ...)` 從 host 載入檔案
- 跨 MUP 協作（讀取 Workspace 中的檔案）

**Demo 流程：** 使用者說「顯示 README」→ LLM 呼叫 `loadFile({ path: "README.md" })` → Markdown 在檢視器中渲染 → 使用者可點重新整理從原始檔重新載入。

---

## Editor（編輯器）

**檔案：** `creative/editor.html`

文字編輯器，使用者可撰寫和選取文字與 LLM 討論。選取感知：LLM 能看到使用者反白的文字並修改它。

**展示重點：**
- 透過 `getSelection()` 和 `replaceRange()` 追蹤選取
- `mup.system('workspace.read/write', ...)` 進行檔案讀寫
- 選取文字變更時 `notifyInteraction`
- 精細編輯：插入、替換範圍、取得行數

**Demo 流程：** 使用者輸入程式碼 → 選取一個函式 → LLM 透過 interaction 看到選取 → 使用者說「重構這段」→ LLM 呼叫 `replaceRange()` 只編輯選取的部分。

---

## Slides（簡報）

**檔案：** `creative/slides.html`

簡報製作器。LLM 建立帶有標題、Markdown 內容和不同版面配置的投影片。

**展示重點：**
- 透過 `createPresentation()` 批次建立（一次產生整份簡報）
- 多種版面配置：title、content、split、image
- 透過 `setTheme()` 支援主題切換
- 個別投影片管理：新增、更新、刪除

**Demo 流程：** 使用者說「做一份關於 MUP 的簡報」→ LLM 呼叫 `createPresentation()` 建立多張投影片 → 使用者瀏覽投影片 → 說「換成深色主題」→ LLM 呼叫 `setTheme("dark")`。

---

## Chart（圖表）

**檔案：** `data/chart.html`

資料視覺化：在 Canvas 上渲染長條圖、折線圖、圓餅圖。

**展示重點：**
- **LLM → 視覺化管線**：LLM 生成資料，MUP 渲染成圖表
- 複雜的 `inputSchema`，包含巢狀物件和陣列（datasets）
- Canvas 渲染，支援正確的縮放和 DPI 處理
- 使用者可切換圖表類型；LLM 可透過 `setType()` 設定圖表類型
- `ResizeObserver` 實現響應式渲染

**Demo 流程：** 使用者問「顯示 Q1-Q4 銷售比較」→ LLM 呼叫 `renderChart({ type: "bar", labels: ["Q1","Q2","Q3","Q4"], datasets: [{label: "2024", data: [120,150,180,200]}] })` → 圖表出現 → 使用者點「Pie」切換檢視方式。

---

## Search（搜尋）

**檔案：** `data/search.html`

網頁搜尋面板。LLM 搜尋網頁並顯示帶有可點擊連結的結果。使用者也可以直接輸入查詢。

**展示重點：**
- `mup.system("webSearch", ...)` 請求 host 提供的網頁搜尋
- 在 MUP UI 中顯示外部資料
- 使用者透過輸入欄發起搜尋
- 使用者點擊結果時 `notifyInteraction`

**Demo 流程：** 使用者說「搜尋 MUP protocol」→ LLM 呼叫 `search({ query: "MUP protocol" })` → 結果顯示標題、描述和連結 → 使用者點擊結果。

---

## Workspace（工作區）

**檔案：** `data/workspace.html`

檔案工作區。使用者選擇資料夾後，LLM 可以瀏覽、讀取、寫入和下載檔案。

**展示重點：**
- `permissions: ["file-system-access"]`
- 智慧檔案存取：先用 `info()` 查看大小/預覽再用 `read()`
- 大檔案的 offset/limit 分頁讀取
- `download()` 下載二進制檔案
- 使用者發起的資料夾選取器（需要 user gesture）

**Demo 流程：** 使用者點「Choose Folder」→ LLM 看到「Folder opened: my-project」→ LLM 呼叫 `list()` → 看到檔案 → 呼叫 `info({ path: "data.csv" })` 查看大小 → 呼叫 `read({ path: "data.csv" })` 讀取內容。

---

## Camera（相機）

**檔案：** `media/camera.html`

即時相機畫面 + 拍照功能。LLM 收到 base64 編碼的照片。

**展示重點：**
- manifest 中的 `permissions: ["camera"]`
- function result 中的多模態 `image` 內容類型
- Landing 狀態 → Active 狀態的 UI 切換
- `updateState` 回報相機開/關狀態
- 自動啟動：`capturePhoto` 會在相機未開啟時自動啟動

**Demo 流程：** 使用者問「你看到什麼？」→ LLM 呼叫 `capturePhoto` → 相機自動啟動 → 照片以 `{ type: "image", data: "base64...", mimeType: "image/jpeg" }` 回傳 → LLM 描述照片內容。

---

## Voice（語音）

**檔案：** `media/voice.html`

語音助手，支援語音轉文字和文字轉語音。使用者點麥克風說話，轉錄文字送給 LLM，LLM 可用語音回覆。

**展示重點：**
- manifest 中的 `permissions: ["microphone"]`
- 語音辨識（Web Speech API）
- 透過 `speak()` 文字轉語音
- 按下即說的互動：使用者點麥克風，說一段話
- `notifyInteraction` 附帶轉錄文字

**Demo 流程：** 使用者點麥克風 → 說「今天天氣怎樣？」→ 轉錄文字送給 LLM → LLM 呼叫 `speak({ text: "我無法查天氣，但可以幫你做其他事！" })` → 使用者聽到回覆。

---

## Drum Machine（鼓機）

**檔案：** `media/drum-machine.html`

4 軌、16 步的音序器，用 Web Audio 合成音色。LLM 可以作曲。

**展示重點：**
- 複雜狀態管理（4 個樂器 × 16 步 + BPM + 播放狀態）
- 多個函式，各有不同的參數類型
- 在 MUP 中使用 Web Audio API
- 豐富的 `updateState`，包含結構化資料

**Demo 流程：** 使用者說「做一個 hip-hop 節拍」→ LLM 呼叫 `setPattern` 設定 kick、snare、hihat → 呼叫 `setBPM(90)` → 呼叫 `play` → 使用者聽到節拍，可以自己微調。

---

## Sticky Notes（便利貼）

**檔案：** `productivity/sticky-notes.html`

一塊可拖拉、可編輯、有顏色的便利貼板。

**展示重點：**
- 完整 CRUD：新增、編輯、刪除、列出、清除
- `inputSchema` 中的 enum 類型（顏色選項）
- 基於 Pointer Events 的拖放
- `contenteditable` 行內編輯
- 每張便利貼有可見的 ID，方便 LLM 參照
- 透過 `setNotifications()` 設定通知偏好

**Demo 流程：** 使用者說「幫我腦力激盪生日派對的點子」→ LLM 多次呼叫 `addNote`，使用不同顏色 → 使用者拖拉重新排列 → 編輯文字 → LLM 看到互動。

---

## Kanban（看板）

**檔案：** `productivity/kanban.html`

任務看板，有 To Do、In Progress、Done 等欄位。LLM 可管理任務，使用者可拖拉卡片。

**展示重點：**
- 欄位之間的拖放
- 透過 `addColumn()` 動態新增欄位
- 卡片移動和編輯時 `notifyInteraction`
- 搭配 LLM 協助的任務管理工作流

**Demo 流程：** 使用者說「幫我規劃這個 sprint」→ LLM 呼叫 `addTask` 新增每個項目 → 使用者拖拉「Login page」到 In Progress → LLM 看到移動 → 可以建議下一步。

---

## 協議功能覆蓋表

| 功能 | 使用的範例 MUP |
|------|--------------|
| `registerFunction` | 全部 12 個 |
| `onReady` | 全部 12 個 |
| `updateState` | 全部 12 個 |
| `notifyInteraction` | Counter、Timer、Dice、Chess、Chart、Camera、Voice、Drum Machine、Sticky Notes、Kanban |
| `mup.system()` | —（目前無） |
| `permissions` | Camera、Voice |
| `text` 內容 | 全部 12 個 |
| `data` 內容 | 除 Camera 外全部 |
| `image` 內容 | Camera |
| Headless MUP (0×0) | —（目前無） |
