# MUP — Model UI Protocol

[![GitHub Stars](https://img.shields.io/github/stars/Ricky610329/mup?style=social)](https://github.com/Ricky610329/mup/stargazers)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[English](README.md)

> 在 LLM 聊天介面裡放進可互動的 UI — 讓每個人都能體驗 agentic AI，不只是開發者。

目前版本：0.2.4 | 協議版本：`mup/2026-03-17`

## 示範

- **[Stop Making Apps. Make MUP.](https://youtu.be/HkmWpmfX46o)** — 完整展示：音樂、簡報、像素畫、便利貼
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

## 可用的 MUP

- **Chat** — 內建，隨時可用
- **Slides** — 簡報投影片（`mups/slides.html`）
- **Voice** — 語音合成（`mups/voice.html`）
- **Progress** — 任務進度追蹤（`mups/progress.html`）
- 更多範例在 [`archive/examples/`](archive/examples/)（音樂、像素畫、遊戲、生產力工具等）

## 文件

- **[規格](spec/MUP-Spec.zh-TW.md)** — 協議定義：manifest、函式、生命週期、錯誤處理
- **[設計哲學](spec/MUP-Philosophy.zh-TW.md)** — 為什麼這樣設計，以及刻意不做的功能
- **[範例集](spec/MUP-Examples.zh-TW.md)** — 範例 MUP 與詳細說明

## 安裝

### npm（推薦）

```bash
npm install -g mup-mcp-server
```

或直接執行：

```bash
npx mup-mcp-server --mups-dir ./my-mups
```

也可在 [MCP Server Registry](https://registry.modelcontextprotocol.io/) 找到。

### 從原始碼安裝

```bash
git clone https://github.com/Ricky610329/mup.git
cd mup/mup-mcp-server
npm install && npm run build
```

## 快速開始

### 搭配 Claude Code（推薦）

```bash
claude mcp add --transport stdio --scope user mup -- npx mup-mcp-server
```

重啟 Claude Code，瀏覽器會自動開啟 `http://localhost:3200`。用 MUPs 面板載入 MUP `.html` 檔案資料夾，或直接使用內建的 Chat widget。

#### 即時 Channel 模式

MUP 可以透過 channel notification 即時推送互動到 Claude 的對話中。啟動方式：

```bash
claude --dangerously-load-development-channels server:mup
```

這讓 MUP 可以即時將使用者的操作傳遞給 Claude。不加此 flag 時，所有功能仍然正常運作，只是互動會透過 polling 而非即時推送。

> **已知問題（2026 年 3 月）：** Claude Code v2.1.80+ 存在一個 bug，`notifications/claude/channel` 事件會被靜默丟棄，無法送達對話。此問題影響所有 MCP channel 實作。MUP 仍可透過 polling（`checkInteractions`）使用，但即時推送暫時無法運作。追蹤 issue：[anthropics/claude-code#36431](https://github.com/anthropics/claude-code/issues/36431)。

### 搭配 Claude Desktop

在 `claude_desktop_config.json` 加入：

```json
{
  "mcpServers": {
    "mup": {
      "command": "npx",
      "args": ["mup-mcp-server"]
    }
  }
}
```

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
    },
    {
      "name": "getCount",
      "description": "取得目前的計數器數值",
      "inputSchema": { "type": "object", "properties": {} }
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
                   ▼
            ┌──────────────┐
            │  MCP Server  │
            │ (Claude Code │
            │  / Desktop)  │
            └──────┬───────┘
                   │ WebSocket
                   ▼
      ┌─────────────────────────────┐
      │          瀏覽器面板          │
      │  （MUP 格狀面板 + Chat     │
      │    widget + 工作區管理）    │
      └─────────────────────────────┘
```

## Star History

[![Star History Chart](https://api.star-history.com/image?repos=Ricky610329/mup&type=date&legend=top-left)](https://www.star-history.com/?repos=Ricky610329%2Fmup&type=date&legend=top-left)

## 授權

[MIT](LICENSE)
