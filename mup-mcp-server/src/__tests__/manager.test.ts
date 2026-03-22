import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MupManager } from "../manager.js";

const SAMPLE_HTML = `<!DOCTYPE html>
<html><head>
<script type="application/mup-manifest">
{
  "name": "Test MUP",
  "description": "A test MUP",
  "functions": [
    { "name": "doThing", "description": "Does a thing", "inputSchema": { "type": "object", "properties": { "x": { "type": "number" } } } }
  ],
  "multiInstance": true,
  "grid": { "minWidth": 1, "minHeight": 1 }
}
</script>
</head><body><p>Hello</p></body></html>`;

const SINGLE_HTML = `<!DOCTYPE html>
<html><head>
<script type="application/mup-manifest">
{
  "name": "Single MUP",
  "description": "Not multi-instance",
  "functions": []
}
</script>
</head><body></body></html>`;

describe("MupManager", () => {
  let mgr: MupManager;

  beforeEach(() => {
    mgr = new MupManager();
  });

  // ---- parseManifest ----

  describe("parseManifest", () => {
    it("parses a valid manifest", () => {
      const m = mgr.parseManifest(SAMPLE_HTML, "test.html");
      assert.equal(m.name, "Test MUP");
      assert.equal(m.description, "A test MUP");
      assert.equal(m.multiInstance, true);
      assert.equal(m.functions.length, 1);
      assert.equal(m.functions[0].name, "doThing");
      assert.equal(m.id, "mup-test");
    });

    it("throws on HTML without manifest", () => {
      assert.throws(() => mgr.parseManifest("<html><body></body></html>", "bad.html"), /No MUP manifest/);
    });

    it("throws on invalid JSON in manifest", () => {
      const badJson = `<script type="application/mup-manifest">{ bad json }</script>`;
      assert.throws(() => mgr.parseManifest(badJson, "bad.html"));
    });

    it("applies defaults for missing fields", () => {
      const m = mgr.parseManifest(SINGLE_HTML, "single.html");
      assert.equal(m.protocol, "mup/2026-03-17");
      assert.equal(m.version, "1.0.0");
      assert.equal(m.multiInstance, false);
    });
  });

  // ---- activate / deactivate ----

  describe("activate / deactivate", () => {
    it("activate returns null for unknown ID", () => {
      assert.equal(mgr.activate("nonexistent"), null);
    });

    it("loadFromHtml + deactivate lifecycle", () => {
      const manifest = mgr.loadFromHtml(SAMPLE_HTML, "test.html");
      assert.equal(mgr.isActive(manifest.id), true);

      mgr.deactivate(manifest.id);
      assert.equal(mgr.isActive(manifest.id), false);
    });

    it("scanFromHtml does not activate", () => {
      const manifest = mgr.scanFromHtml(SAMPLE_HTML, "test.html");
      assert.equal(mgr.isActive(manifest.id), false);

      const mup = mgr.activate(manifest.id);
      assert.notEqual(mup, null);
      assert.equal(mgr.isActive(manifest.id), true);
    });
  });

  // ---- activateInstance ----

  describe("activateInstance", () => {
    it("creates instance with _2 suffix", () => {
      mgr.scanFromHtml(SAMPLE_HTML, "test.html");
      mgr.activate("mup-test");

      const instance = mgr.activateInstance("mup-test");
      assert.notEqual(instance, null);
      assert.equal(instance!.manifest.id, "mup-test_2");
      assert.equal(instance!.manifest.name, "Test MUP #2");
    });

    it("increments instance number", () => {
      mgr.scanFromHtml(SAMPLE_HTML, "test.html");
      mgr.activate("mup-test");
      mgr.activateInstance("mup-test");

      const instance3 = mgr.activateInstance("mup-test");
      assert.equal(instance3!.manifest.id, "mup-test_3");
    });

    it("returns null for non-multiInstance MUP", () => {
      mgr.scanFromHtml(SINGLE_HTML, "single.html");
      mgr.activate("mup-single");

      assert.equal(mgr.activateInstance("mup-single"), null);
    });

    it("returns null for unknown MUP", () => {
      assert.equal(mgr.activateInstance("nonexistent"), null);
    });
  });

  // ---- activateInstanceWithId ----

  describe("activateInstanceWithId", () => {
    it("creates instance with specific ID", () => {
      mgr.scanFromHtml(SAMPLE_HTML, "test.html");
      mgr.activate("mup-test");

      const instance = mgr.activateInstanceWithId("mup-test", "mup-test_5");
      assert.notEqual(instance, null);
      assert.equal(instance!.manifest.id, "mup-test_5");
      assert.equal(instance!.manifest.name, "Test MUP #5");
    });

    it("returns null if instance ID already exists", () => {
      mgr.scanFromHtml(SAMPLE_HTML, "test.html");
      mgr.activate("mup-test");
      mgr.activateInstanceWithId("mup-test", "mup-test_2");

      assert.equal(mgr.activateInstanceWithId("mup-test", "mup-test_2"), null);
    });
  });

  // ---- state ----

  describe("state management", () => {
    it("updateState + getStateSnapshot", () => {
      mgr.loadFromHtml(SAMPLE_HTML, "test.html");
      mgr.updateState("mup-test", "counter is 5", { count: 5 });

      const snapshot = mgr.getStateSnapshot();
      assert.deepEqual(snapshot["mup-test"], { count: 5 });
    });

    it("getStateSnapshot excludes undefined state", () => {
      mgr.loadFromHtml(SAMPLE_HTML, "test.html");
      const snapshot = mgr.getStateSnapshot();
      assert.equal("mup-test" in snapshot, false);
    });
  });

  // ---- events ----

  describe("drainEvents", () => {
    it("drains all events when no since", () => {
      mgr.loadFromHtml(SAMPLE_HTML, "test.html");
      mgr.addEvent("mup-test", "click", "User clicked");
      mgr.addEvent("mup-test", "input", "User typed");

      const events = mgr.drainEvents();
      assert.equal(events.length, 2);
      assert.equal(events[0].action, "click");
      assert.equal(events[1].action, "input");

      // Events are consumed
      assert.equal(mgr.drainEvents().length, 0);
    });

    it("filters by since timestamp", () => {
      mgr.loadFromHtml(SAMPLE_HTML, "test.html");
      const t1 = Date.now();
      mgr.addEvent("mup-test", "old", "Old event");

      // Wait a tick to ensure different timestamp
      const mup = mgr.get("mup-test")!;
      mup.pendingEvents[0].timestamp = t1 - 100;
      mgr.addEvent("mup-test", "new", "New event");

      const events = mgr.drainEvents(t1 - 50);
      assert.equal(events.length, 1);
      assert.equal(events[0].action, "new");

      // Old event is still kept
      const remaining = mgr.drainEvents();
      assert.equal(remaining.length, 1);
      assert.equal(remaining[0].action, "old");
    });
  });

  // ---- deactivate with instances ----

  describe("deactivate with instances", () => {
    it("keeps catalog active when instances remain", () => {
      mgr.scanFromHtml(SAMPLE_HTML, "test.html");
      mgr.activate("mup-test");
      mgr.activateInstance("mup-test");

      mgr.deactivate("mup-test_2");
      // Base is still active
      assert.equal(mgr.isActive("mup-test"), true);

      const catalog = mgr.getCatalog();
      const entry = catalog.find(e => e.manifest.id === "mup-test");
      assert.equal(entry!.active, true);
    });

    it("marks catalog inactive when all instances removed", () => {
      mgr.scanFromHtml(SAMPLE_HTML, "test.html");
      mgr.activate("mup-test");
      mgr.activateInstance("mup-test");

      mgr.deactivate("mup-test");
      mgr.deactivate("mup-test_2");

      const catalog = mgr.getCatalog();
      const entry = catalog.find(e => e.manifest.id === "mup-test");
      assert.equal(entry!.active, false);
    });
  });

  // ---- getAll ----

  describe("getAll", () => {
    it("returns all active MUPs including instances", () => {
      mgr.scanFromHtml(SAMPLE_HTML, "test.html");
      mgr.activate("mup-test");
      mgr.activateInstance("mup-test");

      const all = mgr.getAll();
      assert.equal(all.length, 2);
      const ids = all.map(m => m.manifest.id).sort();
      assert.deepEqual(ids, ["mup-test", "mup-test_2"]);
    });
  });
});
