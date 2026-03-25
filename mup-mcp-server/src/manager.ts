import * as fs from "node:fs";
import * as path from "node:path";
import { CONFIG } from "./config.js";

export interface MupFunction {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export type NotificationLevel = "immediate" | "notify" | "silent";

export interface MupNotifications {
  level: NotificationLevel;
  overridable: boolean;
}

export interface MupManifest {
  protocol: string;
  id: string;
  name: string;
  version: string;
  description: string;
  grid?: {
    minWidth?: number;
    minHeight?: number;
    maxWidth?: number;
    maxHeight?: number;
    preferredWidth?: number;
    preferredHeight?: number;
    resizable?: boolean;
  };
  functions: MupFunction[];
  permissions?: string[];
  multiInstance?: boolean;
  darkMode?: boolean;
  notifications?: MupNotifications;
}

export interface LoadedMup {
  manifest: MupManifest;
  html: string;
  filePath: string;
  stateSummary: string;
  stateData: unknown;
  pendingEvents: MupEvent[];
}

export interface MupEvent {
  action: string;
  summary: string;
  data?: unknown;
  timestamp: number;
}

export interface CatalogEntry {
  manifest: MupManifest;
  html: string;
  filePath: string;
  active: boolean;
}

export class MupManager {
  private mups = new Map<string, LoadedMup>();
  private catalog = new Map<string, CatalogEntry>();
  /** Per-MUP notification level overrides set by LLM (session-only) */
  private notificationOverrides = new Map<string, NotificationLevel>();

  /** Get the effective notification level for a MUP */
  getNotificationLevel(mupId: string): NotificationLevel {
    const override = this.notificationOverrides.get(mupId);
    if (override) return override;
    const mup = this.mups.get(mupId) ?? this.catalog.get(mupId.replace(/_\d+$/, ""));
    const manifest = mup && "manifest" in mup ? (mup as LoadedMup).manifest : (mup as CatalogEntry | undefined)?.manifest;
    return manifest?.notifications?.level ?? "notify";
  }

  /** Set notification level override. Returns error string if not overridable. */
  setNotificationLevel(mupId: string, level: NotificationLevel): string | null {
    const mup = this.mups.get(mupId);
    if (!mup) return `MUP "${mupId}" not found.`;
    const notifications = mup.manifest.notifications;
    if (notifications && notifications.overridable === false) {
      return `MUP "${mup.manifest.name}" notification level is fixed at "${notifications.level}" and cannot be changed.`;
    }
    this.notificationOverrides.set(mupId, level);
    return null;
  }

  scanFile(filePath: string): MupManifest {
    const html = fs.readFileSync(filePath, "utf-8");
    const manifest = this.parseManifest(html, filePath);
    this.catalog.set(manifest.id, { manifest, html, filePath, active: false });
    return manifest;
  }

  getCatalog(): CatalogEntry[] {
    return Array.from(this.catalog.values());
  }

  clearCatalog(): void {
    this.catalog.clear();
  }

  activate(mupId: string): LoadedMup | null {
    const entry = this.catalog.get(mupId);
    if (!entry) return null;
    entry.active = true;
    const loaded: LoadedMup = {
      manifest: entry.manifest,
      html: entry.html,
      filePath: entry.filePath,
      stateSummary: "",
      stateData: undefined,
      pendingEvents: [],
    };
    this.mups.set(mupId, loaded);
    return loaded;
  }

  /** Create a new instance of a multi-instance MUP */
  activateInstance(baseMupId: string): LoadedMup | null {
    const entry = this.catalog.get(baseMupId);
    if (!entry || !entry.manifest.multiInstance) return null;

    // Find next available instance number
    let n = 2;
    while (this.mups.has(`${baseMupId}_${n}`)) n++;
    const instanceId = `${baseMupId}_${n}`;

    // Create instance with cloned manifest + unique ID
    const manifest = { ...entry.manifest, id: instanceId, name: `${entry.manifest.name} #${n}` };
    const loaded: LoadedMup = {
      manifest,
      html: entry.html,
      filePath: entry.filePath,
      stateSummary: "",
      stateData: undefined,
      pendingEvents: [],
    };
    this.mups.set(instanceId, loaded);
    return loaded;
  }

  /** Create an instance of a multi-instance MUP with a specific instance ID (for workspace restore) */
  activateInstanceWithId(baseMupId: string, instanceId: string): LoadedMup | null {
    const entry = this.catalog.get(baseMupId);
    if (!entry || !entry.manifest.multiInstance) return null;
    if (this.mups.has(instanceId)) return null;

    const match = instanceId.match(/_(\d+)$/);
    const n = match ? parseInt(match[1], 10) : 2;

    const manifest = { ...entry.manifest, id: instanceId, name: `${entry.manifest.name} #${n}` };
    const loaded: LoadedMup = {
      manifest,
      html: entry.html,
      filePath: entry.filePath,
      stateSummary: "",
      stateData: undefined,
      pendingEvents: [],
    };
    this.mups.set(instanceId, loaded);
    return loaded;
  }

  deactivate(mupId: string): void {
    this.mups.delete(mupId);
    // Only mark catalog entry inactive if no instances remain
    const baseId = mupId.replace(/_\d+$/, "");
    const hasInstances = Array.from(this.mups.keys()).some(
      (k) => k === baseId || k.startsWith(baseId + "_")
    );
    if (!hasInstances) {
      const entry = this.catalog.get(baseId);
      if (entry) entry.active = false;
    }
  }

  isActive(mupId: string): boolean {
    return this.mups.has(mupId);
  }

  /** Check if a MUP supports multiple instances */
  isMultiInstance(mupId: string): boolean {
    const baseId = mupId.replace(/_\d+$/, "");
    const entry = this.catalog.get(baseId);
    return entry?.manifest.multiInstance ?? false;
  }

  /** Register a MUP from HTML string into catalog without activating */
  scanFromHtml(html: string, filePath: string): MupManifest {
    const manifest = this.parseManifest(html, filePath);
    if (!this.catalog.has(manifest.id)) {
      this.catalog.set(manifest.id, { manifest, html, filePath, active: false });
    }
    return manifest;
  }

  loadFromHtml(html: string, filePath: string): MupManifest {
    const manifest = this.parseManifest(html, filePath);
    const existing = this.catalog.get(manifest.id);
    if (existing) {
      existing.active = true;
    } else {
      this.catalog.set(manifest.id, { manifest, html, filePath, active: true });
    }
    this.mups.set(manifest.id, {
      manifest, html, filePath,
      stateSummary: "", stateData: undefined, pendingEvents: [],
    });
    return manifest;
  }

  parseManifest(html: string, filePath: string): MupManifest {
    const match = html.match(
      /<script\s+type=["']application\/mup-manifest["']\s*>([\s\S]*?)<\/script>/
    );
    if (!match) {
      throw new Error(`No MUP manifest found in ${filePath}`);
    }
    const raw = JSON.parse(match[1].trim());
    return {
      protocol: raw.protocol ?? "mup/2026-03-17",
      id: raw.id ?? "mup-" + path.basename(filePath, ".html"),
      name: raw.name,
      version: raw.version ?? "1.0.0",
      description: raw.description ?? raw.name,
      grid: raw.grid,
      functions: (raw.functions ?? []).map((fn: Record<string, unknown>) => ({
        name: fn.name as string,
        description: (fn.description as string) || (fn.name as string),
        inputSchema: (fn.inputSchema as Record<string, unknown>) || {
          type: "object",
          properties: {},
        },
      })),
      permissions: raw.permissions,
      multiInstance: raw.multiInstance ?? false,
      darkMode: raw.darkMode ?? false,
      notifications: raw.notifications ? {
        level: raw.notifications.level ?? "notify",
        overridable: raw.notifications.overridable ?? true,
      } : undefined,
    };
  }

  getAll(): LoadedMup[] {
    return Array.from(this.mups.values());
  }

  get(mupId: string): LoadedMup | undefined {
    return this.mups.get(mupId);
  }

  updateState(mupId: string, summary: string, data?: unknown): void {
    const mup = this.mups.get(mupId);
    if (mup) {
      mup.stateSummary = summary;
      if (data !== undefined) mup.stateData = data;
    }
  }

  addEvent(mupId: string, action: string, summary: string, data?: unknown): void {
    const mup = this.mups.get(mupId);
    if (mup) {
      mup.pendingEvents.push({ action, summary, data, timestamp: Date.now() });
      if (mup.pendingEvents.length > CONFIG.maxPendingEvents) mup.pendingEvents.shift();
    }
  }

  drainEvents(since?: number): Array<{
    mupId: string;
    mupName: string;
    action: string;
    summary: string;
    data?: unknown;
    timestamp: number;
  }> {
    const events: Array<{
      mupId: string;
      mupName: string;
      action: string;
      summary: string;
      data?: unknown;
      timestamp: number;
    }> = [];
    for (const [mupId, mup] of this.mups) {
      const keep: typeof mup.pendingEvents = [];
      for (const event of mup.pendingEvents) {
        if (since && event.timestamp <= since) {
          keep.push(event); // keep events older than since
        } else {
          events.push({ mupId, mupName: mup.manifest.name, ...event });
        }
      }
      mup.pendingEvents = keep;
    }
    return events;
  }

}
