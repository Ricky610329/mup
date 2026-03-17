import type { MupManifest, ResolvedManifest, MupState } from "../protocol/types";

interface RegisteredMup {
  manifest: ResolvedManifest;
  state: MupState;
}

export class MupRegistry {
  private mups = new Map<string, RegisteredMup>();

  /** Parse manifest from a single-file MUP HTML, apply defaults, validate */
  parseFromHtml(html: string): { manifest: ResolvedManifest; htmlContent: string } {
    const match = html.match(
      /<script\s+type=["']application\/mup-manifest["']\s*>([\s\S]*?)<\/script>/
    );

    if (!match) {
      throw new Error('No <script type="application/mup-manifest"> found');
    }

    const raw = JSON.parse(match[1].trim()) as MupManifest;

    // Apply defaults to produce a ResolvedManifest
    const manifest: ResolvedManifest = {
      ...raw,
      protocol: raw.protocol ?? "mup/2026-03-17",
      id: raw.id ?? "mup-" + Date.now(),
      version: raw.version ?? "1.0.0",
      grid: raw.grid ?? { minWidth: 1, minHeight: 1 },
      functions: raw.functions ?? [],
    };

    this.validate(manifest);
    this.mups.set(manifest.id, { manifest, state: "registered" });

    return { manifest, htmlContent: html };
  }

  get(mupId: string): RegisteredMup | undefined {
    return this.mups.get(mupId);
  }

  getAll(): RegisteredMup[] {
    return Array.from(this.mups.values());
  }

  setState(mupId: string, state: MupState): void {
    const mup = this.mups.get(mupId);
    if (mup) mup.state = state;
  }

  unregister(mupId: string): void {
    this.mups.delete(mupId);
  }

  private validate(manifest: ResolvedManifest): void {
    if (!manifest.name) throw new Error("Manifest missing 'name'");
    if (manifest.grid.minWidth === undefined) manifest.grid.minWidth = 1;
    if (manifest.grid.minHeight === undefined) manifest.grid.minHeight = 1;

    for (const fn of manifest.functions) {
      if (!fn.name) throw new Error("Function missing name");
      if (!fn.inputSchema) fn.inputSchema = { type: "object", properties: {} };
      if (!fn.description) fn.description = fn.name;
    }
  }
}
