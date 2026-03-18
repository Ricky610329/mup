#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";
import { exec } from "node:child_process";
import { MupManager } from "./manager.js";
import { UiBridge } from "./bridge.js";
import { McpServer } from "./mcp.js";

function openBrowser(url: string): void {
  const cmd =
    process.platform === "win32"
      ? `start "" "${url}"`
      : process.platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

async function main() {
  const args = process.argv.slice(2);

  let mupFiles: string[] = [];
  let port = 3100;
  let noOpen = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--mups-dir" && args[i + 1]) {
      const dir = path.resolve(args[++i]);
      if (!fs.existsSync(dir)) {
        console.error(`[mup-mcp] Directory not found: ${dir}`);
        process.exit(1);
      }
      const files = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".html"))
        .map((f) => path.join(dir, f));
      mupFiles.push(...files);
    } else if (arg === "--port" && args[i + 1]) {
      port = parseInt(args[++i], 10);
    } else if (arg === "--no-open") {
      noOpen = true;
    } else if (arg === "--help" || arg === "-h") {
      console.error(`
mup-mcp-server — Bridge MUP skills to MCP clients (Claude Desktop, Cursor, etc.)

Usage:
  mup-mcp-server [options] [file1.html file2.html ...]

Options:
  --mups-dir <dir>   Load all .html MUP files from a directory
  --port <port>      UI panel port (default: 3100)
  --no-open          Don't auto-open the browser
  -h, --help         Show this help

Examples:
  mup-mcp-server --mups-dir ./examples
  mup-mcp-server counter.html chart.html --port 3200

Claude Desktop config (claude_desktop_config.json):
  {
    "mcpServers": {
      "mup": {
        "command": "node",
        "args": ["path/to/mup-mcp-server/dist/index.js", "--mups-dir", "path/to/mups"]
      }
    }
  }
`);
      process.exit(0);
    } else if (arg.endsWith(".html") || arg.endsWith(".htm")) {
      mupFiles.push(path.resolve(arg));
    }
  }

  if (mupFiles.length === 0) {
    console.error(
      "[mup-mcp] No MUP files specified. Use --mups-dir <dir> or pass .html files. Try --help."
    );
    process.exit(1);
  }

  // Load MUPs
  const manager = new MupManager();
  for (const file of mupFiles) {
    try {
      const manifest = manager.loadFromFile(file);
      console.error(
        `[mup-mcp] Loaded: ${manifest.name} (${manifest.functions.length} function${manifest.functions.length !== 1 ? "s" : ""})`
      );
    } catch (err) {
      console.error(
        `[mup-mcp] Skipping ${path.basename(file)}: ${(err as Error).message}`
      );
    }
  }

  if (manager.getAll().length === 0) {
    console.error("[mup-mcp] No valid MUPs loaded. Exiting.");
    process.exit(1);
  }

  // Start UI bridge (HTTP + WebSocket)
  const bridge = new UiBridge(manager, port);
  await bridge.start();

  // Auto-open browser
  if (!noOpen) {
    openBrowser(`http://localhost:${port}`);
  }

  // Start MCP server (stdio) — this blocks
  const mcp = new McpServer(manager, bridge);
  await mcp.start();
}

main().catch((err) => {
  console.error("[mup-mcp] Fatal:", err);
  process.exit(1);
});
