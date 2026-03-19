import * as fs from "node:fs";
import * as path from "node:path";

export interface MupFunction {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
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
}

export interface LoadedMup {
  manifest: MupManifest;
  html: string;
  filePath: string;
  stateSummary: string;
  stateData: unknown; // structured state for persistence
  pendingEvents: MupEvent[];
}

export interface MupEvent {
  action: string;
  summary: string;
  data?: unknown;
  timestamp: number;
}

/** Catalog entry: metadata only, not yet activated */
export interface CatalogEntry {
  manifest: MupManifest;
  html: string;
  filePath: string;
  active: boolean;
}

export class MupManager {
  private mups = new Map<string, LoadedMup>();
  private catalog = new Map<string, CatalogEntry>();

  /** Scan a file and add to catalog (not activated) */
  scanFile(filePath: string): MupManifest {
    const html = fs.readFileSync(filePath, "utf-8");
    const manifest = this.parseManifest(html, filePath);
    this.catalog.set(manifest.id, { manifest, html, filePath, active: false });
    return manifest;
  }

  /** Get the full catalog (metadata for UI) */
  getCatalog(): CatalogEntry[] {
    return Array.from(this.catalog.values());
  }

  /** Activate a MUP from catalog → becomes available for tool calls */
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

  /** Deactivate a MUP → remove from active tools */
  deactivate(mupId: string): void {
    this.mups.delete(mupId);
    const entry = this.catalog.get(mupId);
    if (entry) entry.active = false;
  }

  /** Check if a MUP is active */
  isActive(mupId: string): boolean {
    return this.mups.has(mupId);
  }

  loadFromFile(filePath: string): MupManifest {
    const html = fs.readFileSync(filePath, "utf-8");
    return this.loadFromHtml(html, filePath);
  }

  /** Parse manifest from HTML without loading */
  parseManifest(html: string, filePath: string): MupManifest {
    const match = html.match(
      /<script\s+type=["']application\/mup-manifest["']\s*>([\s\S]*?)<\/script>/
    );
    if (!match) {
      throw new Error(`No MUP manifest found in ${filePath}`);
    }
    const raw = JSON.parse(match[1].trim());
    const manifest: MupManifest = {
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
    };
    if (!manifest.name) throw new Error("Manifest missing 'name'");
    return manifest;
  }

  loadFromHtml(html: string, filePath: string): MupManifest {
    const manifest = this.parseManifest(html, filePath);

    // Also add to catalog (mark active since it's being loaded)
    const existing = this.catalog.get(manifest.id);
    if (existing) {
      existing.active = true;
    } else {
      this.catalog.set(manifest.id, { manifest, html, filePath, active: true });
    }

    this.mups.set(manifest.id, {
      manifest,
      html,
      filePath,
      stateSummary: "",
      stateData: undefined,
      pendingEvents: [],
    });

    return manifest;
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

  /** Get saved state data for all active MUPs */
  getStateSnapshot(): Record<string, unknown> {
    const states: Record<string, unknown> = {};
    for (const [id, mup] of this.mups) {
      if (mup.stateData !== undefined) states[id] = mup.stateData;
    }
    return states;
  }

  addEvent(
    mupId: string,
    action: string,
    summary: string,
    data?: unknown
  ): void {
    const mup = this.mups.get(mupId);
    if (mup) {
      mup.pendingEvents.push({ action, summary, data, timestamp: Date.now() });
      // Keep max 50 events
      if (mup.pendingEvents.length > 50) mup.pendingEvents.shift();
    }
  }

  drainEvents(): Array<{
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
      for (const event of mup.pendingEvents) {
        events.push({ mupId, mupName: mup.manifest.name, ...event });
      }
      mup.pendingEvents = [];
    }
    return events;
  }

  getToolDefinitions(): Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    _mupId: string;
    _functionName: string;
  }> {
    const tools: Array<{
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
      _mupId: string;
      _functionName: string;
    }> = [];

    for (const mup of this.mups.values()) {
      for (const fn of mup.manifest.functions) {
        tools.push({
          name: `${mup.manifest.id.replace(/[^a-zA-Z0-9]/g, "_")}__${fn.name}`,
          description: `[${mup.manifest.name}] ${fn.description}`,
          inputSchema: fn.inputSchema,
          _mupId: mup.manifest.id,
          _functionName: fn.name,
        });
      }
    }

    return tools;
  }

  parseToolName(
    toolName: string
  ): { mupId: string; functionName: string } | null {
    const sep = toolName.indexOf("__");
    if (sep === -1) return null;

    const sanitizedId = toolName.substring(0, sep);
    const functionName = toolName.substring(sep + 2);

    for (const mup of this.mups.values()) {
      if (mup.manifest.id.replace(/[^a-zA-Z0-9]/g, "_") === sanitizedId) {
        return { mupId: mup.manifest.id, functionName };
      }
    }
    return null;
  }
}
