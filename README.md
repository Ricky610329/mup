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
- **[File Report](https://youtu.be/wcM7zEUrIHY)** — Workspace + Chart

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
- **[Examples](spec/MUP-Examples.md)** — 16 example MUPs with walkthroughs

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
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env
npm start
```

A browser window opens automatically. The 16 built-in example MUPs are pre-loaded — activate them from the Manager card, chat with the agent, and the LLM calls MUP functions as tools.

> **No API key yet?** Just skip the `echo` step — `npm start` will open the Settings panel in the browser where you can enter it.

### Other providers

```bash
# OpenAI
echo "OPENAI_API_KEY=sk-..." > .env
npm start -- --provider openai --model gpt-4o

# Google
echo "GOOGLE_API_KEY=..." > .env
npm start -- --provider google --model gemini-2.5-flash
```

### Options

```
--provider <name>    LLM provider: anthropic, openai, google, groq, xai (default: anthropic)
--model <id>         Model ID (default: claude-sonnet-4-6)
--api-key <key>      API key (alternative to .env)
--mups-dir <dir>     Load MUPs from a directory (default: examples/)
--port <port>        UI panel port (default: 3100)
--no-open            Don't auto-open the browser
```

### Built-in Examples

16 ready-to-use MUPs in `examples/`:

| Category | MUP | Description |
|----------|-----|-------------|
| basic | Counter | Click +/−, LLM sets value |
| basic | Dice | Roll with animation, history |
| basic | Timer | Countdown with progress ring |
| basic | Chess | Play chess against the LLM |
| creative | Pixel Art | 16×16 pixel canvas |
| creative | Markdown | Markdown renderer, loads files |
| creative | Editor | Text editor with selection-aware LLM |
| creative | Slides | Presentation builder |
| data | Chart | Bar, line, pie charts |
| data | Search | Web search via host |
| data | Workspace | Browse, read, write local files |
| media | Camera | Live camera + snapshot |
| media | Voice | Speech-to-text + text-to-speech |
| media | Drum Machine | 4-track step sequencer |
| productivity | Sticky Notes | Draggable notes board |
| productivity | Kanban | Task board with drag-and-drop |

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
