# MUP Setup Guide for Claude Code

This guide is for Claude Code to set up MUP automatically. If you are Claude Code and a user asks you to "install MUP" or "set up MUP", follow these steps:

## Steps

1. Clone the repo (if not already cloned):
```bash
git clone https://github.com/Ricky610329/mup.git
cd mup
```

2. Build the MCP server:
```bash
cd mup-mcp-server
npm install
npm run build
```

3. Register as MCP server:
```bash
claude mcp add --transport stdio --scope user mup -- node /absolute/path/to/mup-mcp-server/dist/index.js --mups-dir /absolute/path/to/mup/examples
```

**Important:** Use absolute paths, not relative ones.

4. Tell the user to restart Claude Code (start a new conversation).

## After Setup

Once connected, Claude Code has access to a single `mup` tool that handles everything:

- Call MUP functions: `{ "mupId": "mup-pixel-art", "functionName": "fillRect", "functionArgs": { "x": 0, "y": 0, "width": 4, "height": 4, "color": "#ff0000" } }`
- Check user interactions: `{ "action": "checkInteractions" }`
- Save workspace: `{ "action": "save", "name": "my project", "description": "..." }`
- Load workspace: `{ "action": "load", "name": "my project" }`
- List workspaces: `{ "action": "workspaces" }`
- List available MUPs: `{ "action": "list" }`
- View history: `{ "action": "history" }`

MUPs are auto-activated on first use — no need to activate manually.

## Available MUPs

| MUP ID | Name | What it does |
|--------|------|-------------|
| mup-counter | Counter | Simple counter with +/- buttons |
| mup-dice | Dice | Roll dice with animation |
| mup-timer | Timer | Countdown timer with progress ring |
| mup-chess | Chess | Play chess (coordinate notation: e2e4) |
| mup-pixel-art | Pixel Art | 16x16 pixel canvas |
| mup-slides | Slides | Create presentations |
| mup-chart | Chart | Data visualization (bar, line, pie, etc.) |
| mup-camera | Camera | Live camera + photo capture |
| mup-voice | Voice | Speech-to-text + text-to-speech |
| mup-drum-machine | Drum Machine | 4-track step sequencer |
| mup-sticky-notes | Sticky Notes | Draggable notes board |
| mup-kanban | Kanban | Task board with columns |

## Notes

- The browser panel opens at `http://localhost:3200` (auto-finds available port if taken)
- `functionArgs` can be passed as JSON object or JSON string — both work
- Workspaces are saved in `~/.mup-mcp/workspaces/`
- Users can manage workspaces from the browser panel (Workspaces button in header)
