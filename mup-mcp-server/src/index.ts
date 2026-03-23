#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";
import * as net from "node:net";
import { exec } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { MupManager } from "./manager.js";
import { UiBridge } from "./bridge.js";
import { WorkspaceManager } from "./workspace.js";
import { PipelineManager } from "./pipeline.js";
import { CONFIG } from "./config.js";
import { scanHtmlFiles, buildFolderTree } from "./scanner.js";
import {
  text, buildToolDescription, buildMupDetail,
  handleList, handleCheckInteractions, handleHistory, handlePipe,
} from "./handlers.js";
import type { FolderTreeNode, SendLoadMupFn } from "./types.js";

// ---- Utilities ----

function openBrowser(url: string): void {
  const cmd = process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "string") { try { return JSON.parse(raw); } catch { return {}; } }
  if (typeof raw === "object") return raw as Record<string, unknown>;
  return {};
}

async function findAvailablePort(startPort: number): Promise<number> {
  for (let port = startPort; port < startPort + CONFIG.portScanRange; port++) {
    const available = await new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.once("listening", () => { server.close(); resolve(true); });
      server.listen(port);
    });
    if (available) return port;
  }
  return startPort;
}

// ---- CLI ----

interface CliConfig {
  mupFiles: string[];
  mupsDirs: string[];
  port: number;
  noOpen: boolean;
}

function parseCliArgs(): CliConfig {
  const cliArgs = process.argv.slice(2);
  const config: CliConfig = { mupFiles: [], mupsDirs: [], port: CONFIG.defaultPort, noOpen: false };

  for (let i = 0; i < cliArgs.length; i++) {
    const arg = cliArgs[i];
    if (arg === "--mups-dir" && cliArgs[i + 1]) {
      const dir = path.resolve(cliArgs[++i]);
      if (!fs.existsSync(dir)) { console.error(`[mup-mcp] Directory not found: ${dir}`); process.exit(1); }
      config.mupFiles.push(...scanHtmlFiles(dir));
      config.mupsDirs.push(dir);
    } else if (arg === "--port" && cliArgs[i + 1]) {
      config.port = parseInt(cliArgs[++i], 10);
    } else if (arg === "--no-open") {
      config.noOpen = true;
    } else if (arg === "--help" || arg === "-h") {
      console.error(`\nmup-mcp-server — MCP server with interactive MUP UI panels\n\nUsage:\n  mup-mcp-server [options] [file1.html ...]\n\nOptions:\n  --mups-dir <dir>     Load all .html MUP files from a directory (also used as workspace)\n  --port <port>        UI panel port (default: ${CONFIG.defaultPort})\n  --no-open            Don't auto-open the browser\n  -h, --help           Show this help\n`);
      process.exit(0);
    } else if (arg.endsWith(".html") || arg.endsWith(".htm")) {
      config.mupFiles.push(path.resolve(arg));
    }
  }
  return config;
}

// ---- Browser Event Wiring ----

function setupBrowserEvents(bridge: UiBridge, manager: MupManager, ws: WorkspaceManager, sendLoadMup: SendLoadMupFn): void {
  bridge.typedOn("browser-connected", () => {
    ws.sendRestoredState(bridge);
  });

  bridge.typedOn("activate-mup", (mupId) => {
    const mup = manager.activate(mupId);
    if (mup) { sendLoadMup(mupId, mup); ws.markMetadataDirty(); console.error(`[mup-mcp] Activated: ${mup.manifest.name}`); }
  });

  bridge.typedOn("deactivate-mup", (mupId) => {
    manager.deactivate(mupId);
    ws.onMupDeactivated(mupId);
    console.error(`[mup-mcp] Deactivated: ${mupId}`);
  });

  bridge.typedOn("new-instance", (baseMupId, customName) => {
    const mup = manager.activateInstance(baseMupId);
    if (mup) {
      if (customName) { mup.manifest.name = customName; ws.customNames[mup.manifest.id] = customName; }
      sendLoadMup(mup.manifest.id, mup); ws.markMetadataDirty();
      console.error(`[mup-mcp] New instance: ${mup.manifest.name} (${mup.manifest.id})`);
    }
  });

  bridge.typedOn("load-folder", (mups) => {
    for (const { html, fileName } of mups) {
      try { manager.scanFromHtml(html, fileName); }
      catch (err: unknown) { console.error(`[mup-mcp] Skipping ${fileName}: ${(err as Error).message}`); }
    }
    bridge.sendRaw({ type: "mup-catalog", catalog: bridge.buildCatalogSummary() });
  });

  bridge.typedOn("register-and-activate", (mupId, html, fileName) => {
    try {
      const manifest = manager.parseManifest(html, fileName);
      manifest.id = mupId;
      if (!manager.getCatalog().find((e) => e.manifest.id === mupId)) manager.loadFromHtml(html, fileName);
      else manager.activate(mupId);
      const mup = manager.get(mupId);
      if (mup) { sendLoadMup(mupId, mup); ws.markMetadataDirty(); console.error(`[mup-mcp] Registered + activated: ${manifest.name}`); }
    } catch (err: unknown) { console.error(`[mup-mcp] Failed to register: ${(err as Error).message}`); }
  });

  bridge.typedOn("state-update", (mupId) => ws.markMupDirty(mupId));
  bridge.typedOn("save-grid-layout", (layout) => { if (Array.isArray(layout)) { ws.gridLayout = layout; ws.markMetadataDirty(); } });
  bridge.typedOn("rename-mup", (mupId, newName) => { if (mupId && newName) { ws.customNames[mupId] = newName; ws.markMetadataDirty(); console.error(`[mup-mcp] Renamed: ${mupId} → ${newName}`); } });
  bridge.typedOn("browser-disconnected", () => { ws.flushSave(); console.error("[mup-mcp] Saved on disconnect"); });
}

// ---- Hot-Reload File Watching ----

function setupFileWatching(
  mupsDirs: string[], manager: MupManager, bridge: UiBridge,
  sendLoadMup: SendLoadMupFn, rebuildFolderTree: () => void
): void {
  for (const dir of mupsDirs) {
    try {
      fs.watch(dir, { recursive: true }, (_, filename) => {
        if (!filename || !filename.endsWith(".html")) return;
        // Ignore files inside .mup/ directory
        if (filename.startsWith(".mup")) return;
        const filePath = path.join(dir, filename);
        if (!fs.existsSync(filePath)) return;
        try {
          const html = fs.readFileSync(filePath, "utf-8");
          const manifest = manager.parseManifest(html, filePath);
          const entry = manager.getCatalog().find((e) => e.manifest.id === manifest.id);
          if (entry) { entry.html = html; entry.manifest = manifest; }
          else { manager.scanFile(filePath); rebuildFolderTree(); console.error(`[mup-mcp] Discovered: ${manifest.name}`); }
          if (manager.isActive(manifest.id)) {
            const mup = manager.get(manifest.id);
            if (mup) { mup.html = html; mup.manifest = manifest; sendLoadMup(manifest.id, mup); console.error(`[mup-mcp] Hot-reloaded: ${manifest.name}`); }
          }
        } catch (err) {
          console.error(`[mup-mcp] Error processing file change "${filename}":`, err);
        }
      });
    } catch (err) {
      console.error(`[mup-mcp] Failed to watch directory "${dir}":`, err);
    }
  }
}

// ---- MCP Server Setup ----

function setupMcpServer(
  manager: MupManager, bridge: UiBridge, ws: WorkspaceManager,
  port: number, sendLoadMup: SendLoadMupFn,
  ensureActive: (mupId: string) => { error?: string; activated?: string },
  pipeline: PipelineManager
): Server {
  const server = new Server({ name: "mup-mcp-server", version: "0.2.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{
      name: "mup",
      description: buildToolDescription(manager, port),
      inputSchema: {
        type: "object" as const,
        properties: {
          action: { type: "string", description: '"checkInteractions" to check user UI activity, "list" to list MUPs, "pipe" to manage data pipes. Omit when calling a function.' },
          mupId: { type: "string", description: "MUP ID (e.g. mup-chess, mup-chart). Auto-activated on first use." },
          functionName: { type: "string", description: "Function to call (e.g. makeMove, renderChart, setPixels)" },
          functionArgs: { type: "object", description: "Arguments for the function. Can be a JSON object or JSON string." },
          since: { type: "number", description: "Unix timestamp (ms). Only return interactions after this time. Used with checkInteractions." },
          subAction: { type: "string", description: 'For pipe action: "create", "list", "delete", "enable", "disable"' },
          pipeId: { type: "string", description: "Pipe ID for delete/enable/disable." },
          sourceMupId: { type: "string", description: "Pipe source MUP ID." },
          sourceFunction: { type: "string", description: "Optional: call this function on source to get data (else uses stateData)." },
          targetMupId: { type: "string", description: "Pipe target MUP ID." },
          targetFunction: { type: "string", description: "Function to call on target MUP." },
          transform: { type: "object", description: 'Key mapping: { targetArgName: "source.path" }. Use "." for entire data, "\'literal\'" for strings.' },
          debounceMs: { type: "number", description: "Debounce interval in ms (default 500)." },
        },
      },
    }],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = (request.params.arguments || {}) as Record<string, unknown>;

    // Dispatch by action
    if (args.action === "list") return handleList(manager);
    if (args.action === "checkInteractions") return handleCheckInteractions(manager, args);
    if (args.action === "history") return handleHistory(ws, manager, args);
    if (args.action === "pipe") return handlePipe(pipeline, args);

    // --- Call MUP function ---
    const mupId = args.mupId as string;
    const fn = args.functionName as string;
    if (!mupId || !fn) return { content: [text('Provide "mupId" and "functionName", or use "action": "list" / "checkInteractions" / "history".')], isError: true };

    const activation = ensureActive(mupId);
    if (activation.error) return { content: [text(activation.error)], isError: true };

    const fnArgs = parseArgs(args.functionArgs);

    // Lightweight schema validation: check required fields and basic types
    const mup = manager.get(mupId);
    const fnDef = mup?.manifest.functions.find(f => f.name === fn);
    if (fnDef?.inputSchema) {
      const schema = fnDef.inputSchema;
      const required = (schema.required || []) as string[];
      const properties = (schema.properties || {}) as Record<string, Record<string, unknown>>;
      const missing = required.filter(r => fnArgs[r] === undefined);
      if (missing.length > 0) {
        return { content: [text(`Missing required field(s): ${missing.join(", ")}`)], isError: true };
      }
      for (const [key, val] of Object.entries(fnArgs)) {
        const prop = properties[key];
        if (prop?.type && val !== undefined && val !== null) {
          const actual = Array.isArray(val) ? "array" : typeof val;
          if (prop.type === "integer" && (typeof val !== "number" || !Number.isInteger(val as number))) {
            return { content: [text(`Field "${key}" must be an integer, got ${typeof val}`)], isError: true };
          } else if (prop.type !== "integer" && prop.type !== actual && !(prop.type === "number" && actual === "number")) {
            return { content: [text(`Field "${key}" must be ${prop.type}, got ${actual}`)], isError: true };
          }
        }
      }
    }

    if (!mup?.stateSummary && manager.isActive(mupId)) await bridge.waitForMupLoaded(mupId);

    const result = await bridge.callFunction(mupId, fn, fnArgs);
    const resultText = result.content.map((c) => c.text || "").join(" ").trim();
    ws.addCallHistory(mupId, fn, fnArgs, resultText);

    const content: Array<{ type: "text"; text: string }> = [];
    if (activation.activated) content.push(text(`[Auto-activated] ${activation.activated}`));

    for (const c of result.content) {
      if (c.data !== undefined) {
        const json = JSON.stringify(c.data);
        if (json.length > CONFIG.maxDataResponseLength) {
          content.push({ type: "text" as const, text: `[data truncated, ${json.length} chars. Use specific queries instead of full data dumps.]` });
        } else {
          content.push({ type: "text" as const, text: json });
        }
      } else {
        let t = c.text || "";
        if (t.length > CONFIG.maxResponseLength) t = t.slice(0, CONFIG.maxResponseLength) + `\n... (truncated, ${t.length} chars total)`;
        content.push({ type: "text" as const, text: t });
      }
    }

    // "discuss" interactions are delivered immediately (appended to the current
    // function call result) rather than queued for checkInteractions, ensuring
    // time-sensitive user input reaches the LLM without polling delay.
    // See spec: MUP-Spec.md § notifyInteraction → Reserved action: discuss
    const events = manager.drainEvents();
    const discuss = events.filter((e) => e.action === "discuss");
    for (const e of events.filter((e) => e.action !== "discuss")) manager.addEvent(e.mupId, e.action, e.summary, e.data);
    if (discuss.length > 0) {
      content.push(text(`\n--- User wants your attention ---\n${discuss.map((e) => `[${e.mupName}] ${e.summary}`).join("\n")}`));
    }

    ws.markMupDirty(mupId);
    return { content, isError: result.isError };
  });

  return server;
}

// ---- Lifecycle ----

function setupLifecycle(ws: WorkspaceManager): void {
  function gracefulShutdown() { ws.flushSave(); console.error("[mup-mcp] Saved on shutdown"); process.exit(0); }
  process.on("SIGINT", gracefulShutdown);
  process.on("SIGTERM", gracefulShutdown);
  setInterval(() => ws.autoSave(), CONFIG.autoSaveIntervalMs);
}

// ---- Main ----

async function main() {
  const { mupFiles, mupsDirs, port: requestedPort, noOpen } = parseCliArgs();

  // Default to ../examples if no MUPs specified
  if (mupFiles.length === 0 && mupsDirs.length === 0) {
    const defaultDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "examples");
    if (fs.existsSync(defaultDir)) {
      mupFiles.push(...scanHtmlFiles(defaultDir));
      mupsDirs.push(defaultDir);
      console.error(`[mup-mcp] No MUPs specified — loading defaults from ${defaultDir}`);
    }
  }

  // --- Manager ---
  const manager = new MupManager();
  for (const file of mupFiles) {
    try { const m = manager.scanFile(file); console.error(`[mup-mcp] Scanned: ${m.name} (${m.id})`); }
    catch (err: unknown) { console.error(`[mup-mcp] Skip ${file}: ${(err as Error).message}`); }
  }

  let serverFolderTree: FolderTreeNode[] = [];
  for (const dir of mupsDirs) serverFolderTree.push(...buildFolderTree(dir, manager));

  const port = await findAvailablePort(requestedPort);

  const bridge = new UiBridge(manager, port);
  bridge.folderTree = serverFolderTree;
  bridge.folderPath = mupsDirs.length > 0 ? mupsDirs[0] : "";
  await bridge.start();

  // --- Workspace (folder-based, in-place) ---
  const primaryDir = mupsDirs.length > 0 ? mupsDirs[0] : path.resolve(".");
  const ws = new WorkspaceManager(manager, primaryDir);
  ws.setBridge(bridge);

  // --- Restore from .mup/ folder ---
  const restored = ws.restoreFromDisk();
  if (restored.length > 0) console.error(`[mup-mcp] Restored: ${restored.join(", ")}`);

  // --- Helpers ---
  const sendLoadMup: SendLoadMupFn = (mupId, mup) => {
    bridge.sendRaw({ type: "load-mup", mupId: mup.manifest.id, html: mup.html, manifest: mup.manifest, savedState: mup.stateData });
  };

  function ensureActive(mupId: string): { error?: string; activated?: string } {
    if (manager.isActive(mupId)) return {};
    const mup = manager.activate(mupId);
    if (!mup) return { error: `MUP "${mupId}" not found. Use { "action": "list" } to see available MUPs.` };
    sendLoadMup(mupId, mup);
    ws.markMetadataDirty();
    console.error(`[mup-mcp] Auto-activated: ${mup.manifest.name}`);
    return { activated: buildMupDetail(mup.manifest) };
  }

  function rebuildFolderTree(): void {
    serverFolderTree = [];
    for (const dir of mupsDirs) serverFolderTree.push(...buildFolderTree(dir, manager));
    bridge.folderTree = serverFolderTree;
    bridge.sendRaw({ type: "folder-tree", tree: serverFolderTree, path: bridge.folderPath });
  }

  // --- Pipeline ---
  const pipeline = new PipelineManager((mupId, fn, args) => bridge.callFunction(mupId, fn, args));
  bridge.typedOn("state-update", (mupId, _summary, data) => pipeline.onStateUpdate(mupId, data));
  bridge.typedOn("deactivate-mup", (mupId) => pipeline.onMupDeactivated(mupId));

  // --- Wire up events ---
  setupBrowserEvents(bridge, manager, ws, sendLoadMup);
  setupFileWatching(mupsDirs, manager, bridge, sendLoadMup, rebuildFolderTree);
  setupLifecycle(ws);

  // --- MCP Server ---
  const server = setupMcpServer(manager, bridge, ws, port, sendLoadMup, ensureActive, pipeline);

  // --- Browser auto-open ---
  if (!noOpen) {
    const openTimer = setTimeout(() => { if (!bridge.isConnected()) openBrowser(`http://localhost:${port}`); }, CONFIG.browserOpenDelayMs);
    bridge.typedOnce("browser-connected", () => clearTimeout(openTimer));
  }

  // --- Start ---
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[mup-mcp] MCP server running (stdio). UI panel on port ${port}. ${manager.getCatalog().length} MUPs loaded. Workspace: ${primaryDir}`);
}

main().catch((err) => { console.error("[mup-mcp] Fatal:", err); process.exit(1); });
