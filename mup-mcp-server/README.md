# mup-mcp-server

MCP server that turns HTML [MUP](https://github.com/Ricky610329/mup) panels into interactive tools for LLMs — render UI, call functions, and pipe data between panels.

## Install

```bash
npm install -g mup-mcp-server
```

Or use directly:

```bash
npx mup-mcp-server --mups-dir ./my-mups
```

## Usage with Claude Code

```bash
claude mcp add --transport stdio --scope user mup -- npx mup-mcp-server
```

Optionally point to a folder of MUP files:

```bash
claude mcp add --transport stdio --scope user mup -- npx mup-mcp-server --mups-dir /path/to/mups
```

## Usage with Claude Desktop

Add to `claude_desktop_config.json`:

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

## Options

```
--mups-dir <dir>     Load all .html MUP files from a directory
--port <port>        UI panel port (default: 3200)
--no-open            Don't auto-open the browser
```

## What is MUP?

A **MUP** is an interactive UI component that lives inside an LLM chat. It's a single `.html` file with a manifest and callable functions — no build step, no framework.

The user operates it by clicking buttons; the LLM operates it through function calls. Both sides see each other's actions in real time.

Includes a built-in Chat widget and presentation MUPs (slides, charts, tables, diagrams).

## Links

- [GitHub](https://github.com/Ricky610329/mup)
- [Spec](https://github.com/Ricky610329/mup/blob/main/spec/MUP-Spec.md)
- [Slides MUPs](https://github.com/Ricky610329/mup/tree/main/mups/slides)
- [Demo Videos](https://github.com/Ricky610329/mup#demos)

## License

MIT
