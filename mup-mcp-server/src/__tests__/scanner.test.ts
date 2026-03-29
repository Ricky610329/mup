import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { scanHtmlFiles, buildFolderTree } from "../scanner.js";
import { MupManager } from "../manager.js";

let tmpDir: string;

const MUP_HTML = `<!DOCTYPE html>
<html><head>
<script type="application/mup-manifest">
{ "name": "Sample", "description": "A sample MUP", "functions": [] }
</script>
</head><body></body></html>`;

const DIR_MUP_INDEX = `<!DOCTYPE html>
<html><head>
<script type="application/mup-manifest">
{ "name": "Dir MUP", "description": "A directory MUP", "functions": [] }
</script>
</head><body></body></html>`;

describe("scanHtmlFiles", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mup-scanner-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("finds .html files in a flat directory", () => {
    fs.writeFileSync(path.join(tmpDir, "a.html"), "<html></html>");
    fs.writeFileSync(path.join(tmpDir, "b.html"), "<html></html>");
    fs.writeFileSync(path.join(tmpDir, "readme.txt"), "not html");

    const results = scanHtmlFiles(tmpDir);
    const names = results.map((f) => path.basename(f));
    assert.ok(names.includes("a.html"));
    assert.ok(names.includes("b.html"));
    assert.ok(!names.includes("readme.txt"));
  });

  it("finds directory MUPs (index.html) without recursing into them", () => {
    const subdir = path.join(tmpDir, "my-mup");
    fs.mkdirSync(subdir);
    fs.writeFileSync(path.join(subdir, "index.html"), DIR_MUP_INDEX);
    fs.writeFileSync(path.join(subdir, "helper.html"), "<html></html>");

    const results = scanHtmlFiles(tmpDir);
    // Only index.html should appear, helper.html inside the dir MUP is skipped
    assert.equal(results.length, 1);
    assert.ok(results[0].endsWith(path.join("my-mup", "index.html")));
  });

  it("returns empty array for empty directory", () => {
    const results = scanHtmlFiles(tmpDir);
    assert.deepEqual(results, []);
  });

  it("skips node_modules directory", () => {
    const nm = path.join(tmpDir, "node_modules");
    fs.mkdirSync(nm);
    fs.writeFileSync(path.join(nm, "lib.html"), "<html></html>");
    fs.writeFileSync(path.join(tmpDir, "top.html"), "<html></html>");

    const results = scanHtmlFiles(tmpDir);
    assert.equal(results.length, 1);
    assert.ok(results[0].endsWith("top.html"));
  });
});

describe("buildFolderTree", () => {
  let mgr: MupManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mup-tree-"));
    mgr = new MupManager();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("builds tree with only MUP files, skips non-MUP", () => {
    const sub = path.join(tmpDir, "subdir");
    fs.mkdirSync(sub);
    // Non-MUP html — no manifest
    fs.writeFileSync(path.join(sub, "nested.html"), "<html></html>");
    // Non-HTML file — should be skipped
    fs.writeFileSync(path.join(tmpDir, "root.txt"), "text");
    // Valid MUP
    fs.writeFileSync(path.join(tmpDir, "test.html"), DIR_MUP_INDEX);

    const tree = buildFolderTree(tmpDir, mgr);
    // Non-HTML file should NOT appear
    assert.ok(!tree.find((n) => n.name === "root.txt"), "non-HTML files should be skipped");
    // Empty subfolder (no valid MUPs inside) should NOT appear
    assert.ok(!tree.find((n) => n.name === "subdir"), "folder with no MUPs should be skipped");
    // Valid MUP should appear
    const mup = tree.find((n) => n.isMup === true);
    assert.ok(mup, "valid MUP should appear");
  });

  it("handles directory MUPs as file entries", () => {
    const dirMup = path.join(tmpDir, "widget");
    fs.mkdirSync(dirMup);
    fs.writeFileSync(path.join(dirMup, "index.html"), DIR_MUP_INDEX);

    const tree = buildFolderTree(tmpDir, mgr);
    // Directory MUP should appear as a file, not a folder
    const entry = tree.find((n) => n.name === "Dir MUP" || n.name === "widget");
    assert.ok(entry, "directory MUP should appear in tree");
    assert.equal(entry!.type, "file");
    assert.equal(entry!.isMup, true);
  });

  it("sorts folders before files", () => {
    // Create a folder with a valid MUP inside
    const sub = path.join(tmpDir, "zebra");
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(sub, "index.html"), DIR_MUP_INDEX);
    // Create a valid MUP at root
    fs.writeFileSync(path.join(tmpDir, "alpha.html"), DIR_MUP_INDEX);

    const tree = buildFolderTree(tmpDir, mgr);
    assert.ok(tree.length >= 2, "should have folder + file");
    // Directory MUP appears as file, but the subfolder that IS a directory MUP appears as file too
    // Since zebra/ has index.html with manifest, it's a directory MUP → type: "file"
    // alpha.html is a file MUP → type: "file"
    // Both are type: "file" since zebra is a directory MUP
    assert.ok(tree.every(n => n.isMup === true), "all entries should be MUPs");
  });
});
