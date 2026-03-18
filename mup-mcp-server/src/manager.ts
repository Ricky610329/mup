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
  pendingEvents: MupEvent[];
}

export interface MupEvent {
  action: string;
  summary: string;
  data?: unknown;
  timestamp: number;
}

export class MupManager {
  private mups = new Map<string, LoadedMup>();

  loadFromFile(filePath: string): MupManifest {
    const html = fs.readFileSync(filePath, "utf-8");
    return this.loadFromHtml(html, filePath);
  }

  loadFromHtml(html: string, filePath: string): MupManifest {
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

    this.mups.set(manifest.id, {
      manifest,
      html,
      filePath,
      stateSummary: "",
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

  updateState(mupId: string, summary: string): void {
    const mup = this.mups.get(mupId);
    if (mup) mup.stateSummary = summary;
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
