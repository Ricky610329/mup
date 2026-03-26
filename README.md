# MUP — Model UI Protocol

[![GitHub Stars](https://img.shields.io/github/stars/Ricky610329/mup?style=social)](https://github.com/Ricky610329/mup/stargazers)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[繁體中文](README.zh-TW.md)

> Bring interactive UI into LLM chat — so anyone can experience agentic AI, not just developers.

## Demos

- **[Stop Making Apps. Make MUP.](https://youtu.be/HkmWpmfX46o)** — Full demo: Music, Slides, Pixel Art, Notes
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
- **[Examples](spec/MUP-Examples.md)** — Example MUPs with walkthroughs

## Install

### npm (recommended)

```bash
npm install -g mup-mcp-server
```

Or run directly:

```bash
npx mup-mcp-server --mups-dir ./my-mups
```

Also available on the [MCP Server Registry](https://registry.modelcontextprotocol.io/).

### From source

```bash
git clone https://github.com/Ricky610329/mup.git
cd mup/mup-mcp-server
npm install && npm run build
```

## Getting Started

### With Claude Code (recommended)

```bash
claude mcp add --transport stdio --scope user mup -- npx mup-mcp-server
```

Restart Claude Code. A browser window opens at `http://localhost:3200`. Use the MUPs panel to load a folder of MUP `.html` files, or start with the built-in Chat widget.

#### Real-time channel mode

MUPs can push interactions directly into Claude's conversation via channel notifications. To enable:

```bash
claude --dangerously-load-development-channels server:mup
```

This lets MUPs deliver user actions to Claude in real time. Without this flag, all MUP features still work — interactions are just delivered via polling instead of push.

### With Claude Desktop

Add to your `claude_desktop_config.json`:

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

## Architecture

```
┌──────────────────────────────────────────┐
│             MUP (.html file)             │
│        manifest + UI + functions         │
└──────────────────┬───────────────────────┘
                   │ loaded by
                   ▼
            ┌──────────────┐
            │  MCP Server  │
            │ (Claude Code │
            │  / Desktop)  │
            └──────┬───────┘
                   │ WebSocket
                   ▼
      ┌─────────────────────────────┐
      │        Browser Panel        │
      │  (MUP grid + Chat widget   │
      │   + workspace manager)     │
      └─────────────────────────────┘
```

## Star History

[![Star History Chart](https://api.star-history.com/image?repos=Ricky610329/mup&type=date&legend=top-left)](https://www.star-history.com/?repos=Ricky610329%2Fmup&type=date&legend=top-left)

## License

[MIT](LICENSE)
