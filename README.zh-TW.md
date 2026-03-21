# MUP — Model UI Protocol

[![GitHub Stars](https://img.shields.io/github/stars/Ricky610329/mup?style=social)](https://github.com/Ricky610329/mup/stargazers)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[English](README.md)

> 在 LLM 聊天介面裡放進可互動的 UI — 讓每個人都能體驗 agentic AI，不只是開發者。

## 示範

- **[畫圖 & 分析](https://youtu.be/14-4sgN2hSk)** — Pixel Art + Chart
- **[打節拍](https://youtu.be/vp6W5ZiFfuM)** — Drum Machine
- **[看到什麼畫什麼](https://youtu.be/jk7Hlzcy4ko)** — Camera + Pixel Art
- **[智慧便利貼](https://youtu.be/9EG0XhwVn1c)** — Sticky Notes
- **[檔案報表](https://youtu.be/wcM7zEUrIHY)** — Workspace + Chart

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
- **[範例集](spec/MUP-Examples.zh-TW.md)** — 範例 MUP 與詳細說明

## 快速開始

### 搭配 Claude Code（推薦）

如果你有 [Claude Code](https://docs.anthropic.com/en/docs/claude-code)，一行指令搞定：

```bash
git clone https://github.com/Ricky610329/mup.git
cd mup/mup-mcp-server
npm install && npm run build
claude mcp add --transport stdio --scope user mup -- node $(pwd)/dist/index.js --mups-dir $(pwd)/../examples
```

重啟 Claude Code，MUP 面板就會以 tool 的形式出現。瀏覽器會自動開啟 `http://localhost:3200` 顯示 MUP 面板。

試試看：
- 「用 pixel art 畫一個笑臉」
- 「做一份關於 MUP 的簡報」
- 「來下西洋棋」

### 搭配 Claude Desktop

在 `claude_desktop_config.json` 加入：

```json
{
  "mcpServers": {
    "mup": {
      "command": "node",
      "args": ["/path/to/mup/mup-mcp-server/dist/index.js", "--mups-dir", "/path/to/mup/examples"]
    }
  }
}
```

### 獨立使用（自帶聊天介面）

不需要 Claude — 自帶聊天介面，支援多家 LLM 供應商。

```bash
cd mup/mup-agent
npm install
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env
npm start
```

支援 Anthropic、OpenAI、Google、Groq、xAI。在 `http://localhost:3100` 開啟。

## 內建範例

`examples/` 裡有 20 個現成的 MUP：

| 分類 | MUP | 說明 |
|------|-----|------|
| basic | Counter | 點 +/−，LLM 設定數值 |
| basic | Dice | 骰子動畫 + 歷史紀錄 |
| basic | Timer | 倒數計時 + 進度圓環 |
| basic | Chess | 跟 LLM 下西洋棋 |
| creative | Pixel Art | 16×16 像素畫布 |
| creative | Slides | 簡報製作器 |
| data | Chart | 長條圖、折線圖、圓餅圖等 |
| media | Camera | 即時相機 + 拍照 |
| media | Voice | 語音轉文字 + 文字轉語音 |
| media | Drum Machine | 四軌步進音序器 |
| music | Keys | 鋼琴卷軸音序器（雙八度、複音） |
| music | Bass | 低音音序器（C2–B2、單音） |
| music | Chords | 和弦進行音序器（8 格、撥弦） |
| music | Strings | 弦樂 Pad 音序器（去諧波厚實音色） |
| music | Synth | Lead 合成器音序器（波形、濾波、ADSR） |
| music | Mixer | 多軌混音台（音量、靜音、Solo） |
| music | Arranger | 歌曲編排器（段落結構、完整編曲） |
| productivity | Sticky Notes | 可拖曳便利貼 |
| productivity | Kanban | 拖放式任務看板 |
| productivity | Markdown | Markdown 即時編輯器 + 預覽 |

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

## 架構

```
┌──────────────────────────────────────────┐
│             MUP（.html 檔案）              │
│        manifest + UI + functions         │
└──────────────────┬───────────────────────┘
                   │ 載入
        ┌──────────┴──────────┐
        ▼                     ▼
┌──────────────┐    ┌──────────────────┐
│  MCP Server  │    │   mup-agent      │
│ (Claude Code │    │（獨立使用，       │
│  / Desktop)  │    │  自帶聊天介面）   │
└──────┬───────┘    └────────┬─────────┘
       │ WebSocket           │ WebSocket
       ▼                     ▼
┌─────────────────────────────────────┐
│           瀏覽器面板                 │
│   （MUP 格狀面板 + 工作區管理）      │
└─────────────────────────────────────┘
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
