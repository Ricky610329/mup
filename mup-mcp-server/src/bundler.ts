import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Bundle a directory-based MUP into a single HTML string.
 * Resolves local <link rel="stylesheet"> and <script src=""> references
 * by inlining their file contents. External URLs are left untouched.
 */
export function bundleHtml(indexPath: string): string {
  const dir = path.dirname(indexPath);
  let html = fs.readFileSync(indexPath, "utf-8");

  // Inline <link rel="stylesheet" href="./...">
  html = html.replace(
    /<link\s+[^>]*rel=["']stylesheet["'][^>]*href=["'](\.[^"']+)["'][^>]*\/?>/gi,
    (tag, href: string) => inlineCss(dir, href, tag),
  );
  // Also match href before rel
  html = html.replace(
    /<link\s+[^>]*href=["'](\.[^"']+)["'][^>]*rel=["']stylesheet["'][^>]*\/?>/gi,
    (tag, href: string) => inlineCss(dir, href, tag),
  );

  // Inline <script src="./..."></script>
  html = html.replace(
    /<script\s+[^>]*src=["'](\.[^"']+)["'][^>]*><\/script>/gi,
    (tag, src: string) => inlineJs(dir, src, tag),
  );

  return html;
}

function isRelativePath(ref: string): boolean {
  return ref.startsWith("./") || ref.startsWith("../");
}

function isEscaping(dir: string, ref: string): boolean {
  const resolved = path.resolve(dir, ref);
  return !resolved.startsWith(dir + path.sep) && resolved !== dir;
}

function inlineCss(dir: string, href: string, originalTag: string): string {
  if (!isRelativePath(href)) return originalTag;
  if (isEscaping(dir, href)) {
    console.error(`[mup-mcp] Bundler: skipping "${href}" — escapes MUP directory`);
    return originalTag;
  }
  const filePath = path.resolve(dir, href);
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return `<style>\n${content}\n</style>`;
  } catch {
    console.error(`[mup-mcp] Bundler: file not found "${filePath}"`);
    return originalTag;
  }
}

function inlineJs(dir: string, src: string, originalTag: string): string {
  if (!isRelativePath(src)) return originalTag;
  if (isEscaping(dir, src)) {
    console.error(`[mup-mcp] Bundler: skipping "${src}" — escapes MUP directory`);
    return originalTag;
  }
  const filePath = path.resolve(dir, src);
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return `<script>\n${content}\n</script>`;
  } catch {
    console.error(`[mup-mcp] Bundler: file not found "${filePath}"`);
    return originalTag;
  }
}

/** Check if a directory is a directory-based MUP (has index.html with manifest). */
export function isDirectoryMup(dir: string): boolean {
  const indexPath = path.join(dir, "index.html");
  if (!fs.existsSync(indexPath)) return false;
  try {
    const content = fs.readFileSync(indexPath, "utf-8");
    return /application\/mup-manifest/.test(content);
  } catch {
    return false;
  }
}
