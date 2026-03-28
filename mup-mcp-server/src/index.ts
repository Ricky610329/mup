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
import { Scheduler } from "./scheduler.js";
import { CONFIG } from "./config.js";
import { scanHtmlFiles, buildFolderTree } from "./scanner.js";
import { buildToolDescription, buildMupDetail, handleToolCall } from "./handlers.js";
import type { FolderTreeNode, SendLoadMupFn } from "./types.js";

// ---- Utilities ----

function openBrowser(url: string): void {
  const cmd = process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
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
  // Send restored workspace state after browser grid is ready (not on connect)
  bridge.typedOn("browser-ready", () => {
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
  sendLoadMup: SendLoadMupFn, rebuildFolderTree: () => void,
  ws: WorkspaceManager, pipeline: PipelineManager
): void {
  for (const dir of mupsDirs) {
    try {
      fs.watch(dir, { recursive: true }, (_, filename) => {
        if (!filename) return;
        const ext = path.extname(filename).toLowerCase();
        if (![".html", ".js", ".css"].includes(ext)) return;
        // Ignore files inside .mup/ directory
        if (filename.startsWith(".mup")) return;
        const filePath = path.join(dir, filename);

        // For .js/.css changes, find the owning directory MUP's index.html
        let targetPath = filePath;
        if (ext !== ".html") {
          const dirIndex = path.join(path.dirname(filePath), "index.html");
          if (fs.existsSync(dirIndex)) {
            targetPath = dirIndex;
          } else {
            // Check parent directory (for files in subdirectories of a MUP)
            const parentIndex = path.join(path.dirname(path.dirname(filePath)), "index.html");
            if (fs.existsSync(parentIndex)) {
              targetPath = parentIndex;
            } else {
              return; // Not part of a directory MUP
            }
          }
        }

        if (!fs.existsSync(targetPath)) {
          const entry = manager.findByFilePath(targetPath);
          if (!entry) return;
          const mupId = entry.manifest.id;
          for (const m of manager.getAll()) {
            if (m.manifest.id === mupId || m.manifest.id.startsWith(mupId + "_")) {
              manager.deactivate(m.manifest.id);
              bridge.sendRaw({ type: "mup-deactivated", mupId: m.manifest.id });
              ws.onMupDeactivated(m.manifest.id);
              pipeline.onMupDeactivated(m.manifest.id);
            }
          }
          manager.removeCatalogEntry(mupId);
          bridge.sendRaw({ type: "mup-catalog", catalog: bridge.buildCatalogSummary() });
          rebuildFolderTree();
          console.error(`[mup-mcp] Removed (file deleted): ${entry.manifest.name}`);
          return;
        }
        try {
          const html = manager.resolveHtml(targetPath);
          const manifest = manager.parseManifest(html, targetPath);
          const entry = manager.getCatalog().find((e) => e.manifest.id === manifest.id);
          if (entry) { entry.html = html; entry.manifest = manifest; }
          else { manager.scanFile(targetPath); rebuildFolderTree(); console.error(`[mup-mcp] Discovered: ${manifest.name}`); }
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

// ---- Folder Switching ----

interface FolderSwitchDeps {
  mupsDirs: string[];  // mutated in-place (shared reference with main)
  manager: MupManager;
  bridge: UiBridge;
  ws: WorkspaceManager;
  pipeline: PipelineManager;
  sendLoadMup: SendLoadMupFn;
  rebuildFolderTree: () => void;
}

let _lastFolderSwitch = 0;

function switchMupsFolder(newPath: string, deps: FolderSwitchDeps): { ok: boolean; warnings: string[] } {
  const { mupsDirs, manager, bridge, ws, pipeline, sendLoadMup, rebuildFolderTree } = deps;
  const now = Date.now();
  if (now - _lastFolderSwitch < 1000) return { ok: false, warnings: ["Folder switch rate limited (1s cooldown)."] };
  _lastFolderSwitch = now;
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
  setupFileWatching([resolved], manager, bridge, sendLoadMup, rebuildFolderTree, ws, pipeline);

  // Persist
  ws.setMupsPath(resolved);
  bridge.sendRaw({ type: "mup-catalog", catalog: bridge.buildCatalogSummary() });
  bridge.sendRaw({ type: "mups-path-changed", path: resolved });

  console.error(`[mup-mcp] Switched MUP source to: ${resolved}`);
  return { ok: true, warnings };
}

// ---- MCP Server Setup ----

// Track the mupId currently being called by the LLM (to suppress self-notifications)
let activeCallMupId: string | null = null;

function setupMcpServer(
  manager: MupManager, bridge: UiBridge, ws: WorkspaceManager,
  port: number, sendLoadMup: SendLoadMupFn,
  ensureActive: (mupId: string) => { error?: string; activated?: string },
  pipeline: PipelineManager,
  scheduler: Scheduler,
): Server {
  const server = new Server(
    { name: "mup", version: "0.2.0" },
    {
      capabilities: {
        tools: {},
        experimental: { "claude/channel": {}, "claude/channel/permission": {} },
      },
      instructions: [
          `MUP channel events arrive as <channel source="mup" mup_id="..." mup_name="..." action="...">. These are real-time user interactions from MUP UI panels in the browser.`,
          ``,
          `## Conversation Mode — CRITICAL`,
          `When you receive a channel event, you MUST reply through the originating MUP:`,
          `- Voice (mup-voice, action="speech"): ALWAYS call mup tool with mupId="mup-voice", functionName="speak" to reply verbally.`,
          `- Chat (mup-chat, action="message"): ALWAYS call mup tool with mupId="mup-chat", functionName="sendMessage" to reply in chat.`,
          `- NEVER respond with plain text only. Route ALL responses through the MUP that sent the event.`,
          `- Keep voice replies concise and conversational. Chat replies can be longer with markdown.`,
          ``,
          `## Non-blocking Task Execution`,
          `When the user requests a task (coding, research, file changes, etc.):`,
          `1. IMMEDIATELY acknowledge via speak() or sendMessage() — e.g. "I'm on it, working in the background."`,
          `2. Delegate the actual work to a background agent (Agent tool with run_in_background=true).`,
          `3. When the background agent completes, notify the user via speak() or sendMessage() with the result.`,
          `This keeps the conversation responsive — the user can keep talking while work happens in parallel.`,
          ``,
          `## Other Tools`,
          `- Use { "action": "checkInteractions" } to poll for recent user interactions from MUP panels.`,
          `- Use { "action": "setNotificationLevel", "mupId": "...", "level": "immediate" | "notify" | "silent" } to adjust notifications.`,
          `- MUP panels provide richer visual presentation — prefer them over plain text responses.`,
        ].join("\n"),
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{
      name: "mup",
      description: buildToolDescription(manager, port),
      inputSchema: {
        type: "object" as const,
        properties: {
          action: { type: "string", description: '"checkInteractions" to check user UI activity, "list" to list MUPs, "new-instance" to open another instance of a [multi] MUP, "pipe" to manage data pipes, "setNotificationLevel" to change a MUP\'s notification level, "delayCall" to schedule a delayed function call, "cancelDelay" to cancel a pending delay, "onEvent" to register an event listener, "removeEvent" to remove a listener. Omit when calling a function.' },
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
          delayMs: { type: "number", description: "For delayCall: delay in milliseconds (max 300000)." },
          scheduleId: { type: "string", description: "For cancelDelay: the scheduleId returned by delayCall." },
          event: { type: "string", description: 'For onEvent: event name to listen for (e.g. "playback-end").' },
          calls: { type: "array", description: "For onEvent/delayCall: array of {mupId, functionName, functionArgs, delayMs?} to execute. delayMs on each call = delay relative to trigger time." },
          once: { type: "boolean", description: "For onEvent: if true (default), listener fires once then auto-removes." },
          filter: { type: "object", description: 'For onEvent: match event data fields (e.g. {"index": 2}). Only fires when all fields match.' },
          listenerId: { type: "string", description: "For removeEvent: the listenerId returned by onEvent." },
        },
      },
    }],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = (request.params.arguments || {}) as Record<string, unknown>;
    const mupId = (args.mupId as string) || null;
    // Track which MUP is being called to suppress self-notifications
    activeCallMupId = mupId;
    try {
      return await handleToolCall(request, { manager, bridge, ws, sendLoadMup, ensureActive, pipeline, scheduler });
    } finally {
      // Clear thinking indicator when Claude responds to chat
      if (mupId === "mup-chat") {
        bridge.sendRaw({ type: "thinking", active: false });
      }
      activeCallMupId = null;
    }
  });

  // --- Permission relay: forward permission prompts to browser, send verdicts back ---
  server.fallbackNotificationHandler = async (notification: { method: string; params?: Record<string, unknown> }) => {
    if (notification.method === "notifications/claude/channel/permission_request") {
      const p = notification.params || {};
      bridge.sendRaw({
        type: "permission-request",
        requestId: p.request_id as string,
        toolName: p.tool_name as string,
        description: p.description as string,
        inputPreview: p.input_preview as string,
      });
      console.error(`[mup-mcp] Permission request: ${p.tool_name} (${p.request_id})`);
    }
  };

  bridge.typedOn("permission-verdict", (requestId, behavior) => {
    server.notification({
      method: "notifications/claude/channel/permission",
      params: { request_id: requestId, behavior },
    }).catch((err) => {
      console.error(`[mup-mcp] Permission verdict failed: ${(err as Error).message}`);
    });
    console.error(`[mup-mcp] Permission verdict: ${requestId} → ${behavior}`);
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
  // NOTE: Chat functions are implemented in ui/chat.js (handleChatFunctionCall).
  // If you add/remove functions here, update the implementation there too.
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

  // --- Workspace: restore BEFORE bridge starts (avoid race with reconnecting browsers) ---
  const ws = new WorkspaceManager(manager, workspaceRoot);
  if (mupsDirs.length > 0) ws.mupsPath = mupsDirs[0];
  const restored = ws.restoreFromDisk();
  if (restored.length > 0) console.error(`[mup-mcp] Restored: ${restored.join(", ")}`);

  const bridge = new UiBridge(manager, port);
  bridge.folderTree = serverFolderTree;
  bridge.folderPath = mupsDirs.length > 0 ? mupsDirs[0] : "";
  await bridge.start();
  ws.setBridge(bridge);

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

  // --- Pipeline ---
  const pipeline = new PipelineManager(
    (mupId, fn, args) => bridge.callFunction(mupId, fn, args),
    (pipeId, sourceMupId, targetMupId, error) => {
      manager.addEvent(sourceMupId, "pipe-error", `Pipe ${pipeId} failed (\u2192 ${targetMupId}): ${error}`);
    },
  );
  bridge.typedOn("state-update", (mupId, _summary, data) => pipeline.onStateUpdate(mupId, data));
  bridge.typedOn("deactivate-mup", (mupId) => pipeline.onMupDeactivated(mupId));

  // --- Scheduler ---
  const scheduler = new Scheduler(
    (mupId, fn, args) => bridge.callFunction(mupId, fn, args),
  );
  bridge.typedOn("mup-event", (mupId, event, data) => scheduler.onMupEvent(mupId, event, data));
  bridge.typedOn("browser-disconnected", () => scheduler.clearAll());

  // --- Wire up events ---
  setupBrowserEvents(bridge, manager, ws, sendLoadMup);
  bridge.typedOn("set-mups-path", (newPath) => {
    const result = switchMupsFolder(newPath, { mupsDirs, manager, bridge, ws, pipeline, sendLoadMup, rebuildFolderTree });
    if (!result.ok) bridge.sendRaw({ type: "mups-path-error", errors: result.warnings });
    else if (result.warnings.length > 0) bridge.sendRaw({ type: "mups-path-warnings", warnings: result.warnings });
  });
  setupFileWatching(mupsDirs, manager, bridge, sendLoadMup, rebuildFolderTree, ws, pipeline);
  setupLifecycle(ws);

  // --- MCP Server ---
  const server = setupMcpServer(manager, bridge, ws, port, sendLoadMup, ensureActive, pipeline, scheduler);

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

    // Signal thinking state to browser when chat message triggers a channel notification
    if (mupId === "mup-chat" && action === "message") {
      bridge.sendRaw({ type: "thinking", active: true });
    }

    const level = manager.getNotificationLevel(mupId);
    if (level === "silent") return;

    if (level === "immediate") {
      // Debounce per-MUP to batch rapid interactions (500ms)
      const existing = channelDebounceTimers.get(mupId);
      if (existing) clearTimeout(existing);

      channelDebounceTimers.set(mupId, setTimeout(() => {
        channelDebounceTimers.delete(mupId);
        const mup = manager.get(mupId);
        const mupName = mup?.manifest.name ?? mupId;

        // Build reply hint based on MUP type
        const replyFn = mupId === "mup-voice" ? "speak" : mupId === "mup-chat" ? "sendMessage" : null;
        const meta: Record<string, unknown> = { mup_id: mupId, mup_name: mupName, action };
        if (replyFn) {
          meta.replyHint = { mupId, function: replyFn };
        }

        server.notification({
          method: "notifications/claude/channel",
          params: { content: summary, meta },
        }).catch((err) => {
          console.error(`[mup-mcp] Channel notification failed: ${(err as Error).message}`);
        });
      }, CONFIG.channelDebounceMs));
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
