import * as fs from "node:fs";
import * as path from "node:path";
import { MupManager } from "./manager.js";
import type { UiBridge } from "./bridge.js";
import { CONFIG } from "./config.js";
import type {
  CallHistoryEntry,
  WorkspaceMetadata,
  GridLayoutItem,
} from "./types.js";

// ---- Constants ----

const MUP_DIR_NAME = ".mup";
const METADATA_FILE = "workspace.json";
const METADATA_VERSION = 1;

// ---- WorkspaceManager (folder-based, in-place) ----
//
// Persistence model:
//   PERSISTED (in .mup/workspace.json):
//     - activeMups: which MUPs are open
//     - gridLayout: widget positions and sizes
//     - customNames: user-renamed panels
//     - name: workspace name
//     - mupsPath: last loaded MUP folder
//   SESSION-ONLY (lost on server restart):
//     - callHistory: function call log per MUP
//     - stateSummary: last state string from each MUP
//   MUP-MANAGED (not server's concern):
//     - Internal MUP data: stored in browser localStorage by each MUP

export class WorkspaceManager {
  /** Session-only call history (not persisted) */
  callHistory: Record<string, CallHistoryEntry[]> = {};
  customNames: Record<string, string> = {};
  gridLayout: GridLayoutItem[] = [];
  name = "";
  mupsPath = "";

  private bridge: UiBridge | null = null;
  private dotMupDir: string;

  private metadataDirty = false;
  private _metaTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private manager: MupManager, workspaceRoot: string) {
    this.dotMupDir = path.join(workspaceRoot, MUP_DIR_NAME);
  }

  /** Set bridge reference for auto-save notifications */
  setBridge(bridge: UiBridge): void {
    this.bridge = bridge;
  }

  // ---- Directory Setup ----

  private ensureDirs(): void {
    if (!fs.existsSync(this.dotMupDir)) fs.mkdirSync(this.dotMupDir, { recursive: true });
  }

  /** Write JSON atomically: write to .tmp then rename over target */
  private atomicWriteJson(filePath: string, data: unknown): void {
    const tmp = filePath + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, filePath);
  }

  // ---- Call History (session-only) ----

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

  // ---- Metadata Persistence (workspace.json) ----

  private saveMetadata(): void {
    try {
      this.ensureDirs();
      const meta: WorkspaceMetadata = {
        version: METADATA_VERSION,
        name: this.name || undefined,
        mupsPath: this.mupsPath || undefined,
        activeMups: this.manager.getAll().map((m) => m.manifest.id),
        gridLayout: this.gridLayout,
        customNames: { ...this.customNames },
      };
      this.atomicWriteJson(path.join(this.dotMupDir, METADATA_FILE), meta);
    } catch (err) {
      console.error("[mup-mcp] Failed to save metadata:", err);
    }
  }

  private loadMetadata(): WorkspaceMetadata | null {
    const p = path.join(this.dotMupDir, METADATA_FILE);
    try {
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf-8"));
    } catch (err) {
      console.error("[mup-mcp] Metadata corrupted, trying .tmp fallback:", err);
      try {
        const tmp = p + ".tmp";
        if (fs.existsSync(tmp)) return JSON.parse(fs.readFileSync(tmp, "utf-8"));
      } catch { /* both corrupted */ }
    }
    return null;
  }

  /** Mark workspace metadata as dirty */
  markMetadataDirty(): void {
    this.metadataDirty = true;
    if (!this._metaTimer) {
      this._metaTimer = setTimeout(() => {
        this._metaTimer = null;
        if (this.metadataDirty) {
          this.metadataDirty = false;
          this.saveMetadata();
          if (this.bridge) this.bridge.sendRaw({ type: "auto-saved" });
        }
      }, CONFIG.autoSaveDebounceMs);
    }
  }

  /** Flush all pending saves immediately (for shutdown/disconnect) */
  flushSave(): void {
    if (this._metaTimer) clearTimeout(this._metaTimer);
    this._metaTimer = null;
    if (this.metadataDirty) {
      this.metadataDirty = false;
      this.saveMetadata();
    }
  }

  /** Periodic auto-save: flush metadata if dirty */
  autoSave(): void {
    if (this.metadataDirty) {
      this.metadataDirty = false;
      this.saveMetadata();
    }
  }

  // ---- MUP Source Path ----

  /** Read saved mupsPath from workspace.json (can be called before full restore) */
  static getSavedMupsPath(workspaceRoot: string): string | undefined {
    const p = path.join(workspaceRoot, MUP_DIR_NAME, METADATA_FILE);
    try {
      if (fs.existsSync(p)) {
        const meta = JSON.parse(fs.readFileSync(p, "utf-8")) as WorkspaceMetadata;
        return meta.mupsPath;
      }
    } catch { /* ignore */ }
    return undefined;
  }

  setMupsPath(p: string): void {
    this.mupsPath = p;
    this.markMetadataDirty();
  }

  // ---- Restore on Startup ----

  /** Load workspace from .mup/ folder, activate MUPs and restore state */
  restoreFromDisk(): string[] {
    const meta = this.loadMetadata();
    if (!meta || meta.activeMups.length === 0) return [];

    this.gridLayout = meta.gridLayout || [];
    if (meta.name) this.name = meta.name;
    if (meta.mupsPath) this.mupsPath = meta.mupsPath;
    if (meta.customNames) Object.assign(this.customNames, meta.customNames);

    const restored: string[] = [];
    for (const mupId of meta.activeMups) {
      let mup: ReturnType<typeof this.manager.activate>;
      const instanceMatch = mupId.match(/^(.+)_(\d+)$/);
      if (instanceMatch) {
        mup = this.manager.activateInstanceWithId(instanceMatch[1], mupId);
      } else {
        mup = this.manager.activate(mupId);
      }
      if (mup) {
        if (meta.customNames[mupId]) mup.manifest.name = meta.customNames[mupId];
        restored.push(this.customNames[mupId] || mup.manifest.name);
      }
    }
    return restored;
  }

  /** Send restored state to browser on connect */
  sendRestoredState(bridge: UiBridge): void {
    bridge.sendRaw({
      type: "workspace-restored",
      name: this.name || undefined,
      customNames: { ...this.customNames },
      gridLayout: this.gridLayout.length > 0 ? this.gridLayout : undefined,
    });
  }

  // ---- Deactivation Cleanup ----

  onMupDeactivated(mupId: string): void {
    delete this.callHistory[mupId];
    delete this.customNames[mupId];
    this.markMetadataDirty();
  }

}
