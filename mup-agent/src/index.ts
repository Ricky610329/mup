#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { MupManager } from "./manager.js";
import { UiBridge } from "./bridge.js";
import { createMupAgent } from "./agent.js";
import { loadSettings } from "./settings.js";

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
  let provider = "anthropic";
  let modelId = "claude-sonnet-4-6";
  let apiKey: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--mups-dir" && args[i + 1]) {
      const dir = path.resolve(args[++i]);
      if (!fs.existsSync(dir)) {
        console.error(`[mup-agent] Directory not found: ${dir}`);
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
    } else if (arg === "--provider" && args[i + 1]) {
      provider = args[++i];
    } else if (arg === "--model" && args[i + 1]) {
      modelId = args[++i];
    } else if (arg === "--api-key" && args[i + 1]) {
      apiKey = args[++i];
    } else if (arg === "--help" || arg === "-h") {
      console.error(`
mup-agent — AI agent with interactive MUP UI panels

Usage:
  mup-agent [options] [file1.html file2.html ...]

Options:
  --mups-dir <dir>     Load all .html MUP files from a directory
  --provider <name>    LLM provider: anthropic, openai, google, groq, xai, etc. (default: anthropic)
  --model <id>         Model ID (default: claude-sonnet-4-6)
  --api-key <key>      API key (or set ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.)
  --port <port>        UI panel port (default: 3100)
  --no-open            Don't auto-open the browser
  -h, --help           Show this help

Examples:
  mup-agent --mups-dir ../examples
  mup-agent --provider openai --model gpt-4o counter.html chart.html
  ANTHROPIC_API_KEY=sk-ant-... mup-agent --mups-dir ./examples
`);
      process.exit(0);
    } else if (arg.endsWith(".html") || arg.endsWith(".htm")) {
      mupFiles.push(path.resolve(arg));
    }
  }

  // Scan MUPs into catalog (not activated yet — user activates via Manager card)
  const manager = new MupManager();
  for (const file of mupFiles) {
    try {
      const manifest = manager.scanFile(file);
      console.error(
        `[mup-agent] Scanned: ${manifest.name} (${manifest.functions.length} function${manifest.functions.length !== 1 ? "s" : ""})`
      );
    } catch (err) {
      console.error(
        `[mup-agent] Skipping ${path.basename(file)}: ${(err as Error).message}`
      );
    }
  }

  // Default to ../examples if no MUPs specified
  if (mupFiles.length === 0) {
    const defaultDir = path.resolve(__dirname, "..", "..", "examples");
    if (fs.existsSync(defaultDir)) {
      const files = fs.readdirSync(defaultDir).filter(f => f.endsWith(".html")).map(f => path.join(defaultDir, f));
      for (const file of files) {
        try {
          const manifest = manager.scanFile(file);
          console.error(`[mup-agent] Scanned: ${manifest.name} (${manifest.functions.length} function${manifest.functions.length !== 1 ? "s" : ""})`);
        } catch {}
      }
      mupFiles = files;
      console.error(`[mup-agent] Loaded default examples from ${defaultDir}`);
    } else {
      console.error("[mup-agent] No MUPs specified — starting in chat-only mode.");
    }
  }

  // Start UI bridge
  const bridge = new UiBridge(manager, port);
  if (mupFiles.length > 0) {
    bridge.initialFolder = path.dirname(mupFiles[0]);
  }
  await bridge.start();

  // Merge saved settings with CLI args (CLI takes precedence)
  const saved = loadSettings();
  const finalProvider = provider !== "anthropic" ? provider : (saved.provider || provider);
  const finalModel = modelId !== "claude-sonnet-4-6" ? modelId : (saved.model || modelId);
  const finalKey = apiKey || saved.apiKey || undefined;

  // Create agent
  const agent = createMupAgent({ manager, bridge, provider: finalProvider, modelId: finalModel, apiKey: finalKey });
  console.error(
    `[mup-agent] Agent ready (${provider}/${modelId}, ${manager.getCatalog().length} MUPs in catalog)`
  );

  // Auto-open browser
  if (!noOpen) {
    openBrowser(`http://localhost:${port}`);
  }

  // Keep process alive
  process.on("SIGINT", () => {
    console.error("\n[mup-agent] Shutting down...");
    process.exit(0);
  });

  process.on("unhandledRejection", (reason) => {
    console.error("[mup-agent] Unhandled rejection:", reason);
  });
}

main().catch((err) => {
  console.error("[mup-agent] Fatal:", err);
  process.exit(1);
});
