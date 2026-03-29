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

  it("builds tree with folders and files", () => {
    const sub = path.join(tmpDir, "subdir");
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(sub, "nested.html"), "<html></html>");
    fs.writeFileSync(path.join(tmpDir, "root.txt"), "text");

    const tree = buildFolderTree(tmpDir, mgr);
    const folder = tree.find((n) => n.type === "folder" && n.name === "subdir");
    assert.ok(folder, "should contain a folder node for subdir");
    assert.ok(folder!.children!.some((c) => c.name === "nested.html"));

    const file = tree.find((n) => n.type === "file" && n.name === "root.txt");
    assert.ok(file, "should contain a file node for root.txt");
    assert.equal(file!.isMup, false);
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
    fs.mkdirSync(path.join(tmpDir, "zebra"));
    fs.writeFileSync(path.join(tmpDir, "alpha.html"), "<html></html>");

    const tree = buildFolderTree(tmpDir, mgr);
    assert.equal(tree[0].type, "folder");
    assert.equal(tree[0].name, "zebra");
    assert.equal(tree[1].type, "file");
  });
});
