#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";
import * as net from "node:net";
import { exec } from "node:child_process";
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
      if (!fs.existsSync(dir)) { console.error(`[mup-mcp] Directory not found (skipped): ${dir}`); continue; }
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

  // State updates only update summary in manager (no persistence)
  bridge.typedOn("save-grid-layout", (layout) => { if (Array.isArray(layout)) { ws.gridLayout = layout; ws.markMetadataDirty(); } });
  bridge.typedOn("rename-mup", (mupId, newName) => { if (mupId && newName) { ws.customNames[mupId] = newName; ws.markMetadataDirty(); console.error(`[mup-mcp] Renamed: ${mupId} → ${newName}`); } });
  bridge.typedOn("browser-disconnected", () => { ws.flushSave(); console.error("[mup-mcp] Saved on disconnect"); });
  bridge.typedOn("flush-save", () => { ws.flushSave(); bridge.sendRaw({ type: "auto-saved" }); });
  bridge.typedOn("rename-workspace", (name) => { ws.name = name; ws.markMetadataDirty(); });
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

// Track the mupId currently being called by the LLM (to suppress self-notifications)
let activeCallMupId: string | null = null;

function setupMcpServer(
  manager: MupManager, bridge: UiBridge, ws: WorkspaceManager,
  port: number, sendLoadMup: SendLoadMupFn,
  ensureActive: (mupId: string) => { error?: string; activated?: string },
  pipeline: PipelineManager
): Server {
  const server = new Server(
    { name: "mup", version: "0.2.0" },
    {
      capabilities: {
        tools: {},
        experimental: { "claude/channel": {} },
      },
      instructions: `MUP channel events arrive as <channel source="mup" mup_id="..." mup_name="...">. These are real-time user interactions from MUP UI panels in the browser. Respond by calling the mup tool with the mupId and the appropriate function. Use { "action": "setNotificationLevel", "mupId": "...", "level": "immediate" | "notify" | "silent" } to adjust how a MUP notifies you.`,
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{
      name: "mup",
      description: buildToolDescription(manager, port),
      inputSchema: {
        type: "object" as const,
        properties: {
          action: { type: "string", description: '"checkInteractions" to check user UI activity, "list" to list MUPs, "new-instance" to open another instance of a [multi] MUP, "pipe" to manage data pipes, "setNotificationLevel" to change a MUP\'s notification level. Omit when calling a function.' },
          level: { type: "string", description: 'For setNotificationLevel: "immediate" (channel push), "notify" (queued for checkInteractions), or "silent" (no events).' },
          mupId: { type: "string", description: "MUP ID (e.g. mup-chess, mup-chart). Auto-activated on first use." },
          functionName: { type: "string", description: "Function to call (e.g. makeMove, renderChart, setPixels)" },
          functionArgs: { type: "object", description: "Arguments for the function. Can be a JSON object or JSON string." },
          since: { type: "number", description: "Unix timestamp (ms). Only return interactions after this time. Used with checkInteractions." },
          subAction: { type: "string", description: 'For pipe action: "create", "list", "delete", "enable", "disable"' },
          pipeId: { type: "string", description: "Pipe ID for delete/enable/disable." },
          sourceMupId: { type: "string", description: "Pipe source MUP ID." },
          sourceFunction: { type: "string", description: "Optional: call this function on source to get data." },
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
    // Track which MUP is being called to suppress self-notifications
    activeCallMupId = (args.mupId as string) || null;
    try {
      return await handleToolCall(request, manager, bridge, ws, port, sendLoadMup, ensureActive, pipeline);
    } finally {
      activeCallMupId = null;
    }
  });

  return server;
}

async function handleToolCall(
  request: { params: { arguments?: Record<string, unknown> } },
  manager: MupManager, bridge: UiBridge, ws: WorkspaceManager,
  port: number, sendLoadMup: SendLoadMupFn,
  ensureActive: (mupId: string) => { error?: string; activated?: string },
  pipeline: PipelineManager
) {
    const args = (request.params.arguments || {}) as Record<string, unknown>;

    // Dispatch by action
    if (args.action === "list") return handleList(manager);
    if (args.action === "checkInteractions") return handleCheckInteractions(manager, args);
    if (args.action === "history") return handleHistory(ws, manager, args);
    if (args.action === "pipe") return handlePipe(pipeline, args);
    if (args.action === "setNotificationLevel") {
      const mupId = args.mupId as string;
      const level = args.level as string;
      if (!mupId || !level) return { content: [text('Provide "mupId" and "level" ("immediate", "notify", or "silent").')], isError: true };
      if (!["immediate", "notify", "silent"].includes(level)) return { content: [text(`Invalid level "${level}". Use "immediate", "notify", or "silent".`)], isError: true };
      const error = manager.setNotificationLevel(mupId, level as "immediate" | "notify" | "silent");
      if (error) return { content: [text(error)], isError: true };
      const mup = manager.get(mupId);
      return { content: [text(`Notification level for "${mup?.manifest.name}" set to "${level}".`)] };
    }
    if (args.action === "new-instance") {
      const baseMupId = args.mupId as string;
      if (!baseMupId) return { content: [text('Provide "mupId" for the base MUP to create an instance of.')], isError: true };
      ensureActive(baseMupId);
      const mup = manager.activateInstance(baseMupId);
      if (!mup) return { content: [text(`Cannot create instance: "${baseMupId}" not found or does not support multi-instance.`)], isError: true };
      sendLoadMup(mup.manifest.id, mup);
      ws.markMetadataDirty();
      console.error(`[mup-mcp] New instance: ${mup.manifest.name} (${mup.manifest.id})`);
      return { content: [text(`Created ${mup.manifest.id}\n${buildMupDetail(mup.manifest)}`)] };
    }
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

    const content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> = [];
    if (activation.activated) content.push(text(`[Auto-activated] ${activation.activated}`));

    for (const c of result.content) {
      if (c.type === "image" && c.data && c.mimeType) {
        content.push({ type: "image", data: c.data as string, mimeType: c.mimeType as string });
      } else if (c.data !== undefined && c.type !== "image") {
        const json = JSON.stringify(c.data);
        if (json.length > CONFIG.maxDataResponseLength) {
          content.push({ type: "text", text: `[data truncated, ${json.length} chars. Use specific queries instead of full data dumps.]` });
        } else {
          content.push({ type: "text", text: json });
        }
      } else {
        let t = c.text || "";
        if (t.length > CONFIG.maxResponseLength) t = t.slice(0, CONFIG.maxResponseLength) + `\n... (truncated, ${t.length} chars total)`;
        content.push({ type: "text", text: t });
      }
    }

    ws.markMetadataDirty();
    return { content, isError: result.isError };
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

  // Fallback: try saved mupsPath from workspace.json
  const workspaceRoot = path.resolve(process.cwd());
  if (mupFiles.length === 0 && mupsDirs.length === 0) {
    const savedPath = WorkspaceManager.getSavedMupsPath(workspaceRoot);
    if (savedPath && fs.existsSync(savedPath)) {
      mupFiles.push(...scanHtmlFiles(savedPath));
      mupsDirs.push(savedPath);
      console.error(`[mup-mcp] Restored MUP source: ${savedPath}`);
    } else {
      console.error(`[mup-mcp] No MUP source configured. Use the browser panel to select a folder.`);
    }
  }

  // --- Manager ---
  const manager = new MupManager();

  // Register built-in system MUPs
  manager.registerSystemMup({
    protocol: "mup/2026-03-17",
    id: "mup-chat",
    name: "Chat",
    version: "1.0.0",
    description: "Chat with the LLM. User types messages, LLM responds via sendMessage. Supports markdown rendering in assistant messages.",
    functions: [
      { name: "sendMessage", description: "Send a message to display in the chat as the assistant. Supports markdown formatting.", inputSchema: { type: "object", properties: { text: { type: "string", description: "Message text to display (supports markdown)" } }, required: ["text"] } },
      { name: "getHistory", description: "Get the full chat message history for the current session", inputSchema: { type: "object", properties: {} } },
      { name: "clearHistory", description: "Archive current messages and clear the chat", inputSchema: { type: "object", properties: {} } },
      { name: "resume", description: "Resume the most recent archived chat session, restoring its messages to the display", inputSchema: { type: "object", properties: {} } },
      { name: "listHistory", description: "List archived chat sessions with date, preview, and message count", inputSchema: { type: "object", properties: {} } },
      { name: "loadSession", description: "Load a specific archived chat session by its ID", inputSchema: { type: "object", properties: { id: { type: "string", description: "The session ID to load" } }, required: ["id"] } },
    ],
    notifications: { level: "immediate", overridable: false },
  });

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

  // --- Workspace (state at project root .mup/) ---
  const ws = new WorkspaceManager(manager, workspaceRoot);
  if (mupsDirs.length > 0) ws.mupsPath = mupsDirs[0];
  ws.setBridge(bridge);

  // --- Restore from .mup/ folder ---
  const restored = ws.restoreFromDisk();
  if (restored.length > 0) console.error(`[mup-mcp] Restored: ${restored.join(", ")}`);

  // --- Helpers ---
  const sendLoadMup: SendLoadMupFn = (mupId, mup) => {
    bridge.sendRaw({ type: "load-mup", mupId: mup.manifest.id, html: mup.html, manifest: mup.manifest });
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

  function switchMupsFolder(newPath: string): { ok: boolean; warnings: string[] } {
    const resolved = path.resolve(newPath);
    if (!fs.existsSync(resolved)) return { ok: false, warnings: [`Directory not found: ${resolved}`] };

    // Scan new folder
    const newFiles = scanHtmlFiles(resolved);
    const newIds = new Set<string>();
    for (const file of newFiles) {
      try { const m = manager.parseManifest(fs.readFileSync(file, "utf-8"), file); newIds.add(m.id); }
      catch { /* skip non-MUP HTML */ }
    }

    // Check active MUPs against new folder
    const warnings: string[] = [];
    const activeMups = manager.getAll();
    const unsupported = activeMups.filter((m) => !newIds.has(m.manifest.id) && !manager.isSystemMup(m.manifest.id));
    if (unsupported.length > 0) {
      warnings.push(
        `The following active MUPs are not available in the new folder: ${unsupported.map((m) => m.manifest.name).join(", ")}. ` +
        `Consider copying their .html files to ${resolved} to keep using them.`
      );
      for (const m of unsupported) {
        manager.deactivate(m.manifest.id);
        ws.onMupDeactivated(m.manifest.id);
        bridge.sendRaw({ type: "mup-deactivated", mupId: m.manifest.id });
        pipeline.onMupDeactivated(m.manifest.id);
      }
    }

    // Replace catalog with new folder
    manager.clearCatalog();
    for (const file of newFiles) {
      try { manager.scanFile(file); } catch { /* skip */ }
    }

    // Re-activate MUPs that exist in both old and new
    for (const m of activeMups) {
      if (newIds.has(m.manifest.id)) {
        const mup = manager.activate(m.manifest.id);
        if (mup) {
          sendLoadMup(m.manifest.id, mup);
        }
      }
    }

    // Update folder tree and paths
    mupsDirs.length = 0;
    mupsDirs.push(resolved);
    bridge.folderPath = resolved;
    rebuildFolderTree();

    // Re-bind file watcher for new directory
    setupFileWatching([resolved], manager, bridge, sendLoadMup, rebuildFolderTree);

    // Persist
    ws.setMupsPath(resolved);
    bridge.sendRaw({ type: "mup-catalog", catalog: bridge.buildCatalogSummary() });
    bridge.sendRaw({ type: "mups-path-changed", path: resolved });

    console.error(`[mup-mcp] Switched MUP source to: ${resolved}`);
    return { ok: true, warnings };
  }

  // --- Pipeline ---
  const pipeline = new PipelineManager(
    (mupId, fn, args) => bridge.callFunction(mupId, fn, args),
    (pipeId, sourceMupId, targetMupId, error) => {
      manager.addEvent(sourceMupId, "pipe-error", `Pipe ${pipeId} failed (\u2192 ${targetMupId}): ${error}`);
    },
  );
  bridge.typedOn("state-update", (mupId, _summary, data) => pipeline.onStateUpdate(mupId, data));
  bridge.typedOn("deactivate-mup", (mupId) => pipeline.onMupDeactivated(mupId));

  // --- Wire up events ---
  setupBrowserEvents(bridge, manager, ws, sendLoadMup);
  bridge.typedOn("set-mups-path", (newPath) => {
    const result = switchMupsFolder(newPath);
    if (!result.ok) bridge.sendRaw({ type: "mups-path-error", errors: result.warnings });
    else if (result.warnings.length > 0) bridge.sendRaw({ type: "mups-path-warnings", warnings: result.warnings });
  });
  setupFileWatching(mupsDirs, manager, bridge, sendLoadMup, rebuildFolderTree);
  setupLifecycle(ws);

  // --- MCP Server ---
  const server = setupMcpServer(manager, bridge, ws, port, sendLoadMup, ensureActive, pipeline);

  // --- Log client capabilities on init ---
  server.oninitialized = () => {
    const caps = server.getClientCapabilities();
    console.error(`[mup-mcp] Client capabilities: ${JSON.stringify(caps)}`);
  };

  // --- Notification routing based on manifest level ---
  const channelDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  bridge.typedOn("interaction", (mupId, action, summary, data) => {
    // Suppress notifications from the MUP currently being called by the LLM
    if (mupId === activeCallMupId) return;

    const level = manager.getNotificationLevel(mupId);
    if (level === "silent") return;

    if (level === "immediate") {
      // Debounce per-MUP to batch rapid interactions (500ms)
      const existing = channelDebounceTimers.get(mupId);
      if (existing) clearTimeout(existing);

      channelDebounceTimers.set(mupId, setTimeout(() => {
        channelDebounceTimers.delete(mupId);
        const mupName = manager.get(mupId)?.manifest.name ?? mupId;

        server.notification({
          method: "notifications/claude/channel",
          params: {
            content: summary,
            meta: { mup_id: mupId, mup_name: mupName, action },
          },
        }).catch((err) => {
          console.error(`[mup-mcp] Channel notification failed: ${(err as Error).message}`);
        });
      }, 500));
    }
    // level === "notify": already queued via manager.addEvent in bridge.ts
  });

  // --- Browser auto-open ---
  if (!noOpen) {
    const openTimer = setTimeout(() => { if (!bridge.isConnected()) openBrowser(`http://localhost:${port}`); }, CONFIG.browserOpenDelayMs);
    bridge.typedOnce("browser-connected", () => clearTimeout(openTimer));
  }

  // --- Start ---
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[mup-mcp] MCP server running (stdio). UI panel on port ${port}. ${manager.getCatalog().length} MUPs loaded. Workspace: ${workspaceRoot}`);
}

main().catch((err) => { console.error("[mup-mcp] Fatal:", err); process.exit(1); });
