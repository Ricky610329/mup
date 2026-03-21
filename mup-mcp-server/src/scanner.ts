import * as fs from "node:fs";
import * as path from "node:path";
import type { MupManager } from "./manager.js";
import type { FolderTreeNode } from "./types.js";

export function scanHtmlFiles(dir: string): string[] {
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

export function buildFolderTree(dir: string, manager: MupManager): FolderTreeNode[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const folders: FolderTreeNode[] = [];
  const files: FolderTreeNode[] = [];

  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith(".")) {
      const children = buildFolderTree(path.join(dir, entry.name), manager);
      if (children.length > 0) folders.push({ type: "folder", name: entry.name, children });
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      try {
        const manifest = manager.parseManifest(fs.readFileSync(path.join(dir, entry.name), "utf-8"), path.join(dir, entry.name));
        const catalogEntry = manager.getCatalog().find((e) => e.manifest.id === manifest.id);
        files.push({
          type: "file", name: manifest.name, id: manifest.id,
          description: manifest.description, active: catalogEntry?.active || false,
          multiInstance: manifest.multiInstance || false,
        });
      } catch {
        // Non-MUP HTML file — expected, skip silently
      }
    }
  }
  folders.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  return [...folders, ...files];
}
