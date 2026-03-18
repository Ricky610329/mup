# MUP — Model UI Protocol

[![GitHub Stars](https://img.shields.io/github/stars/Ricky610329/mup?style=social)](https://github.com/Ricky610329/mup/stargazers)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[繁體中文](README.zh-TW.md)

> Bring interactive UI into LLM chat — so anyone can experience agentic AI, not just developers.

## Demos

<table>
<tr>
<td width="50%" align="center">

![Draw & Analyze](docs/demos/demo-tree.gif)

**[Draw & Analyze](https://youtu.be/14-4sgN2hSk)** — Pixel Art + Chart

</td>
<td width="50%" align="center">

![Beat Making](docs/demos/demo-beat.gif)

**[Beat Making](https://youtu.be/vp6W5ZiFfuM)** — Drum Machine

</td>
</tr>
<tr>
<td align="center">

![See & Draw](docs/demos/demo-see-draw.gif)

**[See & Draw](https://youtu.be/jk7Hlzcy4ko)** — Camera + Pixel Art

</td>
<td align="center">

![Smart Notes](docs/demos/demo-notes.gif)

**[Smart Notes](https://youtu.be/9EG0XhwVn1c)** — Sticky Notes

</td>
</tr>
<tr>
<td colspan="2" align="center">

![File Report](docs/demos/demo-file-report.gif)

**[File Report](https://youtu.be/wcM7zEUrIHY)** — File Organizer + Chart

</td>
</tr>
</table>

---

## What is MUP?

A **MUP** is an interactive UI component that lives inside an LLM chat interface.

It bundles a visual interface with callable functions. The user operates it by clicking buttons; the LLM operates it through function calls. Both sides see each other's actions in real time.

The simplest MUP is a single `.html` file — no build step, no framework, no SDK.

## Why?

Agentic AI is powerful, but today it's trapped behind text commands and developer tools. Most people never get to experience it.

MUP changes this. It puts clickable, visual UI right inside the chat — so anyone can use agentic capabilities without writing a single prompt.

| | Traditional Chat | With MUP |
|---|---|---|
| **User interaction** | Type text commands | Click buttons, drag sliders, see live visuals |
| **Tool results** | Hidden from user, only the LLM sees them | Visible and interactive for both sides |
| **Who can use it** | Power users who know the right prompts | Anyone |

## Key Ideas

- **One function, two entry points.** Every function can be called by the LLM (as a tool) or triggered by the user (via UI). Same code, same result.
- **LLM as orchestrator.** MUPs don't talk to each other. The LLM reads outputs and decides what to do next.
- **Just HTML.** Write a manifest, register your functions, done. Ship a single file.

## Docs

- **[Spec](spec/MUP-Spec.md)** — Protocol definition: manifest, functions, lifecycle, error handling
- **[Design Philosophy](spec/MUP-Philosophy.md)** — Why MUP is designed this way, and what we intentionally left out
- **[Examples](spec/MUP-Examples.md)** — 9 example MUPs with walkthroughs

## Quick Example

```html
<script type="application/mup-manifest">
{
  "name": "Counter",
  "description": "A counter. User clicks +/-, LLM can set or read the value.",
  "functions": [
    {
      "name": "setCount",
      "description": "Set the counter to a specific value",
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

Drop this into a MUP-compatible host, and it works.

## Getting Started

There are three ways to use MUP, depending on your setup:

### Option A: Chrome Extension (recommended)

Use MUP panels alongside **ChatGPT, Gemini, or Claude** — right in your browser.

```bash
git clone https://github.com/Ricky610329/mup.git
```

1. Open `chrome://extensions` → Enable "Developer mode" → "Load unpacked" → select `mup-extension/`
2. Open ChatGPT or Gemini → click the MUP extension icon to open the side panel
3. Drag `.html` MUP files from `poc/examples/` into the panel
4. Chat normally — the LLM automatically uses your MUP panels

**For full OS access (file system, camera):**

```bash
cd mup-native-host
node install.js
```

This registers a native messaging host that lets MUPs access your file system, open folder pickers, and capture photos. Run once, works forever.

### Option B: Standalone PoC

A self-contained MUP host with its own chat interface. No external LLM account needed (demo mode included).

```bash
cd poc
npm install
npm run dev
```

Opens at `http://localhost:5173`. Supports OpenAI, Anthropic, Gemini, and Ollama — configure via `.env` or the interactive setup screen.

### Option C: MCP Bridge

Use MUP panels in **Claude Desktop, Cursor**, or any MCP-compatible client.

```bash
cd mup-mcp-server
npm install
npm run build
node dist/index.js --mups-dir ../poc/examples
```

Registers all MUP functions as MCP tools. A browser panel opens automatically for the MUP UI.

### Built-in examples

9 ready-to-use MUPs in `poc/examples/`:

| MUP | Size | Description |
|-----|------|-------------|
| Counter | 1×1 | Click +/−, LLM sets value |
| Dice | 1×1 | Roll with animation, history |
| Timer | 1×1 | Countdown timer |
| Chart | 2×2 | Bar, line, pie charts |
| Camera | 2×2 | Live camera feed + snapshot |
| Drum Machine | 2×2 | 4-track step sequencer |
| Pixel Art | 2×2 | 16×16 pixel canvas |
| Sticky Notes | 2×2 | Draggable notes board |
| File Organizer | 2×2 | Browse and organize local files |

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                    MUP (.html file)                   │
│  manifest + UI + functions                           │
└──────────────┬───────────────────────────────────────┘
               │ loaded by
    ┌──────────┴──────────┬─────────────────┐
    ▼                     ▼                 ▼
┌─────────┐     ┌──────────────┐   ┌─────────────┐
│   PoC   │     │  Extension   │   │ MCP Bridge  │
│ (Vite)  │     │ (Side Panel) │   │  (stdio)    │
└─────────┘     └──────┬───────┘   └─────────────┘
                       │
                       ▼
              ┌─────────────────┐
              │  Native Host    │
              │ (file system,   │
              │  camera, OS)    │
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

## License

[MIT](LICENSE)
