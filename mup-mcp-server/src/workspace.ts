import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { MupManager } from "./manager.js";
import type { UiBridge } from "./bridge.js";
import { CONFIG } from "./config.js";
import type {
  CallHistoryEntry,
  WorkspaceData,
  GridLayoutItem,
  CatalogSummary,
  SendLoadMupFn,
} from "./types.js";

// Re-export for backwards compatibility
export type { CallHistoryEntry, GridLayoutItem };

// ---- Constants ----

const DATA_DIR = path.join(os.homedir(), ".mup-mcp");
const WORKSPACES_DIR = path.join(DATA_DIR, "workspaces");
const DEFAULT_LAST_WORKSPACE = "_last";

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function workspacePath(name: string): string {
  return path.join(WORKSPACES_DIR, `${name.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
}

// ---- WorkspaceManager ----

export class WorkspaceManager {
  callHistory: Record<string, CallHistoryEntry[]> = {};
  customNames: Record<string, string> = {};
  description = "";
  gridLayout: GridLayoutItem[] = [];

  private bridge: UiBridge | null = null;
  private _dirty = false;
  private _saveTimer: ReturnType<typeof setTimeout> | null = null;
  private _lastWorkspace = DEFAULT_LAST_WORKSPACE;

  constructor(private manager: MupManager) {}

  /** Set instance-specific auto-save key (e.g. port) to avoid conflicts with parallel instances */
  setInstanceId(id: string | number): void {
    this._lastWorkspace = `_last_${id}`;
  }

  /** Set bridge reference for auto-save notifications */
  setBridge(bridge: UiBridge): void {
    this.bridge = bridge;
  }

  // ---- Call History ----

  addCallHistory(mupId: string, functionName: string, args: Record<string, unknown>, result: string): void {
    if (!this.callHistory[mupId]) this.callHistory[mupId] = [];
    this.callHistory[mupId].push({
      functionName,
      args,
      result: result.slice(0, CONFIG.maxHistoryResultLength),
      timestamp: Date.now(),
    });
    if (this.callHistory[mupId].length > CONFIG.maxCallHistory) this.callHistory[mupId].shift();
  }

  // ---- Dirty Flag + Debounced Save ----

  /** Mark state as dirty — triggers a debounced auto-save */
  markDirty(): void {
    this._dirty = true;
    if (!this._saveTimer) {
      this._saveTimer = setTimeout(() => {
        this._saveTimer = null;
        if (this._dirty) {
          this._dirty = false;
          this.autoSave();
        }
      }, CONFIG.autoSaveDebounceMs);
    }
  }

  /** Flush any pending save immediately (for shutdown/disconnect) */
  flushSave(): void {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = null;
    if (this._dirty) {
      this._dirty = false;
      this.autoSave();
    }
  }

  // ---- Persistence ----

  save(name: string, desc?: string): void {
    try {
      ensureDir(WORKSPACES_DIR);
      if (desc !== undefined) this.description = desc;
      const data: WorkspaceData = {
        name,
        description: this.description,
        savedAt: Date.now(),
        activeMups: this.manager.getAll().map((m) => m.manifest.id),
        mupStates: this.manager.getStateSnapshot(),
        callHistory: this.callHistory,
        customNames: { ...this.customNames },
        gridLayout: this.gridLayout.length > 0 ? this.gridLayout : undefined,
      };
      fs.writeFileSync(workspacePath(name), JSON.stringify(data, null, 2));
    } catch (err) {
      console.error("[mup-mcp] Failed to save workspace:", err);
    }
  }

  load(name: string): WorkspaceData | null {
    try {
      const p = workspacePath(name);
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf-8"));
    } catch (err) {
      console.error(`[mup-mcp] Failed to load workspace "${name}":`, err);
    }
    return null;
  }

  list(): Array<{ name: string; displayName: string; description: string; savedAt: number; activeMups: string[] }> {
    try {
      ensureDir(WORKSPACES_DIR);
      const files = fs.readdirSync(WORKSPACES_DIR).filter((f) => f.endsWith(".json"));
      return files.map((f) => {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(WORKSPACES_DIR, f), "utf-8")) as WorkspaceData;
          return {
            name: data.name,
            displayName: data.name,
            description: data.description || "",
            savedAt: data.savedAt,
            activeMups: data.activeMups,
          };
        } catch (err) {
          console.error(`[mup-mcp] Failed to parse workspace file "${f}":`, err);
          return null;
        }
      })
        .filter((x): x is NonNullable<typeof x> => x !== null)
        .filter((w) => !w.name.startsWith("_last"))
        .sort((a, b) => b.savedAt - a.savedAt);
    } catch (err) {
      console.error("[mup-mcp] Failed to list workspaces:", err);
      return [];
    }
  }

  delete(name: string): boolean {
    try {
      const p = workspacePath(name);
      if (fs.existsSync(p)) { fs.unlinkSync(p); return true; }
    } catch (err) {
      console.error(`[mup-mcp] Failed to delete workspace "${name}":`, err);
    }
    return false;
  }

  /** Auto-save to _last workspace and notify browser */
  autoSave(): void {
    if (this.manager.getAll().length > 0) {
      this.save(this._lastWorkspace);
      if (this.bridge) this.bridge.sendRaw({ type: "auto-saved" });
    }
  }

  // ---- Restore ----

  /** Shared restore logic: applies workspace data to manager state */
  private _applyWorkspaceData(data: WorkspaceData): string[] {
    this.description = data.description || "";
    this.gridLayout = data.gridLayout || [];
    if (data.customNames) Object.assign(this.customNames, data.customNames);
    if (data.callHistory) {
      for (const [k, v] of Object.entries(data.callHistory)) this.callHistory[k] = v;
    }

    const restored: string[] = [];
    for (const mupId of data.activeMups) {
      const mup = this.manager.activate(mupId);
      if (mup) {
        if (data.mupStates[mupId] !== undefined) mup.stateData = data.mupStates[mupId];
        restored.push(this.customNames[mupId] || mup.manifest.name);
      }
    }
    return restored;
  }

  /** Silent restore on startup — activates MUPs without sending browser messages */
  silentRestore(): string[] {
    const data = this.load(this._lastWorkspace);
    if (!data || data.activeMups.length === 0) return [];
    return this._applyWorkspaceData(data);
  }

  /** Full restore — deactivates current MUPs, restores state, sends browser messages */
  restore(bridge: UiBridge, sendLoadMup: SendLoadMupFn, name: string): string[] {
    const data = this.load(name);
    if (!data) return [];

    // Deactivate all current MUPs
    for (const mup of this.manager.getAll()) this.manager.deactivate(mup.manifest.id);
    this.reset();

    // Apply workspace data
    const restored = this._applyWorkspaceData(data);

    // Notify browser
    bridge.sendRaw({
      type: "workspace-loaded",
      name,
      customNames: { ...this.customNames },
      gridLayout: data.gridLayout,
      description: data.description,
    });
    bridge.sendRaw({ type: "mup-catalog", catalog: this.buildCatalogSummary() });
    for (const mup of this.manager.getAll()) sendLoadMup(mup.manifest.id, mup);

    return restored;
  }

  // ---- Helpers ----

  /** Build catalog summary (used by restore + event handlers) */
  buildCatalogSummary(): CatalogSummary[] {
    return this.manager.getCatalog().map((e) => ({
      id: e.manifest.id,
      name: e.manifest.name,
      description: e.manifest.description,
      functions: e.manifest.functions.length,
      active: e.active,
      grid: e.manifest.grid,
      multiInstance: e.manifest.multiInstance || false,
    }));
  }

  /** Reset workspace state (for "new workspace") */
  reset(): void {
    for (const k of Object.keys(this.callHistory)) delete this.callHistory[k];
    for (const k of Object.keys(this.customNames)) delete this.customNames[k];
    this.description = "";
    this.gridLayout = [];
  }
}
