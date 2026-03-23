import * as fs from "node:fs";
import * as path from "node:path";
import { MupManager } from "./manager.js";
import type { UiBridge } from "./bridge.js";
import { CONFIG } from "./config.js";
import type {
  CallHistoryEntry,
  WorkspaceMetadata,
  MupStateFile,
  GridLayoutItem,
  CatalogSummary,
  SendLoadMupFn,
} from "./types.js";

// Re-export for backwards compatibility
export type { CallHistoryEntry, GridLayoutItem };

// ---- Constants ----

const MUP_DIR_NAME = ".mup";
const METADATA_FILE = "workspace.json";
const STATE_DIR = "state";
const METADATA_VERSION = 1;

// ---- WorkspaceManager (folder-based, in-place) ----

export class WorkspaceManager {
  /** Session-only call history (not persisted) */
  callHistory: Record<string, CallHistoryEntry[]> = {};
  customNames: Record<string, string> = {};
  gridLayout: GridLayoutItem[] = [];

  private bridge: UiBridge | null = null;
  private mupsDir: string;
  private dotMupDir: string;
  private stateDir: string;

  // Per-MUP dirty tracking
  private dirtyMups = new Set<string>();
  private metadataDirty = false;
  private _stateTimer: ReturnType<typeof setTimeout> | null = null;
  private _metaTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private manager: MupManager, mupsDir: string) {
    this.mupsDir = mupsDir;
    this.dotMupDir = path.join(mupsDir, MUP_DIR_NAME);
    this.stateDir = path.join(this.dotMupDir, STATE_DIR);
  }

  /** Set bridge reference for auto-save notifications */
  setBridge(bridge: UiBridge): void {
    this.bridge = bridge;
  }

  // ---- Directory Setup ----

  private ensureDirs(): void {
    if (!fs.existsSync(this.dotMupDir)) fs.mkdirSync(this.dotMupDir, { recursive: true });
    if (!fs.existsSync(this.stateDir)) fs.mkdirSync(this.stateDir, { recursive: true });
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
        activeMups: this.manager.getAll().map((m) => m.manifest.id),
        gridLayout: this.gridLayout,
        customNames: { ...this.customNames },
      };
      fs.writeFileSync(path.join(this.dotMupDir, METADATA_FILE), JSON.stringify(meta, null, 2));
    } catch (err) {
      console.error("[mup-mcp] Failed to save metadata:", err);
    }
  }

  private loadMetadata(): WorkspaceMetadata | null {
    try {
      const p = path.join(this.dotMupDir, METADATA_FILE);
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf-8"));
    } catch (err) {
      console.error("[mup-mcp] Failed to load metadata:", err);
    }
    return null;
  }

  // ---- Per-MUP State Persistence ----

  private saveMupState(mupId: string): void {
    try {
      this.ensureDirs();
      const mup = this.manager.get(mupId);
      if (!mup || mup.stateData === undefined) return;
      const stateFile: MupStateFile = {
        mupId,
        savedAt: Date.now(),
        data: mup.stateData,
      };
      const filePath = path.join(this.stateDir, `${mupId.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
      fs.writeFileSync(filePath, JSON.stringify(stateFile, null, 2));
    } catch (err) {
      console.error(`[mup-mcp] Failed to save state for ${mupId}:`, err);
    }
  }

  private loadMupState(mupId: string): unknown | undefined {
    try {
      const filePath = path.join(this.stateDir, `${mupId.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
      if (fs.existsSync(filePath)) {
        const stateFile = JSON.parse(fs.readFileSync(filePath, "utf-8")) as MupStateFile;
        return stateFile.data;
      }
    } catch (err) {
      console.error(`[mup-mcp] Failed to load state for ${mupId}:`, err);
    }
    return undefined;
  }

  private deleteMupState(mupId: string): void {
    try {
      const filePath = path.join(this.stateDir, `${mupId.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch { /* ignore */ }
  }

  // ---- Dirty Tracking + Debounced Saves ----

  /** Mark a MUP's state as dirty */
  markMupDirty(mupId: string): void {
    this.dirtyMups.add(mupId);
    if (!this._stateTimer) {
      this._stateTimer = setTimeout(() => {
        this._stateTimer = null;
        this.flushDirtyStates();
      }, CONFIG.autoSaveDebounceMs);
    }
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

  private flushDirtyStates(): void {
    if (this.dirtyMups.size === 0) return;
    for (const mupId of this.dirtyMups) {
      this.saveMupState(mupId);
    }
    this.dirtyMups.clear();
    if (this.bridge) this.bridge.sendRaw({ type: "auto-saved" });
  }

  /** Flush all pending saves immediately (for shutdown/disconnect) */
  flushSave(): void {
    if (this._stateTimer) clearTimeout(this._stateTimer);
    if (this._metaTimer) clearTimeout(this._metaTimer);
    this._stateTimer = null;
    this._metaTimer = null;
    this.flushDirtyStates();
    if (this.metadataDirty) {
      this.metadataDirty = false;
      this.saveMetadata();
    }
  }

  /** Periodic auto-save: flush any dirty state */
  autoSave(): void {
    this.flushDirtyStates();
    if (this.metadataDirty) {
      this.metadataDirty = false;
      this.saveMetadata();
    }
  }

  // ---- Restore on Startup ----

  /** Load workspace from .mup/ folder, activate MUPs and restore state */
  restoreFromDisk(): string[] {
    const meta = this.loadMetadata();
    if (!meta || meta.activeMups.length === 0) return [];

    this.gridLayout = meta.gridLayout || [];
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
        const savedData = this.loadMupState(mupId);
        if (savedData !== undefined) mup.stateData = savedData;
        if (meta.customNames[mupId]) mup.manifest.name = meta.customNames[mupId];
        restored.push(this.customNames[mupId] || mup.manifest.name);
      }
    }
    return restored;
  }

  /** Send restored state to browser on connect */
  sendRestoredState(bridge: UiBridge): void {
    if (Object.keys(this.customNames).length > 0 || this.gridLayout.length > 0) {
      bridge.sendRaw({
        type: "workspace-restored",
        customNames: { ...this.customNames },
        gridLayout: this.gridLayout.length > 0 ? this.gridLayout : undefined,
      });
    }
  }

  // ---- Deactivation Cleanup ----

  onMupDeactivated(mupId: string): void {
    this.deleteMupState(mupId);
    delete this.callHistory[mupId];
    delete this.customNames[mupId];
    this.dirtyMups.delete(mupId);
    this.markMetadataDirty();
  }

  // ---- Helpers ----

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
}
