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

### 1. Clone and install

```bash
git clone https://github.com/Ricky610329/mup.git
cd mup/poc
npm install
```

### 2. Run the PoC

```bash
npm run dev
```

Opens a local MUP host at `http://localhost:5173`. By default it runs in **demo mode** — no API key needed, you can start playing right away.

### 3. Load a MUP

- Pick one from the built-in menu, or
- Drag and drop any `.html` MUP file into the window

### 4. (Optional) Connect a real LLM

Create a `poc/.env` file with your provider of choice:

```env
# OpenAI
VITE_LLM_PROVIDER=openai
VITE_LLM_API_KEY=sk-...
VITE_LLM_MODEL=gpt-4o

# Anthropic
VITE_LLM_PROVIDER=anthropic
VITE_LLM_API_KEY=sk-ant-...
VITE_LLM_MODEL=claude-sonnet-4-6

# Google Gemini
VITE_LLM_PROVIDER=gemini
VITE_LLM_API_KEY=AIza...
VITE_LLM_MODEL=gemini-2.5-flash

# Ollama (local, no API key needed)
VITE_LLM_PROVIDER=ollama
VITE_LLM_MODEL=llama3
# VITE_OLLAMA_ENDPOINT=http://localhost:11434
```

Or skip the `.env` file — the setup screen lets you choose a provider interactively.

Restart the dev server after creating the file.

### Built-in examples

Counter, Dice, Timer, Chart, Camera, Drum Machine, Pixel Art, Sticky Notes, File Organizer — 9 ready-to-use MUPs included in `poc/examples/`.

## Docs

- [Spec](spec/MUP-Spec.md)
- [Examples](spec/MUP-Examples.md)

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
