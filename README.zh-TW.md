# MUP — Model UI Protocol

[![GitHub Stars](https://img.shields.io/github/stars/Ricky610329/mup?style=social)](https://github.com/Ricky610329/mup/stargazers)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[English](README.md)

> 在 LLM 聊天介面裡放進可互動的 UI — 讓每個人都能體驗 agentic AI，不只是開發者。

## 示範

<table>
<tr>
<td width="50%" align="center">

![畫圖 & 分析](docs/demos/demo-tree.gif)

**[畫圖 & 分析](https://youtu.be/14-4sgN2hSk)** — Pixel Art + Chart

</td>
<td width="50%" align="center">

![打節拍](docs/demos/demo-beat.gif)

**[打節拍](https://youtu.be/vp6W5ZiFfuM)** — Drum Machine

</td>
</tr>
<tr>
<td align="center">

![看到什麼畫什麼](docs/demos/demo-see-draw.gif)

**[看到什麼畫什麼](https://youtu.be/jk7Hlzcy4ko)** — Camera + Pixel Art

</td>
<td align="center">

![智慧便利貼](docs/demos/demo-notes.gif)

**[智慧便利貼](https://youtu.be/9EG0XhwVn1c)** — Sticky Notes

</td>
</tr>
<tr>
<td colspan="2" align="center">

![檔案報表](docs/demos/demo-file-report.gif)

**[檔案報表](https://youtu.be/wcM7zEUrIHY)** — File Organizer + Chart

</td>
</tr>
</table>

---

## MUP 是什麼？

**MUP** 是一個能嵌入 LLM 聊天介面的互動式 UI 元件。

它把畫面和功能綁在一起。使用者按按鈕操作，LLM 用 function call 操作，雙方即時看到對方做了什麼。

最簡單的 MUP 就是一個 `.html` 檔 — 不用打包、不用框架、不用裝任何東西。

## 為什麼要做這個？

Agentic AI 很強，但現在被鎖在文字指令和開發工具的高牆後面。大多數人根本碰不到。

MUP 把可以點、可以看、可以操作的 UI 直接放進聊天裡 — 不用會寫 prompt，也能使用 AI agent 的能力。

| | 傳統聊天介面 | 加上 MUP |
|---|---|---|
| **使用者怎麼操作** | 打字下指令 | 按按鈕、拉滑桿、即時看到視覺化結果 |
| **工具的回傳結果** | 使用者看不到，只有 LLM 知道 | 雙方都看得到，而且可以互動 |
| **誰能用** | 會下 prompt 的進階使用者 | 所有人 |

## 核心概念

- **共用函式。** 函式可以被 LLM 當 tool 呼叫，也可以被使用者從 UI 觸發。雙方透過同一份程式碼操作同一個狀態。
- **LLM 居中協調。** MUP 之間不直接溝通。LLM 讀取各個 MUP 的輸出，決定下一步要做什麼。
- **就是 HTML。** 寫好 manifest、註冊函式，一個檔案就能上線。

## 文件

- **[規格](spec/MUP-Spec.zh-TW.md)** — 協議定義：manifest、函式、生命週期、錯誤處理
- **[設計哲學](spec/MUP-Philosophy.zh-TW.md)** — 為什麼這樣設計，以及刻意不做的功能
- **[範例集](spec/MUP-Examples.zh-TW.md)** — 9 個範例 MUP 與詳細說明

## 快速範例

```html
<script type="application/mup-manifest">
{
  "name": "Counter",
  "description": "計數器。使用者按 +/-，LLM 可以設定或讀取數值。",
  "functions": [
    {
      "name": "setCount",
      "description": "將計數器設為指定數值",
      "inputSchema": {
        "type": "object",
        "properties": { "value": { "type": "number" } },
        "required": ["value"]
      }
    }
  ]
}
</script>
```

丟進支援 MUP 的 host，直接就能用。

## 快速開始

三種使用方式，依你的需求選擇：

### 方式 A：Chrome 擴充功能（推薦）

在 **ChatGPT、Gemini 或 Claude** 旁邊直接使用 MUP 面板。

```bash
git clone https://github.com/Ricky610329/mup.git
```

1. 開啟 `chrome://extensions` → 啟用「開發者模式」→「載入未封裝項目」→ 選擇 `mup-extension/`
2. 開啟 ChatGPT 或 Gemini → 點擊工具列的 MUP 圖示開啟側邊面板
3. 把 `poc/examples/` 裡的 `.html` MUP 檔拖進面板
4. 正常聊天 — LLM 會自動使用你的 MUP 面板

**完整系統存取（檔案系統、相機）：**

```bash
cd mup-native-host
node install.js
```

一次性註冊 native messaging host，讓 MUP 能存取你的檔案系統、開啟資料夾選擇器、拍照。

### 方式 B：獨立 PoC

自帶聊天介面的 MUP host。不需要外部 LLM 帳號（內建 demo 模式）。

```bash
cd poc
npm install
npm run dev
```

在 `http://localhost:5173` 開啟。支援 OpenAI、Anthropic、Gemini、Ollama — 透過 `.env` 或互動設定畫面配置。

### 方式 C：MCP Bridge

在 **Claude Desktop、Cursor** 或任何 MCP 相容客戶端使用 MUP 面板。

```bash
cd mup-mcp-server
npm install
npm run build
node dist/index.js --mups-dir ../poc/examples
```

將所有 MUP 函式註冊為 MCP tools。瀏覽器面板會自動開啟顯示 MUP UI。

### 內建範例

`poc/examples/` 裡有 9 個現成的 MUP：

| MUP | 大小 | 說明 |
|-----|------|------|
| Counter | 1×1 | 點 +/−，LLM 設定數值 |
| Dice | 1×1 | 骰子動畫 + 歷史紀錄 |
| Timer | 1×1 | 倒數計時器 |
| Chart | 2×2 | 長條圖、折線圖、圓餅圖 |
| Camera | 2×2 | 即時相機 + 拍照 |
| Drum Machine | 2×2 | 四軌步進音序器 |
| Pixel Art | 2×2 | 16×16 像素畫布 |
| Sticky Notes | 2×2 | 可拖曳便利貼 |
| File Organizer | 2×2 | 瀏覽與整理本機檔案 |

## 架構

```
┌──────────────────────────────────────────────────────┐
│                    MUP（.html 檔案）                   │
│  manifest + UI + functions                           │
└──────────────┬───────────────────────────────────────┘
               │ 載入方式
    ┌──────────┴──────────┬─────────────────┐
    ▼                     ▼                 ▼
┌─────────┐     ┌──────────────┐   ┌─────────────┐
│   PoC   │     │  Extension   │   │ MCP Bridge  │
│ (Vite)  │     │（側邊面板）    │   │  (stdio)    │
└─────────┘     └──────┬───────┘   └─────────────┘
                       │
                       ▼
              ┌─────────────────┐
              │  Native Host    │
              │（檔案系統、      │
              │  相機、OS 操作） │
              └─────────────────┘
```

## Star History

<a href="https://www.star-history.com/?repos=Ricky610329%2Fmup&type=date&legend=top-left">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=Ricky610329/mup&type=date&legend=top-left&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=Ricky610329/mup&type=date&legend=top-left" />
    <img alt="Star History Chart" src="https://api.star-history.com/image?repos=Ricky610329/mup&type=date&legend=top-left" />
  </picture>
</a>

## 授權

[MIT](LICENSE)
