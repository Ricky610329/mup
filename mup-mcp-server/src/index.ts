#!/usr/bin/env node

import * as fs from "node:fs";
import * as path from "node:path";
import * as net from "node:net";
import * as os from "node:os";
import { exec } from "node:child_process";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { MupManager } from "./manager.js";
import { UiBridge } from "./bridge.js";

// ---- Helpers ----

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

interface FolderTreeNode {
  type: "folder" | "file";
  name: string;
  children?: FolderTreeNode[];
  id?: string;
  description?: string;
  active?: boolean;
  multiInstance?: boolean;
}

function buildFolderTree(dir: string, manager: MupManager): FolderTreeNode[] {
  const nodes: FolderTreeNode[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const folders: FolderTreeNode[] = [];
  const files: FolderTreeNode[] = [];

  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith(".")) {
      const children = buildFolderTree(path.join(dir, entry.name), manager);
      if (children.length > 0) {
        folders.push({ type: "folder", name: entry.name, children });
      }
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      const filePath = path.join(dir, entry.name);
      try {
        const manifest = manager.parseManifest(fs.readFileSync(filePath, "utf-8"), filePath);
        const catalogEntry = manager.getCatalog().find((e) => e.manifest.id === manifest.id);
        files.push({
          type: "file",
          name: manifest.name,
          id: manifest.id,
          description: manifest.description,
          active: catalogEntry?.active || false,
          multiInstance: manifest.multiInstance || false,
        });
      } catch {}
    }
  }
  folders.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  return [...folders, ...files];
}

function openBrowser(url: string): void {
  const cmd =
    process.platform === "win32"
      ? `start "" "${url}"`
      : process.platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return {}; }
  }
  if (typeof raw === "object") return raw as Record<string, unknown>;
  return {};
}

async function findAvailablePort(startPort: number): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    const available = await new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.once("listening", () => { server.close(); resolve(true); });
      server.listen(port);
    });
    if (available) return port;
  }
  return startPort; // fallback
}

// ---- Persistence & Workspaces ----

const DATA_DIR = path.join(os.homedir(), ".mup-mcp");
const WORKSPACES_DIR = path.join(DATA_DIR, "workspaces");
const LAST_WORKSPACE = "_last";

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

interface CallHistoryEntry {
  functionName: string;
  args: Record<string, unknown>;
  result: string;
  timestamp: number;
}

interface WorkspaceData {
  name: string;
  description: string;
  savedAt: number;
  activeMups: string[];
  mupStates: Record<string, unknown>;
  callHistory: Record<string, CallHistoryEntry[]>;
  customNames: Record<string, string>;
  gridLayout?: Array<{ id: string; x: number; y: number; w: number; h: number }>;
}

// In-memory call history
const callHistory: Record<string, CallHistoryEntry[]> = {};
const MAX_HISTORY = 30;

function addCallHistory(mupId: string, functionName: string, args: Record<string, unknown>, result: string): void {
  if (!callHistory[mupId]) callHistory[mupId] = [];
  callHistory[mupId].push({ functionName, args, result: result.slice(0, 200), timestamp: Date.now() });
  if (callHistory[mupId].length > MAX_HISTORY) callHistory[mupId].shift();
}

function workspacePath(name: string): string {
  return path.join(WORKSPACES_DIR, `${name.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
}

// In-memory workspace metadata
let currentDescription = "";
const customNames: Record<string, string> = {};
let currentGridLayout: Array<{ id: string; x: number; y: number; w: number; h: number }> = [];

function saveWorkspace(name: string, manager: MupManager, description?: string): void {
  try {
    ensureDir(WORKSPACES_DIR);
    if (description !== undefined) currentDescription = description;
    const data: WorkspaceData = {
      name,
      description: currentDescription,
      savedAt: Date.now(),
      activeMups: manager.getAll().map((m) => m.manifest.id),
      mupStates: manager.getStateSnapshot(),
      callHistory,
      customNames: { ...customNames },
      gridLayout: currentGridLayout.length > 0 ? currentGridLayout : undefined,
    };
    fs.writeFileSync(workspacePath(name), JSON.stringify(data, null, 2));
    console.error(`[mup-mcp] Workspace saved: ${name}`);
  } catch (err) {
    console.error("[mup-mcp] Failed to save workspace:", err);
  }
}

function loadWorkspaceData(name: string): WorkspaceData | null {
  try {
    const p = workspacePath(name);
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, "utf-8"));
    }
  } catch {}
  return null;
}

function listWorkspaces(): Array<{ name: string; displayName: string; description: string; savedAt: number; activeMups: string[] }> {
  try {
    ensureDir(WORKSPACES_DIR);
    const files = fs.readdirSync(WORKSPACES_DIR).filter((f) => f.endsWith(".json"));
    const all = files.map((f) => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(WORKSPACES_DIR, f), "utf-8")) as WorkspaceData;
        return {
          name: data.name,
          displayName: data.name === LAST_WORKSPACE ? "Last session" : data.name,
          description: data.description || "",
          savedAt: data.savedAt,
          activeMups: data.activeMups,
        };
      } catch {
        return null;
      }
    }).filter((x): x is NonNullable<typeof x> => x !== null);
    // _last first, then sorted by savedAt desc
    const last = all.filter((w) => w.name === LAST_WORKSPACE);
    const rest = all.filter((w) => w.name !== LAST_WORKSPACE).sort((a, b) => b.savedAt - a.savedAt);
    return [...last, ...rest];
  } catch {
    return [];
  }
}

function deleteWorkspace(name: string): boolean {
  try {
    const p = workspacePath(name);
    if (fs.existsSync(p)) { fs.unlinkSync(p); return true; }
  } catch {}
  return false;
}

/** Auto-save to _last workspace */
function autoSave(manager: MupManager): void {
  if (manager.getAll().length > 0) {
    saveWorkspace(LAST_WORKSPACE, manager);
  }
}

/** Restore a workspace — used by both MCP tool and browser */
function restoreWorkspace(
  name: string,
  manager: MupManager,
  bridge: UiBridge,
  sendLoadMup: (mupId: string, mup: any) => void
): string[] {
  const data = loadWorkspaceData(name);
  if (!data) return [];

  // Deactivate all
  for (const mup of manager.getAll()) manager.deactivate(mup.manifest.id);
  for (const k of Object.keys(callHistory)) delete callHistory[k];
  for (const k of Object.keys(customNames)) delete customNames[k];

  // Restore metadata
  currentDescription = data.description || "";
  currentGridLayout = data.gridLayout || [];
  if (data.customNames) Object.assign(customNames, data.customNames);
  if (data.callHistory) {
    for (const [k, v] of Object.entries(data.callHistory)) callHistory[k] = v;
  }

  // Restore MUPs
  const restored: string[] = [];
  for (const mupId of data.activeMups) {
    const mup = manager.activate(mupId);
    if (mup) {
      if (data.mupStates[mupId] !== undefined) mup.stateData = data.mupStates[mupId];
      restored.push(customNames[mupId] || mup.manifest.name);
    }
  }

  // Send to browser
  const catalog = manager.getCatalog().map((e) => ({
    id: e.manifest.id, name: e.manifest.name, description: e.manifest.description,
    functions: e.manifest.functions.length, active: e.active, grid: e.manifest.grid,
  }));
  bridge.sendRaw({ type: "workspace-loaded", name, customNames, gridLayout: data.gridLayout });
  bridge.sendRaw({ type: "mup-catalog", catalog });
  for (const mup of manager.getAll()) sendLoadMup(mup.manifest.id, mup);

  return restored;
}

// ---- Tool description builder ----

function buildToolDescription(manager: MupManager, port: number): string {
  const catalog = manager.getCatalog();
  const active = catalog.filter((e) => e.active);
  const inactive = catalog.filter((e) => !e.active);

  const lines = [
    `MUP — Interactive UI panels in browser at http://localhost:${port}. Auto-activated on first use.`,
    ``,
    `Call: { "mupId": "...", "functionName": "...", "functionArgs": { ... } }`,
    `Actions: checkInteractions, save, load, workspaces, list, history`,
  ];

  // Active MUPs: show function details (Claude needs these to call them)
  if (active.length > 0) {
    lines.push(``, `Active MUPs:`);
    for (const e of active) {
      const fns = e.manifest.functions.map((f) => `${f.name}`).join(", ");
      lines.push(`  ${e.manifest.id} — ${e.manifest.name}. Functions: ${fns}`);
    }
  }

  // Inactive MUPs: just names (use "list" for details)
  if (inactive.length > 0) {
    lines.push(``, `Available: ${inactive.map((e) => e.manifest.id).join(", ")}`);
  }

  return lines.join("\n");
}

/** Build detailed function info for a single MUP (returned on activate/list) */
function buildMupDetail(manifest: { name: string; id: string; description: string; functions: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> }): string {
  const lines = [`${manifest.name} (${manifest.id}): ${manifest.description}`];
  for (const fn of manifest.functions) {
    const schema = fn.inputSchema;
    const props = (schema.properties || {}) as Record<string, unknown>;
    const required = (schema.required || []) as string[];
    const paramList = Object.entries(props).map(([k, v]) => {
      const info = v as Record<string, unknown>;
      const req = required.includes(k) ? "" : "?";
      return `${k}${req}: ${info.type || "any"}`;
    });
    lines.push(`  - ${fn.name}(${paramList.join(", ")}) — ${fn.description}`);
  }
  return lines.join("\n");
}

// ---- Main ----

async function main() {
  const args = process.argv.slice(2);

  let mupFiles: string[] = [];
  let mupsDirs: string[] = [];
  let port = 3200;
  let noOpen = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--mups-dir" && args[i + 1]) {
      const dir = path.resolve(args[++i]);
      if (!fs.existsSync(dir)) {
        console.error(`[mup-mcp] Directory not found: ${dir}`);
        process.exit(1);
      }
      mupFiles.push(...scanHtmlFiles(dir));
      mupsDirs.push(dir);
    } else if (arg === "--port" && args[i + 1]) {
      port = parseInt(args[++i], 10);
    } else if (arg === "--no-open") {
      noOpen = true;
    } else if (arg === "--help" || arg === "-h") {
      console.error(`
mup-mcp-server — MCP server with interactive MUP UI panels

Usage:
  mup-mcp-server [options] [file1.html file2.html ...]

Options:
  --mups-dir <dir>     Load all .html MUP files from a directory
  --port <port>        UI panel port (default: 3200)
  --no-open            Don't auto-open the browser
  -h, --help           Show this help
`);
      process.exit(0);
    } else if (arg.endsWith(".html") || arg.endsWith(".htm")) {
      mupFiles.push(path.resolve(arg));
    }
  }

  // No default scanning — user must specify --mups-dir or individual files

  // --- Manager ---
  const manager = new MupManager();
  for (const file of mupFiles) {
    try {
      const manifest = manager.scanFile(file);
      console.error(`[mup-mcp] Scanned: ${manifest.name} (${manifest.id})`);
    } catch (err: unknown) {
      console.error(`[mup-mcp] Skip ${file}: ${(err as Error).message}`);
    }
  }

  // Build folder tree from scanned directories
  let serverFolderTree: FolderTreeNode[] = [];
  for (const dir of mupsDirs) {
    const tree = buildFolderTree(dir, manager);
    serverFolderTree.push(...tree);
  }

  // --- Find available port ---
  port = await findAvailablePort(port);

  // --- Bridge ---
  const bridge = new UiBridge(manager, port);
  bridge.folderTree = serverFolderTree;
  bridge.folderPath = mupsDirs.length > 0 ? mupsDirs[0] : "";
  await bridge.start();

  // No auto-restore — user picks from Workspaces panel in browser.
  // _last workspace is auto-saved so state is never lost.

  // --- Send load-mup with savedState ---
  function sendLoadMup(mupId: string, mup: { manifest: any; html: string; stateData?: unknown }): void {
    bridge.sendRaw({
      type: "load-mup",
      mupId: mup.manifest.id,
      html: mup.html,
      manifest: mup.manifest,
      savedState: mup.stateData,
    });
  }

  // --- Auto-activate helper ---
  function ensureActive(mupId: string): { error?: string; activated?: string } {
    if (manager.isActive(mupId)) return {};
    const mup = manager.activate(mupId);
    if (!mup) return { error: `MUP "${mupId}" not found. Use { "action": "list" } to see available MUPs.` };
    sendLoadMup(mupId, mup);
    autoSave(manager);
    console.error(`[mup-mcp] Auto-activated: ${mup.manifest.name}`);
    return { activated: buildMupDetail(mup.manifest) };
  }

  // Handle browser-side activation/deactivation
  bridge.on("activate-mup", (mupId: string) => {
    const mup = manager.activate(mupId);
    if (mup) {
      sendLoadMup(mupId, mup);
      autoSave(manager);
      console.error(`[mup-mcp] Activated: ${mup.manifest.name}`);
    }
  });

  bridge.on("deactivate-mup", (mupId: string) => {
    manager.deactivate(mupId);
    autoSave(manager);
    console.error(`[mup-mcp] Deactivated: ${mupId}`);
  });

  bridge.on("new-instance", (baseMupId: string, customName?: string) => {
    const mup = manager.activateInstance(baseMupId);
    if (mup) {
      if (customName) {
        mup.manifest.name = customName;
        customNames[mup.manifest.id] = customName;
      }
      sendLoadMup(mup.manifest.id, mup);
      autoSave(manager);
      console.error(`[mup-mcp] New instance: ${mup.manifest.name} (${mup.manifest.id})`);
    }
  });

  bridge.on("register-and-activate", (mupId: string, html: string, fileName: string) => {
    try {
      const manifest = manager.parseManifest(html, fileName);
      manifest.id = mupId;
      // Add to catalog if not already there
      const existing = manager.getCatalog().find((e) => e.manifest.id === mupId);
      if (!existing) {
        manager.loadFromHtml(html, fileName);
      } else {
        manager.activate(mupId);
      }
      const mup = manager.get(mupId);
      if (mup) {
        sendLoadMup(mupId, mup);
        autoSave(manager);
        console.error(`[mup-mcp] Registered + activated: ${manifest.name} (from browser)`);
      }
    } catch (err: unknown) {
      console.error(`[mup-mcp] Failed to register: ${(err as Error).message}`);
    }
  });

  // Save state when MUPs report state changes
  bridge.on("state-update", () => autoSave(manager));

  // Save grid layout from browser
  bridge.on("save-grid-layout", (layout: any) => {
    if (Array.isArray(layout)) currentGridLayout = layout;
  });

  // Auto-save every 30 seconds
  setInterval(() => autoSave(manager), 30_000);

  // --- Hot-reload: watch MUP directories for changes ---
  for (const dir of mupsDirs) {
    try {
      fs.watch(dir, { recursive: true }, (eventType, filename) => {
        if (!filename || !filename.endsWith(".html")) return;
        const filePath = path.join(dir, filename);
        if (!fs.existsSync(filePath)) return;
        try {
          const html = fs.readFileSync(filePath, "utf-8");
          const manifest = manager.parseManifest(html, filePath);
          const mupId = manifest.id;
          // Update catalog
          const catalogEntry = manager.getCatalog().find((e) => e.manifest.id === mupId);
          if (catalogEntry) {
            catalogEntry.html = html;
            catalogEntry.manifest = manifest;
          }
          // If active, reload in browser
          if (manager.isActive(mupId)) {
            const mup = manager.get(mupId);
            if (mup) {
              mup.html = html;
              mup.manifest = manifest;
              sendLoadMup(mupId, mup);
              console.error(`[mup-mcp] Hot-reloaded: ${manifest.name}`);
            }
          }
        } catch {}
      });
    } catch {}
  }

  // --- Workspace events from browser ---
  bridge.on("list-workspaces", () => {
    const workspaces = listWorkspaces();
    bridge.sendRaw({ type: "workspace-list", workspaces });
  });

  bridge.on("save-workspace", (name: string, description?: string) => {
    saveWorkspace(name, manager, description);
    bridge.sendRaw({ type: "workspace-saved", name });
    bridge.sendRaw({ type: "workspace-list", workspaces: listWorkspaces() });
  });

  bridge.on("load-workspace", (name: string) => {
    restoreWorkspace(name, manager, bridge, sendLoadMup);
  });

  bridge.on("delete-workspace", (name: string, isCurrent?: boolean) => {
    deleteWorkspace(name);
    if (isCurrent) {
      // Clear all active MUPs
      for (const mup of manager.getAll()) manager.deactivate(mup.manifest.id);
      for (const k of Object.keys(callHistory)) delete callHistory[k];
      currentDescription = "";
      const catalogData = manager.getCatalog().map((e) => ({
        id: e.manifest.id, name: e.manifest.name, description: e.manifest.description,
        functions: e.manifest.functions.length, active: e.active, grid: e.manifest.grid,
      }));
      bridge.sendRaw({ type: "workspace-cleared" });
      bridge.sendRaw({ type: "mup-catalog", catalog: catalogData });
    }
    bridge.sendRaw({ type: "workspace-list", workspaces: listWorkspaces() });
  });

  // --- MCP Server ---
  const server = new Server(
    { name: "mup-mcp-server", version: "0.2.0" },
    { capabilities: { tools: {} } }
  );

  // Single tool: mup
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "mup",
          description: buildToolDescription(manager, port),
          inputSchema: {
            type: "object" as const,
            properties: {
              action: {
                type: "string",
                description: '"checkInteractions" to check user UI activity, "list" to list MUPs. Omit when calling a function.',
              },
              mupId: {
                type: "string",
                description: "MUP ID (e.g. mup-chess, mup-chart). Auto-activated on first use.",
              },
              functionName: {
                type: "string",
                description: "Function to call (e.g. makeMove, renderChart, setPixels)",
              },
              functionArgs: {
                type: "object",
                description: "Arguments for the function. Can be a JSON object or JSON string.",
              },
              name: {
                type: "string",
                description: "Workspace name for save/load/deleteWorkspace actions.",
              },
              description: {
                type: "string",
                description: "Workspace description — what you're working on. Used with save action.",
              },
              since: {
                type: "number",
                description: "Unix timestamp (ms). Only return interactions after this time. Used with checkInteractions.",
              },
            },
          },
        },
      ],
    };
  });

  // Handle all calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { arguments: rawArgs } = request.params;
    const args = (rawArgs || {}) as Record<string, unknown>;

    const text = (t: string) => ({ type: "text" as const, text: t });

    // --- action: workspaces ---
    if (args.action === "workspaces") {
      const workspaces = listWorkspaces();
      if (workspaces.length === 0) {
        return { content: [text("No saved workspaces. Use { \"action\": \"save\", \"name\": \"...\" } to save the current state.")] };
      }
      const lines = workspaces.map((w) => {
        const time = new Date(w.savedAt).toLocaleString();
        const desc = w.description ? ` — ${w.description}` : "";
        return `- ${w.displayName}${desc} (saved ${time}, MUPs: ${w.activeMups.join(", ")})${w.name === "_last" ? " [auto-saved]" : ""}`;
      });
      return { content: [text("Saved workspaces:\n" + lines.join("\n"))] };
    }

    // --- action: save ---
    if (args.action === "save") {
      const name = args.name as string;
      if (!name) {
        return { content: [text('Provide "name" for the workspace.')], isError: true };
      }
      const desc = args.description as string | undefined;
      saveWorkspace(name, manager, desc);
      const active = manager.getAll().map((m) => customNames[m.manifest.id] || m.manifest.name);
      return { content: [text(`Workspace "${name}" saved.${desc ? ` Description: ${desc}` : ""}\nActive MUPs: ${active.join(", ") || "none"}.`)] };
    }

    // --- action: load ---
    if (args.action === "load") {
      const name = args.name as string;
      if (!name) {
        return { content: [text('Provide "name" of the workspace to load.')], isError: true };
      }
      if (!loadWorkspaceData(name)) {
        return { content: [text(`Workspace "${name}" not found. Use { "action": "workspaces" } to list.`)], isError: true };
      }
      const restored = restoreWorkspace(name, manager, bridge, sendLoadMup);
      const desc = currentDescription ? `\nDescription: ${currentDescription}` : "";
      return { content: [text(`Workspace "${name}" loaded.${desc}\nActive MUPs: ${restored.join(", ") || "none"}. Check the browser panel.`)] };
    }

    // --- action: deleteWorkspace ---
    if (args.action === "deleteWorkspace") {
      const name = args.name as string;
      if (!name) return { content: [text('Provide "name".')], isError: true };
      const ok = deleteWorkspace(name);
      return { content: [text(ok ? `Workspace "${name}" deleted.` : `Workspace "${name}" not found.`)] };
    }

    // --- action: list (full details) ---
    if (args.action === "list") {
      const catalog = manager.getCatalog();
      const sections = catalog.map((e) => {
        const status = e.active ? "[ACTIVE]" : "[available]";
        return `${status} ${buildMupDetail(e.manifest)}`;
      });
      return { content: [text(sections.join("\n\n"))] };
    }

    // --- action: checkInteractions ---
    if (args.action === "checkInteractions") {
      const since = typeof args.since === "number" ? args.since : undefined;
      const events = manager.drainEvents(since);
      const states = manager
        .getAll()
        .filter((m) => m.stateSummary)
        .map((m) => `[${m.manifest.name}] ${m.stateSummary}`);

      const parts: string[] = [];
      if (events.length > 0) {
        // Aggregate similar events: group by mupName+action
        const groups = new Map<string, { mupName: string; action: string; count: number; lastSummary: string }>();
        for (const e of events) {
          const key = `${e.mupName}|${e.action}`;
          const g = groups.get(key);
          if (g) { g.count++; g.lastSummary = e.summary; }
          else groups.set(key, { mupName: e.mupName, action: e.action, count: 1, lastSummary: e.summary });
        }
        const lines = Array.from(groups.values()).map((g) => {
          if (g.count === 1) return `  [${g.mupName}] ${g.action}: ${g.lastSummary}`;
          return `  [${g.mupName}] ${g.action} (${g.count}x, latest: ${g.lastSummary})`;
        });
        parts.push("User interactions:\n" + lines.join("\n"));
      }
      if (states.length > 0) {
        parts.push("Current states:\n" + states.map((s) => `  ${s}`).join("\n"));
      }
      return {
        content: [text(parts.length > 0 ? parts.join("\n\n") : "No interactions or state changes.")],
      };
    }

    // --- action: history ---
    if (args.action === "history") {
      const RECENT = 5;
      const mupId = args.mupId as string;

      function formatHistory(history: CallHistoryEntry[], limit: number): string[] {
        const lines: string[] = [];
        if (history.length > limit) {
          // Summarize older entries
          const older = history.slice(0, -limit);
          const fnCounts = new Map<string, number>();
          for (const h of older) fnCounts.set(h.functionName, (fnCounts.get(h.functionName) || 0) + 1);
          const summary = Array.from(fnCounts.entries()).map(([fn, c]) => `${fn}(${c}x)`).join(", ");
          lines.push(`  ... ${older.length} earlier calls: ${summary}`);
        }
        for (const h of history.slice(-limit)) {
          const time = new Date(h.timestamp).toLocaleTimeString();
          const argStr = JSON.stringify(h.args);
          const shortArgs = argStr.length > 80 ? argStr.slice(0, 80) + "..." : argStr;
          lines.push(`  [${time}] ${h.functionName}(${shortArgs}) → ${h.result}`);
        }
        return lines;
      }

      if (!mupId) {
        const parts: string[] = [];
        for (const mup of manager.getAll()) {
          const history = callHistory[mup.manifest.id];
          if (history && history.length > 0) {
            parts.push(`## ${mup.manifest.name} (${mup.manifest.id})`);
            if (mup.stateSummary) parts.push(`State: ${mup.stateSummary}`);
            parts.push(`${history.length} calls:`);
            parts.push(...formatHistory(history, RECENT));
          }
        }
        return { content: [text(parts.length > 0 ? parts.join("\n") : "No call history yet.")] };
      }
      const history = callHistory[mupId];
      const mup = manager.get(mupId);
      const parts: string[] = [];
      if (mup?.stateSummary) parts.push(`State: ${mup.stateSummary}`);
      if (!history || history.length === 0) {
        parts.push("No call history for this MUP.");
      } else {
        parts.push(`${history.length} calls:`);
        parts.push(...formatHistory(history, RECENT));
      }
      return { content: [text(parts.join("\n"))] };
    }

    // --- Call MUP function ---
    const mupId = args.mupId as string;
    const fn = args.functionName as string;

    if (!mupId || !fn) {
      return {
        content: [text('Provide "mupId" and "functionName", or use "action": "list" / "checkInteractions" / "history".')],
        isError: true,
      };
    }

    // Auto-activate
    const activation = ensureActive(mupId);
    if (activation.error) {
      return { content: [text(activation.error)], isError: true };
    }

    // Parse functionArgs (handles both string and object)
    const fnArgs = parseArgs(args.functionArgs);

    // Wait a beat if just activated (browser needs time to load iframe)
    if (!manager.get(mupId)?.stateSummary && manager.isActive(mupId)) {
      await new Promise((r) => setTimeout(r, 500));
    }

    const result = await bridge.callFunction(mupId, fn, fnArgs);

    // Record call history
    const resultText = result.content.map((c) => c.text || "").join(" ").trim();
    addCallHistory(mupId, fn, fnArgs, resultText);

    // Build response
    const content: Array<{ type: "text"; text: string }> = [];
    // If just activated, prepend function details so Claude knows the API
    if (activation.activated) {
      content.push(text(`[Auto-activated] ${activation.activated}`));
    }
    const MAX_RESPONSE = 2000;
    for (const c of result.content) {
      let t = c.text || JSON.stringify(c.data || "");
      if (t.length > MAX_RESPONSE) {
        t = t.slice(0, MAX_RESPONSE) + `\n... (truncated, ${t.length} chars total)`;
      }
      content.push({ type: "text" as const, text: t });
    }

    // Only auto-append "discuss" interactions (user explicitly wants LLM attention)
    // Other interactions stay in queue for checkInteractions
    const events = manager.drainEvents();
    const discuss = events.filter((e) => e.action === "discuss");
    const other = events.filter((e) => e.action !== "discuss");
    // Put non-discuss events back
    for (const e of other) manager.addEvent(e.mupId, e.action, e.summary, e.data);
    if (discuss.length > 0) {
      content.push(text(
        `\n--- User wants your attention ---\n${discuss.map((e) => `[${e.mupName}] ${e.summary}`).join("\n")}`
      ));
    }

    // Save state after each call
    autoSave(manager);

    return { content, isError: result.isError };
  });

  // Open browser — only if no connection arrives within 3 seconds
  // (existing tab will auto-reconnect faster than that)
  if (!noOpen) {
    const openTimer = setTimeout(() => {
      if (!bridge.isConnected()) {
        openBrowser(`http://localhost:${port}`);
      }
    }, 3000);
    // Cancel if browser connects before timeout
    bridge.once("browser-connected", () => clearTimeout(openTimer));
  }

  // Connect MCP via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[mup-mcp] MCP server running (stdio). UI panel on port ${port}. ${manager.getCatalog().length} MUPs loaded.`);
}

main().catch((err) => {
  console.error("[mup-mcp] Fatal:", err);
  process.exit(1);
});
