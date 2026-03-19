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

```bash
git clone https://github.com/Ricky610329/mup.git
cd mup/mup-agent
npm install
npm run build
```

設定 API key 後啟動：

```bash
ANTHROPIC_API_KEY=sk-ant-... node dist/index.js --mups-dir ../examples
```

瀏覽器會自動開啟，顯示聊天面板和 MUP 格狀面板。從 Manager 卡片載入 MUP，跟 agent 對話，LLM 會自動呼叫 MUP 的功能。

### 選項

```
mup-agent [options] [file1.html file2.html ...]

--mups-dir <dir>     從目錄載入所有 .html MUP 檔案
--provider <name>    LLM 供應商：anthropic, openai, google, groq, xai（預設：anthropic）
--model <id>         模型 ID（預設：claude-sonnet-4-6）
--api-key <key>      API key（或設定 ANTHROPIC_API_KEY、OPENAI_API_KEY 等環境變數）
--port <port>        UI 面板埠號（預設：3100）
--no-open            不自動開啟瀏覽器
```

### 內建範例

`examples/` 裡有 9 個現成的 MUP：

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
┌──────────────────────────────────────────┐
│             MUP（.html 檔案）              │
│        manifest + UI + functions         │
└──────────────────┬───────────────────────┘
                   │ 載入
                   ▼
┌──────────────────────────────────────────┐
│           mup-agent（Node.js）            │
│                                          │
│  ┌─────────────┐    ┌─────────────────┐  │
│  │ Agent       │    │ MUP Manager     │  │
│  │ (pi-agent-  │    │（載入、解析、    │  │
│  │  core)      │    │  路由呼叫）     │  │
│  └──────┬──────┘    └────────┬────────┘  │
│         │  LLM API          │            │
│         ▼                   │            │
│  ┌─────────────┐            │            │
│  │ LLM 供應商  │            │            │
│  │ (Anthropic, │            │            │
│  │  OpenAI...) │            │            │
│  └─────────────┘            │            │
└─────────────────────────────┼────────────┘
                              │ WebSocket
                              ▼
                   ┌─────────────────────┐
                   │    瀏覽器面板        │
                   │ （聊天 + MUP 格狀）  │
                   └─────────────────────┘
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
