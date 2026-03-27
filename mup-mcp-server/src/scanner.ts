import * as fs from "node:fs";
import * as path from "node:path";
import type { MupManager } from "./manager.js";
import type { FolderTreeNode } from "./types.js";
import { isDirectoryMup } from "./bundler.js";

const SKIP_DIRS = new Set(["node_modules", "dist", ".git"]);

export function scanHtmlFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.name.startsWith(".") && !SKIP_DIRS.has(entry.name)) {
      const subdir = path.join(dir, entry.name);
      if (isDirectoryMup(subdir)) {
        // Directory-based MUP: treat index.html as the entry point, don't recurse
        results.push(path.join(subdir, "index.html"));
      } else {
        results.push(...scanHtmlFiles(subdir));
      }
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
    if (entry.isDirectory() && !entry.name.startsWith(".") && !SKIP_DIRS.has(entry.name)) {
      const subdir = path.join(dir, entry.name);
      if (isDirectoryMup(subdir)) {
        // Directory-based MUP: show as a single MUP entry, not a folder
        const indexPath = path.join(subdir, "index.html");
        const content = manager.resolveHtml(indexPath);
        try {
          const manifest = manager.parseManifest(content, indexPath);
          const catalogEntry = manager.getCatalog().find((e) => e.manifest.id === manifest.id);
          files.push({
            type: "file", name: manifest.name, id: manifest.id,
            description: manifest.description, active: catalogEntry?.active || false,
            multiInstance: manifest.multiInstance || false, isMup: true, ext: ".html",
          });
        } catch (err) {
          console.error(`[mup-mcp] Skipping directory MUP ${entry.name}: ${(err as Error).message}`);
          files.push({ type: "file", name: entry.name, isMup: false, ext: "" });
        }
      } else {
        const children = buildFolderTree(subdir, manager);
        folders.push({ type: "folder", name: entry.name, children });
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (ext === ".html") {
        const content = fs.readFileSync(path.join(dir, entry.name), "utf-8");
        try {
          const manifest = manager.parseManifest(content, path.join(dir, entry.name));
          const catalogEntry = manager.getCatalog().find((e) => e.manifest.id === manifest.id);
          files.push({
            type: "file", name: manifest.name, id: manifest.id,
            description: manifest.description, active: catalogEntry?.active || false,
            multiInstance: manifest.multiInstance || false, isMup: true, ext,
          });
        } catch (err) {
          if (content.includes("application/mup-manifest")) {
            console.error(`[mup-mcp] Skipping ${entry.name}: ${(err as Error).message}`);
          }
          files.push({ type: "file", name: entry.name, isMup: false, ext });
        }
      } else {
        files.push({ type: "file", name: entry.name, isMup: false, ext });
      }
    }
  }
  folders.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  return [...folders, ...files];
}
