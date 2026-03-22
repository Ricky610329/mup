import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { MupManager } from "../manager.js";
import { WorkspaceManager } from "../workspace.js";

const SAMPLE_HTML = `<!DOCTYPE html>
<html><head>
<script type="application/mup-manifest">
{
  "name": "Test MUP",
  "description": "A test MUP",
  "functions": [],
  "multiInstance": true
}
</script>
</head><body></body></html>`;

const SAMPLE_HTML_B = `<!DOCTYPE html>
<html><head>
<script type="application/mup-manifest">
{
  "name": "Another MUP",
  "id": "mup-another",
  "description": "Another test MUP",
  "functions": []
}
</script>
</head><body></body></html>`;

// Use a temp directory for workspace files to avoid polluting real data
let tmpDir: string;
let origHome: string | undefined;

describe("WorkspaceManager", () => {
  let mgr: MupManager;
  let ws: WorkspaceManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mup-test-"));
    origHome = process.env.HOME || process.env.USERPROFILE;
    // Override HOME so workspace files go to temp dir
    process.env.HOME = tmpDir;
    process.env.USERPROFILE = tmpDir;

    mgr = new MupManager();
    ws = new WorkspaceManager(mgr);
    ws.setInstanceId("test");
  });

  afterEach(() => {
    if (origHome !== undefined) {
      process.env.HOME = origHome;
      process.env.USERPROFILE = origHome;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ---- save / load round-trip ----

  describe("save / load", () => {
    it("round-trips workspace data", () => {
      mgr.scanFromHtml(SAMPLE_HTML, "test.html");
      mgr.activate("mup-test");
      mgr.updateState("mup-test", "count=1", { count: 1 });
      ws.customNames["mup-test"] = "My Counter";
      ws.description = "Test workspace";

      ws.save("test-ws", "Test workspace");
      const data = ws.load("test-ws");

      assert.notEqual(data, null);
      assert.equal(data!.name, "test-ws");
      assert.equal(data!.description, "Test workspace");
      assert.deepEqual(data!.activeMups, ["mup-test"]);
      assert.deepEqual(data!.mupStates["mup-test"], { count: 1 });
      assert.equal(data!.customNames!["mup-test"], "My Counter");
    });

    it("returns null for nonexistent workspace", () => {
      assert.equal(ws.load("nonexistent"), null);
    });
  });

  // ---- save with multiInstance ----

  describe("save with instances", () => {
    it("saves instance IDs", () => {
      mgr.scanFromHtml(SAMPLE_HTML, "test.html");
      mgr.activate("mup-test");
      mgr.activateInstance("mup-test");
      mgr.updateState("mup-test", "base", { n: 1 });
      mgr.updateState("mup-test_2", "inst", { n: 2 });

      ws.save("inst-ws");
      const data = ws.load("inst-ws");

      assert.notEqual(data, null);
      assert.deepEqual(data!.activeMups.sort(), ["mup-test", "mup-test_2"]);
      assert.deepEqual(data!.mupStates["mup-test"], { n: 1 });
      assert.deepEqual(data!.mupStates["mup-test_2"], { n: 2 });
    });
  });

  // ---- restore with instances ----

  describe("restore with instances", () => {
    it("silentRestore restores instances with correct IDs", () => {
      // Setup: activate base + instance, save
      mgr.scanFromHtml(SAMPLE_HTML, "test.html");
      mgr.activate("mup-test");
      mgr.activateInstance("mup-test");
      mgr.updateState("mup-test", "base", { n: 1 });
      mgr.updateState("mup-test_2", "inst", { n: 2 });
      ws.customNames["mup-test_2"] = "Second Panel";
      ws.save("_last_test");

      // Teardown: deactivate all
      mgr.deactivate("mup-test_2");
      mgr.deactivate("mup-test");
      assert.equal(mgr.getAll().length, 0);

      // Restore
      const restored = ws.silentRestore();
      assert.equal(restored.length, 2);

      // Verify instances are back
      const all = mgr.getAll();
      assert.equal(all.length, 2);
      const ids = all.map(m => m.manifest.id).sort();
      assert.deepEqual(ids, ["mup-test", "mup-test_2"]);

      // Verify state was restored
      assert.deepEqual(mgr.get("mup-test")!.stateData, { n: 1 });
      assert.deepEqual(mgr.get("mup-test_2")!.stateData, { n: 2 });
    });
  });

  // ---- callHistory ----

  describe("callHistory", () => {
    it("stores and retrieves call history", () => {
      ws.addCallHistory("mup-test", "doThing", { x: 1 }, "done");
      ws.addCallHistory("mup-test", "doThing", { x: 2 }, "done again");

      assert.equal(ws.callHistory["mup-test"].length, 2);
      assert.equal(ws.callHistory["mup-test"][0].functionName, "doThing");
      assert.deepEqual(ws.callHistory["mup-test"][0].args, { x: 1 });
    });

    it("persists through save/load", () => {
      mgr.scanFromHtml(SAMPLE_HTML, "test.html");
      mgr.activate("mup-test");
      ws.addCallHistory("mup-test", "fn1", {}, "result1");

      ws.save("hist-ws");

      // Create new workspace manager and load
      const ws2 = new WorkspaceManager(mgr);
      ws2.setInstanceId("test");
      const data = ws2.load("hist-ws");

      assert.notEqual(data, null);
      assert.equal(data!.callHistory["mup-test"].length, 1);
      assert.equal(data!.callHistory["mup-test"][0].functionName, "fn1");
    });
  });

  // ---- list / delete ----

  describe("list / delete", () => {
    it("lists saved workspaces excluding _last", () => {
      mgr.scanFromHtml(SAMPLE_HTML, "test.html");
      mgr.activate("mup-test");

      ws.save("_last_test");
      ws.save("my-workspace");
      ws.save("another-ws");

      const list = ws.list();
      const names = list.map(w => w.name);
      assert.ok(names.includes("my-workspace"));
      assert.ok(names.includes("another-ws"));
      assert.ok(!names.some(n => n.startsWith("_last")));
    });

    it("deletes workspace", () => {
      mgr.scanFromHtml(SAMPLE_HTML, "test.html");
      mgr.activate("mup-test");
      ws.save("to-delete");

      assert.equal(ws.delete("to-delete"), true);
      assert.equal(ws.load("to-delete"), null);
      assert.equal(ws.delete("to-delete"), false);
    });
  });

  // ---- reset ----

  describe("reset", () => {
    it("clears all workspace state", () => {
      ws.callHistory["test"] = [{ functionName: "f", args: {}, result: "r", timestamp: 0 }];
      ws.customNames["test"] = "Custom";
      ws.description = "Desc";
      ws.gridLayout = [{ id: "x", x: 0, y: 0, w: 1, h: 1 }];
      ws.currentName = "ws1";

      ws.reset();

      assert.deepEqual(Object.keys(ws.callHistory), []);
      assert.deepEqual(Object.keys(ws.customNames), []);
      assert.equal(ws.description, "");
      assert.equal(ws.gridLayout.length, 0);
      assert.equal(ws.currentName, null);
    });
  });

  // ---- markDirty / flushSave ----

  describe("markDirty / flushSave", () => {
    it("flushSave saves immediately when dirty", () => {
      mgr.scanFromHtml(SAMPLE_HTML, "test.html");
      mgr.activate("mup-test");

      ws.markDirty();
      ws.flushSave();

      const data = ws.load("_last_test");
      assert.notEqual(data, null);
      assert.deepEqual(data!.activeMups, ["mup-test"]);
    });

    it("flushSave is no-op when not dirty", () => {
      // Ensure no MUPs are active and delete any leftover file
      for (const m of mgr.getAll()) mgr.deactivate(m.manifest.id);
      ws.delete("_last_test");

      ws.flushSave();
      // autoSave skips when no active MUPs and not dirty
      assert.equal(ws.load("_last_test"), null);
    });
  });
});
