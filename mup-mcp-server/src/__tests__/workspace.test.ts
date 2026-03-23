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

let tmpDir: string;

describe("WorkspaceManager (folder-based)", () => {
  let mgr: MupManager;
  let ws: WorkspaceManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mup-test-"));
    // Write a sample MUP file into the temp dir
    fs.writeFileSync(path.join(tmpDir, "test.html"), SAMPLE_HTML);

    mgr = new MupManager();
    mgr.scanFile(path.join(tmpDir, "test.html"));
    ws = new WorkspaceManager(mgr, tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ---- metadata save/restore ----

  describe("metadata save/restore", () => {
    it("saves and restores active MUPs", () => {
      mgr.activate("mup-test");
      mgr.updateState("mup-test", "count=1", { count: 1 });
      ws.customNames["mup-test"] = "My Counter";

      // Flush saves metadata + state
      ws.markMetadataDirty();
      ws.markMupDirty("mup-test");
      ws.flushSave();

      // Verify .mup/ directory was created
      assert.ok(fs.existsSync(path.join(tmpDir, ".mup")));
      assert.ok(fs.existsSync(path.join(tmpDir, ".mup", "workspace.json")));
      assert.ok(fs.existsSync(path.join(tmpDir, ".mup", "state", "mup-test.json")));

      // Teardown and restore
      mgr.deactivate("mup-test");
      assert.equal(mgr.getAll().length, 0);

      const ws2 = new WorkspaceManager(mgr, tmpDir);
      const restored = ws2.restoreFromDisk();

      assert.equal(restored.length, 1);
      assert.equal(mgr.getAll().length, 1);
      assert.deepEqual(mgr.get("mup-test")!.stateData, { count: 1 });
      assert.equal(ws2.customNames["mup-test"], "My Counter");
    });

    it("restores empty when no .mup/ exists", () => {
      const ws2 = new WorkspaceManager(mgr, tmpDir);
      const restored = ws2.restoreFromDisk();
      assert.equal(restored.length, 0);
    });

    it("saves and restores workspace name", () => {
      mgr.activate("mup-test");
      ws.name = "My Project";
      ws.markMetadataDirty();
      ws.flushSave();

      // Verify name in workspace.json
      const meta = JSON.parse(fs.readFileSync(path.join(tmpDir, ".mup", "workspace.json"), "utf-8"));
      assert.equal(meta.name, "My Project");

      // Restore and verify
      mgr.deactivate("mup-test");
      const ws2 = new WorkspaceManager(mgr, tmpDir);
      ws2.restoreFromDisk();
      assert.equal(ws2.name, "My Project");
    });

    it("omits name from metadata when empty", () => {
      mgr.activate("mup-test");
      ws.name = "";
      ws.markMetadataDirty();
      ws.flushSave();

      const meta = JSON.parse(fs.readFileSync(path.join(tmpDir, ".mup", "workspace.json"), "utf-8"));
      assert.equal(meta.name, undefined);
    });
  });

  // ---- per-MUP state files ----

  describe("per-MUP state", () => {
    it("writes individual state files", () => {
      mgr.activate("mup-test");
      mgr.updateState("mup-test", "val=42", { value: 42 });

      ws.markMupDirty("mup-test");
      ws.flushSave();

      const stateFile = path.join(tmpDir, ".mup", "state", "mup-test.json");
      assert.ok(fs.existsSync(stateFile));
      const data = JSON.parse(fs.readFileSync(stateFile, "utf-8"));
      assert.equal(data.mupId, "mup-test");
      assert.deepEqual(data.data, { value: 42 });
    });

    it("deletes state file on deactivation", () => {
      mgr.activate("mup-test");
      mgr.updateState("mup-test", "val=1", { v: 1 });
      ws.markMupDirty("mup-test");
      ws.markMetadataDirty();
      ws.flushSave();

      const stateFile = path.join(tmpDir, ".mup", "state", "mup-test.json");
      assert.ok(fs.existsSync(stateFile));

      mgr.deactivate("mup-test");
      ws.onMupDeactivated("mup-test");
      ws.flushSave();

      assert.ok(!fs.existsSync(stateFile));
    });
  });

  // ---- multiInstance ----

  describe("multiInstance", () => {
    it("saves and restores instances", () => {
      mgr.activate("mup-test");
      mgr.activateInstance("mup-test");
      mgr.updateState("mup-test", "base", { n: 1 });
      mgr.updateState("mup-test_2", "inst", { n: 2 });
      ws.customNames["mup-test_2"] = "Second Panel";

      ws.markMetadataDirty();
      ws.markMupDirty("mup-test");
      ws.markMupDirty("mup-test_2");
      ws.flushSave();

      // Teardown
      mgr.deactivate("mup-test_2");
      mgr.deactivate("mup-test");
      assert.equal(mgr.getAll().length, 0);

      // Restore
      const ws2 = new WorkspaceManager(mgr, tmpDir);
      const restored = ws2.restoreFromDisk();

      assert.equal(restored.length, 2);
      const ids = mgr.getAll().map(m => m.manifest.id).sort();
      assert.deepEqual(ids, ["mup-test", "mup-test_2"]);
      assert.deepEqual(mgr.get("mup-test")!.stateData, { n: 1 });
      assert.deepEqual(mgr.get("mup-test_2")!.stateData, { n: 2 });
    });
  });

  // ---- callHistory (session-only) ----

  describe("callHistory", () => {
    it("stores call history in session", () => {
      ws.addCallHistory("mup-test", "doThing", { x: 1 }, "done");
      ws.addCallHistory("mup-test", "doThing", { x: 2 }, "done again");

      assert.equal(ws.callHistory["mup-test"].length, 2);
      assert.equal(ws.callHistory["mup-test"][0].functionName, "doThing");
    });

    it("is NOT persisted to disk", () => {
      mgr.activate("mup-test");
      ws.addCallHistory("mup-test", "fn1", {}, "result1");
      ws.markMetadataDirty();
      ws.flushSave();

      // Check workspace.json does not contain callHistory
      const meta = JSON.parse(fs.readFileSync(path.join(tmpDir, ".mup", "workspace.json"), "utf-8"));
      assert.equal(meta.callHistory, undefined);
    });
  });

  // ---- gridLayout persistence ----

  describe("gridLayout", () => {
    it("saves and restores grid layout", () => {
      mgr.activate("mup-test");
      ws.gridLayout = [{ id: "mup-test", x: 0, y: 0, w: 2, h: 2 }];
      ws.markMetadataDirty();
      ws.flushSave();

      const ws2 = new WorkspaceManager(mgr, tmpDir);
      ws2.restoreFromDisk();
      assert.equal(ws2.gridLayout.length, 1);
      assert.equal(ws2.gridLayout[0].id, "mup-test");
    });
  });

  // ---- flushSave ----

  describe("flushSave", () => {
    it("is no-op when nothing is dirty", () => {
      ws.flushSave();
      assert.ok(!fs.existsSync(path.join(tmpDir, ".mup", "workspace.json")));
    });

    it("saves metadata immediately when dirty", () => {
      mgr.activate("mup-test");
      ws.markMetadataDirty();
      ws.flushSave();

      assert.ok(fs.existsSync(path.join(tmpDir, ".mup", "workspace.json")));
      const meta = JSON.parse(fs.readFileSync(path.join(tmpDir, ".mup", "workspace.json"), "utf-8"));
      assert.deepEqual(meta.activeMups, ["mup-test"]);
      assert.equal(meta.version, 1);
    });
  });

  // ---- saveAs ----

  describe("saveAs", () => {
    it("copies MUP files and state to target folder", () => {
      mgr.activate("mup-test");
      mgr.updateState("mup-test", "val=5", { value: 5 });
      ws.customNames["mup-test"] = "Saved Counter";
      ws.gridLayout = [{ id: "mup-test", x: 0, y: 0, w: 2, h: 2 }];
      ws.markMupDirty("mup-test");
      ws.markMetadataDirty();
      ws.flushSave();

      // saveAs to a new folder
      const targetDir = path.join(tmpDir, "exported");
      const result = ws.saveAs(targetDir);

      assert.equal(result.error, undefined);
      assert.equal(result.copied.length, 1);
      assert.ok(result.copied[0].includes("test.html"));

      // Verify files exist in target
      assert.ok(fs.existsSync(path.join(targetDir, "test.html")));
      assert.ok(fs.existsSync(path.join(targetDir, ".mup", "workspace.json")));
      assert.ok(fs.existsSync(path.join(targetDir, ".mup", "state", "mup-test.json")));

      // Verify content
      const meta = JSON.parse(fs.readFileSync(path.join(targetDir, ".mup", "workspace.json"), "utf-8"));
      assert.deepEqual(meta.activeMups, ["mup-test"]);
      assert.equal(meta.customNames["mup-test"], "Saved Counter");
      assert.equal(meta.gridLayout.length, 1);

      const state = JSON.parse(fs.readFileSync(path.join(targetDir, ".mup", "state", "mup-test.json"), "utf-8"));
      assert.deepEqual(state.data, { value: 5 });
    });

    it("switches auto-save target to new folder", () => {
      mgr.activate("mup-test");
      mgr.updateState("mup-test", "v=1", { v: 1 });

      const targetDir = path.join(tmpDir, "new-workspace");
      ws.saveAs(targetDir);

      // Update state and flush — should save to new location
      mgr.updateState("mup-test", "v=2", { v: 2 });
      ws.markMupDirty("mup-test");
      ws.flushSave();

      const state = JSON.parse(fs.readFileSync(path.join(targetDir, ".mup", "state", "mup-test.json"), "utf-8"));
      assert.deepEqual(state.data, { v: 2 });
      assert.equal(ws.getMupsDir(), targetDir);
    });

    it("is restorable from target folder", () => {
      mgr.activate("mup-test");
      mgr.updateState("mup-test", "data=42", { data: 42 });

      const targetDir = path.join(tmpDir, "portable");
      ws.saveAs(targetDir);

      // Deactivate everything
      mgr.deactivate("mup-test");
      assert.equal(mgr.getAll().length, 0);

      // Restore from target — need to re-scan MUPs from target dir
      const mgr2 = new MupManager();
      mgr2.scanFile(path.join(targetDir, "test.html"));
      const ws2 = new WorkspaceManager(mgr2, targetDir);
      const restored = ws2.restoreFromDisk();

      assert.equal(restored.length, 1);
      assert.deepEqual(mgr2.get("mup-test")!.stateData, { data: 42 });
    });
  });
});
