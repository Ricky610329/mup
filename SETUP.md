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
claude mcp add --transport stdio --scope user mup -- node /absolute/path/to/mup-mcp-server/dist/index.js --mups-dir /absolute/path/to/mup/mups
```

**Important:** Use absolute paths, not relative ones.

4. Tell the user to restart Claude Code (start a new conversation).

## After Setup

Once connected, Claude Code has access to a single `mup` tool that handles everything:

- Call MUP functions: `{ "mupId": "mup-chess", "functionName": "makeMove", "functionArgs": { "move": "e2e4" } }`
- Check user interactions: `{ "action": "checkInteractions" }`
- List available MUPs: `{ "action": "list" }`
- View call history: `{ "action": "history" }`
- Create new panel instance: `{ "action": "new-instance", "mupId": "mup-chart" }`
- Manage data pipes: `{ "action": "pipe", "subAction": "create", ... }`
- Set notification level: `{ "action": "setNotificationLevel", "mupId": "...", "level": "immediate" }`

MUPs are auto-activated on first use — no need to activate manually.

## Available MUPs

Built-in:

| MUP ID | Name | What it does |
|--------|------|-------------|
| mup-chat | Chat | Built-in chat widget (always available, no file needed) |

MUPs in `mups/slides/`:

| MUP ID | Name | What it does |
|--------|------|-------------|
| mup-slides | Slides | Presentation builder with themes and layouts |
| mup-chart | Chart | Data visualization (bar, line, pie, etc.) |
| mup-table | Table | Structured data table with export |
| mup-diagram | Diagram | Mermaid-based diagrams with SVG export |

Archived examples in `archive/examples/` (basic, music, productivity, etc.).

## Notes

- The browser panel opens at `http://localhost:3200` (auto-finds available port if taken)
- `functionArgs` can be passed as JSON object or JSON string — both work
- Workspace state is saved automatically in `.mup/workspace.json` (relative to working directory)
- MUPs manage their own state via browser `localStorage`
- Use the browser panel's MUPs folder path input to load MUP files from any directory
