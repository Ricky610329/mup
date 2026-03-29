import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { bundleHtml, isDirectoryMup } from "../bundler.js";

let tmpDir: string;

const MANIFEST_SCRIPT = `<script type="application/mup-manifest">
{ "name": "Test", "description": "test", "functions": [] }
</script>`;

describe("bundleHtml", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mup-bundler-"));

    // Create local CSS file
    fs.writeFileSync(path.join(tmpDir, "style.css"), "body { color: red; }");

    // Create local JS file
    fs.writeFileSync(path.join(tmpDir, "app.js"), "console.log('hello');");

    // Create index.html referencing local CSS and JS
    fs.writeFileSync(
      path.join(tmpDir, "index.html"),
      `<!DOCTYPE html>
<html><head>
${MANIFEST_SCRIPT}
<link rel="stylesheet" href="./style.css">
</head><body>
<script src="./app.js"></script>
</body></html>`,
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("inlines local CSS into <style> tags", () => {
    const result = bundleHtml(path.join(tmpDir, "index.html"));
    assert.ok(result.includes("<style>"));
    assert.ok(result.includes("body { color: red; }"));
    assert.ok(!result.includes('href="./style.css"'));
  });

  it("inlines local JS into <script> tags", () => {
    const result = bundleHtml(path.join(tmpDir, "index.html"));
    assert.ok(result.includes("<script>\nconsole.log('hello');"));
    assert.ok(!result.includes('src="./app.js"'));
  });

  it("preserves external CDN URLs for CSS", () => {
    fs.writeFileSync(
      path.join(tmpDir, "cdn.html"),
      `<!DOCTYPE html><html><head>
<link rel="stylesheet" href="https://cdn.example.com/lib.css">
</head><body></body></html>`,
    );
    const result = bundleHtml(path.join(tmpDir, "cdn.html"));
    assert.ok(result.includes('href="https://cdn.example.com/lib.css"'));
  });

  it("preserves external CDN URLs for JS", () => {
    fs.writeFileSync(
      path.join(tmpDir, "cdn.html"),
      `<!DOCTYPE html><html><head></head><body>
<script src="https://cdn.example.com/lib.js"></script>
</body></html>`,
    );
    const result = bundleHtml(path.join(tmpDir, "cdn.html"));
    assert.ok(result.includes('src="https://cdn.example.com/lib.js"'));
  });

  it("blocks path traversal in CSS href", () => {
    fs.writeFileSync(
      path.join(tmpDir, "traversal.html"),
      `<!DOCTYPE html><html><head>
<link rel="stylesheet" href="../../../etc/passwd">
</head><body></body></html>`,
    );
    const result = bundleHtml(path.join(tmpDir, "traversal.html"));
    // Original tag preserved — not inlined
    assert.ok(result.includes('href="../../../etc/passwd"'));
    assert.ok(!result.includes("<style>"));
  });

  it("blocks path traversal in JS src", () => {
    fs.writeFileSync(
      path.join(tmpDir, "traversal.html"),
      `<!DOCTYPE html><html><head></head><body>
<script src="../../../etc/passwd"></script>
</body></html>`,
    );
    const result = bundleHtml(path.join(tmpDir, "traversal.html"));
    assert.ok(result.includes('src="../../../etc/passwd"'));
  });

  it("handles missing CSS file gracefully", () => {
    fs.writeFileSync(
      path.join(tmpDir, "missing.html"),
      `<!DOCTYPE html><html><head>
<link rel="stylesheet" href="./nonexistent.css">
</head><body></body></html>`,
    );
    const result = bundleHtml(path.join(tmpDir, "missing.html"));
    // Original tag kept when file is missing
    assert.ok(result.includes('href="./nonexistent.css"'));
  });

  it("handles missing JS file gracefully", () => {
    fs.writeFileSync(
      path.join(tmpDir, "missing.html"),
      `<!DOCTYPE html><html><head></head><body>
<script src="./nonexistent.js"></script>
</body></html>`,
    );
    const result = bundleHtml(path.join(tmpDir, "missing.html"));
    assert.ok(result.includes('src="./nonexistent.js"'));
  });
});

describe("isDirectoryMup", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mup-dirmup-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns true when index.html contains mup-manifest", () => {
    fs.writeFileSync(
      path.join(tmpDir, "index.html"),
      `<!DOCTYPE html><html><head>${MANIFEST_SCRIPT}</head><body></body></html>`,
    );
    assert.ok(isDirectoryMup(tmpDir));
  });

  it("returns false when directory has no index.html", () => {
    assert.equal(isDirectoryMup(tmpDir), false);
  });

  it("returns false when index.html has no manifest", () => {
    fs.writeFileSync(path.join(tmpDir, "index.html"), "<html><body>plain</body></html>");
    assert.equal(isDirectoryMup(tmpDir), false);
  });
});
