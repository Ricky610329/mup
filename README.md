# MUP — Model UI Protocol

[![GitHub Stars](https://img.shields.io/github/stars/Ricky610329/mup?style=social)](https://github.com/Ricky610329/mup/stargazers)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[繁體中文](README.zh-TW.md)

> Bring interactive UI into LLM chat — so anyone can experience agentic AI, not just developers.

## Demos

- **[Draw & Analyze](https://youtu.be/14-4sgN2hSk)** — Pixel Art + Chart
- **[Beat Making](https://youtu.be/vp6W5ZiFfuM)** — Drum Machine
- **[See & Draw](https://youtu.be/jk7Hlzcy4ko)** — Camera + Pixel Art
- **[Smart Notes](https://youtu.be/9EG0XhwVn1c)** — Sticky Notes
- **[File Report](https://youtu.be/wcM7zEUrIHY)** — File Organizer + Chart

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

- **Shared functions.** A function can be called by the LLM (as a tool) or triggered by the user (via UI). Both sides operate on the same state through the same code.
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

```bash
git clone https://github.com/Ricky610329/mup.git
cd mup/mup-agent
npm install
npm run build
```

Set your API key and run:

```bash
ANTHROPIC_API_KEY=sk-ant-... node dist/index.js --mups-dir ../examples
```

A browser window opens automatically with the chat panel and MUP grid. Load MUPs from the manager card, chat with the agent, and the LLM calls MUP functions as tools.

### Options

```
mup-agent [options] [file1.html file2.html ...]

--mups-dir <dir>     Load all .html MUP files from a directory
--provider <name>    LLM provider: anthropic, openai, google, groq, xai (default: anthropic)
--model <id>         Model ID (default: claude-sonnet-4-6)
--api-key <key>      API key (or set ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.)
--port <port>        UI panel port (default: 3100)
--no-open            Don't auto-open the browser
```

### Built-in Examples

9 ready-to-use MUPs in `examples/`:

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
┌──────────────────────────────────────────┐
│             MUP (.html file)             │
│        manifest + UI + functions         │
└──────────────────┬───────────────────────┘
                   │ loaded by
                   ▼
┌──────────────────────────────────────────┐
│           mup-agent (Node.js)            │
│                                          │
│  ┌─────────────┐    ┌─────────────────┐  │
│  │ Agent       │    │ MUP Manager     │  │
│  │ (pi-agent-  │    │ (load, parse,   │  │
│  │  core)      │    │  route calls)   │  │
│  └──────┬──────┘    └────────┬────────┘  │
│         │  LLM API          │            │
│         ▼                   │            │
│  ┌─────────────┐            │            │
│  │ LLM Provider│            │            │
│  │ (Anthropic, │            │            │
│  │  OpenAI...) │            │            │
│  └─────────────┘            │            │
└─────────────────────────────┼────────────┘
                              │ WebSocket
                              ▼
                   ┌─────────────────────┐
                   │   Browser Panel     │
                   │  (chat + MUP grid)  │
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

## License

[MIT](LICENSE)
