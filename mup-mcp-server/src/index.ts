#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";
import * as net from "node:net";
import { exec } from "node:child_process";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { MupManager, type LoadedMup } from "./manager.js";
import { UiBridge } from "./bridge.js";
import { WorkspaceManager } from "./workspace.js";
import { CONFIG } from "./config.js";
import type { FolderTreeNode, CallHistoryEntry, SendLoadMupFn } from "./types.js";

// ---- File Scanning ----

function scanHtmlFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.name.startsWith(".")) {
      results.push(...scanHtmlFiles(path.join(dir, entry.name)));
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      results.push(path.join(dir, entry.name));
    }
  }
  return results;
}

function buildFolderTree(dir: string, manager: MupManager): FolderTreeNode[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const folders: FolderTreeNode[] = [];
  const files: FolderTreeNode[] = [];

  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith(".")) {
      const children = buildFolderTree(path.join(dir, entry.name), manager);
      if (children.length > 0) folders.push({ type: "folder", name: entry.name, children });
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      try {
        const manifest = manager.parseManifest(fs.readFileSync(path.join(dir, entry.name), "utf-8"), path.join(dir, entry.name));
        const catalogEntry = manager.getCatalog().find((e) => e.manifest.id === manifest.id);
        files.push({
          type: "file", name: manifest.name, id: manifest.id,
          description: manifest.description, active: catalogEntry?.active || false,
          multiInstance: manifest.multiInstance || false,
        });
      } catch {
        // Non-MUP HTML file — expected, skip silently
      }
    }
  }
  folders.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  return [...folders, ...files];
}

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

// ---- Tool Description Builders ----

const text = (t: string) => ({ type: "text" as const, text: t });

function buildToolDescription(manager: MupManager, port: number): string {
  const catalog = manager.getCatalog();
  const active = catalog.filter((e) => e.active);
  const inactive = catalog.filter((e) => !e.active);
  const lines = [
    `MUP — Interactive UI panels in browser at http://localhost:${port}. Auto-activated on first use.`,
    ``, `Call: { "mupId": "...", "functionName": "...", "functionArgs": { ... } }`,
    `Actions: checkInteractions, save, load, workspaces, list, history`,
  ];
  if (active.length > 0) {
    lines.push(``, `Active MUPs:`);
    for (const e of active) lines.push(`  ${e.manifest.id} — ${e.manifest.name}. Functions: ${e.manifest.functions.map((f) => f.name).join(", ")}`);
  }
  if (inactive.length > 0) {
    lines.push(``, `Available: ${inactive.map((e) => e.manifest.id).join(", ")}`);
  }
  return lines.join("\n");
}

function buildMupDetail(manifest: { name: string; id: string; description: string; functions: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> }): string {
  const lines = [`${manifest.name} (${manifest.id}): ${manifest.description}`];
  for (const fn of manifest.functions) {
    const props = (fn.inputSchema.properties || {}) as Record<string, Record<string, unknown>>;
    const required = (fn.inputSchema.required || []) as string[];
    const params = Object.entries(props).map(([k, v]) => `${k}${required.includes(k) ? "" : "?"}: ${v.type || "any"}`);
    lines.push(`  - ${fn.name}(${params.join(", ")}) — ${fn.description}`);
  }
  return lines.join("\n");
}

// ---- MCP Action Handlers ----

function handleWorkspaces(ws: WorkspaceManager) {
  const workspaces = ws.list();
  if (workspaces.length === 0) return { content: [text('No saved workspaces. Use { "action": "save", "name": "..." } to save.')] };
  const lines = workspaces.map((w) => {
    const time = new Date(w.savedAt).toLocaleString();
    const desc = w.description ? ` — ${w.description}` : "";
    return `- ${w.displayName}${desc} (saved ${time}, MUPs: ${w.activeMups.join(", ")})`;
  });
  return { content: [text("Saved workspaces:\n" + lines.join("\n"))] };
}

function handleSave(ws: WorkspaceManager, manager: MupManager, args: Record<string, unknown>) {
  const name = args.name as string;
  if (!name) return { content: [text('Provide "name" for the workspace.')], isError: true };
  const desc = args.description as string | undefined;
  ws.save(name, desc);
  const active = manager.getAll().map((m) => ws.customNames[m.manifest.id] || m.manifest.name);
  return { content: [text(`Workspace "${name}" saved.${desc ? ` Description: ${desc}` : ""}\nActive MUPs: ${active.join(", ") || "none"}.`)] };
}

function handleLoad(ws: WorkspaceManager, manager: MupManager, bridge: UiBridge, sendLoadMup: SendLoadMupFn, args: Record<string, unknown>) {
  const name = args.name as string;
  if (!name) return { content: [text('Provide "name" of the workspace to load.')], isError: true };
  if (!ws.load(name)) return { content: [text(`Workspace "${name}" not found.`)], isError: true };
  const restored = ws.restore(bridge, sendLoadMup, name);
  const desc = ws.description ? `\nDescription: ${ws.description}` : "";
  return { content: [text(`Workspace "${name}" loaded.${desc}\nActive MUPs: ${restored.join(", ") || "none"}.`)] };
}

function handleList(manager: MupManager) {
  const sections = manager.getCatalog().map((e) => `${e.active ? "[ACTIVE]" : "[available]"} ${buildMupDetail(e.manifest)}`);
  return { content: [text(sections.join("\n\n"))] };
}

function handleCheckInteractions(manager: MupManager, args: Record<string, unknown>) {
  const since = typeof args.since === "number" ? args.since : undefined;
  const events = manager.drainEvents(since);
  const states = manager.getAll().filter((m) => m.stateSummary).map((m) => `[${m.manifest.name}] ${m.stateSummary}`);
  const parts: string[] = [];

  if (events.length > 0) {
    const groups = new Map<string, { mupName: string; action: string; count: number; lastSummary: string }>();
    for (const e of events) {
      const key = `${e.mupName}|${e.action}`;
      const g = groups.get(key);
      if (g) { g.count++; g.lastSummary = e.summary; }
      else groups.set(key, { mupName: e.mupName, action: e.action, count: 1, lastSummary: e.summary });
    }
    const lines = Array.from(groups.values()).map((g) =>
      g.count === 1 ? `  [${g.mupName}] ${g.action}: ${g.lastSummary}` : `  [${g.mupName}] ${g.action} (${g.count}x, latest: ${g.lastSummary})`
    );
    parts.push("User interactions:\n" + lines.join("\n"));
  }
  if (states.length > 0) parts.push("Current states:\n" + states.map((s) => `  ${s}`).join("\n"));
  return { content: [text(parts.length > 0 ? parts.join("\n\n") : "No interactions or state changes.")] };
}

function handleHistory(ws: WorkspaceManager, manager: MupManager, args: Record<string, unknown>) {
  const mupId = args.mupId as string;

  function formatHistory(history: CallHistoryEntry[], limit: number): string[] {
    const lines: string[] = [];
    if (history.length > limit) {
      const older = history.slice(0, -limit);
      const fnCounts = new Map<string, number>();
      for (const h of older) fnCounts.set(h.functionName, (fnCounts.get(h.functionName) || 0) + 1);
      lines.push(`  ... ${older.length} earlier calls: ${Array.from(fnCounts.entries()).map(([fn, c]) => `${fn}(${c}x)`).join(", ")}`);
    }
    for (const h of history.slice(-limit)) {
      const time = new Date(h.timestamp).toLocaleTimeString();
      const argStr = JSON.stringify(h.args);
      lines.push(`  [${time}] ${h.functionName}(${argStr.length > 80 ? argStr.slice(0, 80) + "..." : argStr}) → ${h.result}`);
    }
    return lines;
  }

  if (!mupId) {
    const parts: string[] = [];
    for (const mup of manager.getAll()) {
      const history = ws.callHistory[mup.manifest.id];
      if (history && history.length > 0) {
        parts.push(`## ${mup.manifest.name} (${mup.manifest.id})`);
        if (mup.stateSummary) parts.push(`State: ${mup.stateSummary}`);
        parts.push(`${history.length} calls:`, ...formatHistory(history, CONFIG.recentHistoryCount));
      }
    }
    return { content: [text(parts.length > 0 ? parts.join("\n") : "No call history yet.")] };
  }

  const history = ws.callHistory[mupId];
  const mup = manager.get(mupId);
  const parts: string[] = [];
  if (mup?.stateSummary) parts.push(`State: ${mup.stateSummary}`);
  if (!history || history.length === 0) parts.push("No call history for this MUP.");
  else { parts.push(`${history.length} calls:`, ...formatHistory(history, CONFIG.recentHistoryCount)); }
  return { content: [text(parts.join("\n"))] };
}

// ---- CLI Argument Parsing ----

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
      console.error(`\nmup-mcp-server — MCP server with interactive MUP UI panels\n\nUsage:\n  mup-mcp-server [options] [file1.html ...]\n\nOptions:\n  --mups-dir <dir>     Load all .html MUP files from a directory\n  --port <port>        UI panel port (default: ${CONFIG.defaultPort})\n  --no-open            Don't auto-open the browser\n  -h, --help           Show this help\n`);
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
    if (Object.keys(ws.customNames).length > 0 || ws.gridLayout.length > 0) {
      bridge.sendRaw({
        type: "workspace-loaded", name: "",
        customNames: { ...ws.customNames },
        gridLayout: ws.gridLayout.length > 0 ? ws.gridLayout : undefined,
        description: ws.description,
      });
    }
  });

  bridge.typedOn("activate-mup", (mupId) => {
    const mup = manager.activate(mupId);
    if (mup) { sendLoadMup(mupId, mup); ws.markDirty(); console.error(`[mup-mcp] Activated: ${mup.manifest.name}`); }
  });

  bridge.typedOn("deactivate-mup", (mupId) => {
    manager.deactivate(mupId); ws.markDirty(); console.error(`[mup-mcp] Deactivated: ${mupId}`);
  });

  bridge.typedOn("new-instance", (baseMupId, customName) => {
    const mup = manager.activateInstance(baseMupId);
    if (mup) {
      if (customName) { mup.manifest.name = customName; ws.customNames[mup.manifest.id] = customName; }
      sendLoadMup(mup.manifest.id, mup); ws.markDirty();
      console.error(`[mup-mcp] New instance: ${mup.manifest.name} (${mup.manifest.id})`);
    }
  });

  bridge.typedOn("register-and-activate", (mupId, html, fileName) => {
    try {
      const manifest = manager.parseManifest(html, fileName);
      manifest.id = mupId;
      if (!manager.getCatalog().find((e) => e.manifest.id === mupId)) manager.loadFromHtml(html, fileName);
      else manager.activate(mupId);
      const mup = manager.get(mupId);
      if (mup) { sendLoadMup(mupId, mup); ws.markDirty(); console.error(`[mup-mcp] Registered + activated: ${manifest.name}`); }
    } catch (err: unknown) { console.error(`[mup-mcp] Failed to register: ${(err as Error).message}`); }
  });

  bridge.typedOn("state-update", () => ws.markDirty());
  bridge.typedOn("save-grid-layout", (layout) => { if (Array.isArray(layout)) { ws.gridLayout = layout; ws.markDirty(); } });
  bridge.typedOn("rename-mup", (mupId, newName) => { if (mupId && newName) { ws.customNames[mupId] = newName; ws.markDirty(); console.error(`[mup-mcp] Renamed: ${mupId} → ${newName}`); } });
  bridge.typedOn("browser-disconnected", () => { ws.flushSave(); console.error("[mup-mcp] Saved on disconnect"); });
}

// ---- Workspace Browser Events ----

function setupWorkspaceEvents(bridge: UiBridge, manager: MupManager, ws: WorkspaceManager, sendLoadMup: SendLoadMupFn): void {
  bridge.typedOn("list-workspaces", () => bridge.sendRaw({ type: "workspace-list", workspaces: ws.list() }));

  bridge.typedOn("save-workspace", (name, desc) => {
    ws.save(name, desc);
    bridge.sendRaw({ type: "workspace-saved", name });
    bridge.sendRaw({ type: "workspace-list", workspaces: ws.list() });
  });

  bridge.typedOn("load-workspace", (name) => ws.restore(bridge, sendLoadMup, name));

  bridge.typedOn("delete-workspace", (name, isCurrent) => {
    ws.delete(name);
    if (isCurrent) {
      for (const mup of manager.getAll()) manager.deactivate(mup.manifest.id);
      ws.reset();
      bridge.sendRaw({ type: "workspace-cleared" });
      bridge.sendRaw({ type: "mup-catalog", catalog: bridge.buildCatalogSummary() });
    }
    bridge.sendRaw({ type: "workspace-list", workspaces: ws.list() });
  });
}

// ---- Hot-Reload File Watching ----

function setupFileWatching(
  mupsDirs: string[],
  manager: MupManager,
  bridge: UiBridge,
  sendLoadMup: SendLoadMupFn,
  rebuildFolderTree: () => void
): void {
  for (const dir of mupsDirs) {
    try {
      fs.watch(dir, { recursive: true }, (_, filename) => {
        if (!filename || !filename.endsWith(".html")) return;
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
  manager: MupManager,
  bridge: UiBridge,
  ws: WorkspaceManager,
  port: number,
  sendLoadMup: SendLoadMupFn,
  ensureActive: (mupId: string) => { error?: string; activated?: string }
): Server {
  const server = new Server({ name: "mup-mcp-server", version: "0.2.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{
      name: "mup",
      description: buildToolDescription(manager, port),
      inputSchema: {
        type: "object" as const,
        properties: {
          action: { type: "string", description: '"checkInteractions" to check user UI activity, "list" to list MUPs. Omit when calling a function.' },
          mupId: { type: "string", description: "MUP ID (e.g. mup-chess, mup-chart). Auto-activated on first use." },
          functionName: { type: "string", description: "Function to call (e.g. makeMove, renderChart, setPixels)" },
          functionArgs: { type: "object", description: "Arguments for the function. Can be a JSON object or JSON string." },
          name: { type: "string", description: "Workspace name for save/load/deleteWorkspace actions." },
          description: { type: "string", description: "Workspace description — what you're working on. Used with save action." },
          since: { type: "number", description: "Unix timestamp (ms). Only return interactions after this time. Used with checkInteractions." },
        },
      },
    }],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = (request.params.arguments || {}) as Record<string, unknown>;

    // Dispatch by action
    if (args.action === "workspaces") return handleWorkspaces(ws);
    if (args.action === "save") return handleSave(ws, manager, args);
    if (args.action === "load") return handleLoad(ws, manager, bridge, sendLoadMup, args);
    if (args.action === "deleteWorkspace") {
      const name = args.name as string;
      if (!name) return { content: [text('Provide "name".')], isError: true };
      return { content: [text(ws.delete(name) ? `Workspace "${name}" deleted.` : `Workspace "${name}" not found.`)] };
    }
    if (args.action === "list") return handleList(manager);
    if (args.action === "checkInteractions") return handleCheckInteractions(manager, args);
    if (args.action === "history") return handleHistory(ws, manager, args);

    // --- Call MUP function ---
    const mupId = args.mupId as string;
    const fn = args.functionName as string;
    if (!mupId || !fn) return { content: [text('Provide "mupId" and "functionName", or use "action": "list" / "checkInteractions" / "history".')], isError: true };

    const activation = ensureActive(mupId);
    if (activation.error) return { content: [text(activation.error)], isError: true };

    const fnArgs = parseArgs(args.functionArgs);
    if (!manager.get(mupId)?.stateSummary && manager.isActive(mupId)) await new Promise((r) => setTimeout(r, CONFIG.mupInitWaitMs));

    const result = await bridge.callFunction(mupId, fn, fnArgs);
    const resultText = result.content.map((c) => c.text || "").join(" ").trim();
    ws.addCallHistory(mupId, fn, fnArgs, resultText);

    const content: Array<{ type: "text"; text: string }> = [];
    if (activation.activated) content.push(text(`[Auto-activated] ${activation.activated}`));

    for (const c of result.content) {
      let t = c.text || JSON.stringify(c.data || "");
      if (t.length > CONFIG.maxResponseLength) t = t.slice(0, CONFIG.maxResponseLength) + `\n... (truncated, ${t.length} chars total)`;
      content.push({ type: "text" as const, text: t });
    }

    // Append "discuss" interactions (user explicitly wants LLM attention)
    const events = manager.drainEvents();
    const discuss = events.filter((e) => e.action === "discuss");
    for (const e of events.filter((e) => e.action !== "discuss")) manager.addEvent(e.mupId, e.action, e.summary, e.data);
    if (discuss.length > 0) {
      content.push(text(`\n--- User wants your attention ---\n${discuss.map((e) => `[${e.mupName}] ${e.summary}`).join("\n")}`));
    }

    ws.markDirty();
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

  // --- Manager & Workspace ---
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

  const ws = new WorkspaceManager(manager);
  ws.setBridge(bridge);

  // --- Auto-restore last session ---
  const restored = ws.silentRestore();
  if (restored.length > 0) console.error(`[mup-mcp] Restored last session: ${restored.join(", ")}`);

  // --- Helpers ---
  const sendLoadMup: SendLoadMupFn = (mupId, mup) => {
    bridge.sendRaw({ type: "load-mup", mupId: mup.manifest.id, html: mup.html, manifest: mup.manifest, savedState: mup.stateData });
  };

  function ensureActive(mupId: string): { error?: string; activated?: string } {
    if (manager.isActive(mupId)) return {};
    const mup = manager.activate(mupId);
    if (!mup) return { error: `MUP "${mupId}" not found. Use { "action": "list" } to see available MUPs.` };
    sendLoadMup(mupId, mup);
    ws.markDirty();
    console.error(`[mup-mcp] Auto-activated: ${mup.manifest.name}`);
    return { activated: buildMupDetail(mup.manifest) };
  }

  function rebuildFolderTree(): void {
    serverFolderTree = [];
    for (const dir of mupsDirs) serverFolderTree.push(...buildFolderTree(dir, manager));
    bridge.folderTree = serverFolderTree;
    bridge.sendRaw({ type: "folder-tree", tree: serverFolderTree, path: bridge.folderPath });
  }

  // --- Wire up events ---
  setupBrowserEvents(bridge, manager, ws, sendLoadMup);
  setupWorkspaceEvents(bridge, manager, ws, sendLoadMup);
  setupFileWatching(mupsDirs, manager, bridge, sendLoadMup, rebuildFolderTree);
  setupLifecycle(ws);

  // --- MCP Server ---
  const server = setupMcpServer(manager, bridge, ws, port, sendLoadMup, ensureActive);

  // --- Browser auto-open ---
  if (!noOpen) {
    const openTimer = setTimeout(() => { if (!bridge.isConnected()) openBrowser(`http://localhost:${port}`); }, CONFIG.browserOpenDelayMs);
    bridge.typedOnce("browser-connected", () => clearTimeout(openTimer));
  }

  // --- Start ---
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[mup-mcp] MCP server running (stdio). UI panel on port ${port}. ${manager.getCatalog().length} MUPs loaded.`);
}

main().catch((err) => { console.error("[mup-mcp] Fatal:", err); process.exit(1); });
