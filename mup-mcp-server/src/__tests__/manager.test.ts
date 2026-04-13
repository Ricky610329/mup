import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { MupManager } from "../manager.js";
import { CONFIG } from "../config.js";
import type { MupManifest } from "../types.js";

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

const NOTIFY_HTML = `<!DOCTYPE html>
<html><head>
<script type="application/mup-manifest">
{
  "name": "Notify MUP",
  "description": "Has notification settings",
  "functions": [],
  "notifications": { "level": "immediate", "overridable": true }
}
</script>
</head><body></body></html>`;

const FIXED_NOTIFY_HTML = `<!DOCTYPE html>
<html><head>
<script type="application/mup-manifest">
{
  "name": "Fixed Notify MUP",
  "description": "Non-overridable notifications",
  "functions": [],
  "notifications": { "level": "silent", "overridable": false }
}
</script>
</head><body></body></html>`;

const PERMISSIONS_HTML = `<!DOCTYPE html>
<html><head>
<script type="application/mup-manifest">
{
  "name": "Perms MUP",
  "description": "Has permissions",
  "functions": [],
  "permissions": ["clipboard", "camera"]
}
</script>
</head><body></body></html>`;

const DARKMODE_HTML = `<!DOCTYPE html>
<html><head>
<script type="application/mup-manifest">
{
  "name": "Dark MUP",
  "description": "Dark mode enabled",
  "functions": [],
  "darkMode": true
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
    it("updateState stores summary", () => {
      mgr.loadFromHtml(SAMPLE_HTML, "test.html");
      mgr.updateState("mup-test", "counter is 5");
      const mup = mgr.get("mup-test");
      assert.equal(mup?.stateSummary, "counter is 5");
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

      // Set old event to an earlier timestamp
      const mup = mgr.get("mup-test")!;
      mup.pendingEvents[0].timestamp = t1 - 100;
      mgr.addEvent("mup-test", "new", "New event");

      // Only returns events newer than since; old events are discarded
      const events = mgr.drainEvents(t1 - 50);
      assert.equal(events.length, 1);
      assert.equal(events[0].action, "new");

      // Old events (timestamp <= since) remain in queue; only returned events were drained
      const remaining = mgr.drainEvents();
      assert.equal(remaining.length, 1);
      assert.equal(remaining[0].action, "old");
    });

    it("drainEvents without since drains all events", () => {
      mgr.loadFromHtml(SAMPLE_HTML, "test.html");
      mgr.addEvent("mup-test", "a", "Event A");
      mgr.addEvent("mup-test", "b", "Event B");

      const events = mgr.drainEvents();
      assert.equal(events.length, 2);

      const remaining = mgr.drainEvents();
      assert.equal(remaining.length, 0);
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

  // ---- findByFilePath ----

  describe("findByFilePath", () => {
    it("returns correct entry for known path", () => {
      mgr.scanFromHtml(SAMPLE_HTML, "/mups/test.html");
      const entry = mgr.findByFilePath("/mups/test.html");
      assert.notEqual(entry, undefined);
      assert.equal(entry!.manifest.id, "mup-test");
    });

    it("returns undefined for unknown path", () => {
      mgr.scanFromHtml(SAMPLE_HTML, "/mups/test.html");
      assert.equal(mgr.findByFilePath("/mups/other.html"), undefined);
    });
  });

  // ---- removeCatalogEntry ----

  describe("removeCatalogEntry", () => {
    it("removes entry and returns true", () => {
      mgr.scanFromHtml(SAMPLE_HTML, "test.html");
      assert.equal(mgr.getCatalog().length, 1);

      assert.equal(mgr.removeCatalogEntry("mup-test"), true);
      assert.equal(mgr.getCatalog().length, 0);
    });

    it("returns false for unknown ID", () => {
      assert.equal(mgr.removeCatalogEntry("nonexistent"), false);
    });
  });

  // ---- getNotificationLevel ----

  describe("getNotificationLevel", () => {
    it("returns default 'notify' when manifest has no notifications", () => {
      mgr.loadFromHtml(SINGLE_HTML, "single.html");
      assert.equal(mgr.getNotificationLevel("mup-single"), "notify");
    });

    it("returns level from manifest notifications", () => {
      mgr.loadFromHtml(NOTIFY_HTML, "notify.html");
      assert.equal(mgr.getNotificationLevel("mup-notify"), "immediate");
    });

    it("returns override level when set", () => {
      mgr.loadFromHtml(NOTIFY_HTML, "notify.html");
      mgr.setNotificationLevel("mup-notify", "silent");
      assert.equal(mgr.getNotificationLevel("mup-notify"), "silent");
    });

    it("returns 'notify' for unknown MUP", () => {
      assert.equal(mgr.getNotificationLevel("nonexistent"), "notify");
    });

    it("falls back to catalog entry for instance MUPs", () => {
      mgr.scanFromHtml(NOTIFY_HTML, "notify.html");
      // Catalog entry has level "immediate" — instance ID like mup-notify_2
      // should resolve via the base ID from catalog
      assert.equal(mgr.getNotificationLevel("mup-notify_2"), "immediate");
    });
  });

  // ---- setNotificationLevel ----

  describe("setNotificationLevel", () => {
    it("sets valid level and returns null", () => {
      mgr.loadFromHtml(NOTIFY_HTML, "notify.html");
      const err = mgr.setNotificationLevel("mup-notify", "silent");
      assert.equal(err, null);
      assert.equal(mgr.getNotificationLevel("mup-notify"), "silent");
    });

    it("rejects non-overridable MUP", () => {
      mgr.loadFromHtml(FIXED_NOTIFY_HTML, "fixed-notify.html");
      const err = mgr.setNotificationLevel("mup-fixed-notify", "immediate");
      assert.notEqual(err, null);
      assert.match(err!, /cannot be changed/);
      // Level should remain unchanged
      assert.equal(mgr.getNotificationLevel("mup-fixed-notify"), "silent");
    });

    it("returns error for unknown MUP", () => {
      const err = mgr.setNotificationLevel("nonexistent", "silent");
      assert.notEqual(err, null);
      assert.match(err!, /not found/);
    });

    it("allows override when manifest has no notifications field", () => {
      mgr.loadFromHtml(SINGLE_HTML, "single.html");
      const err = mgr.setNotificationLevel("mup-single", "immediate");
      assert.equal(err, null);
      assert.equal(mgr.getNotificationLevel("mup-single"), "immediate");
    });
  });

  // ---- clearCatalog ----

  describe("clearCatalog", () => {
    it("clears all entries", () => {
      mgr.scanFromHtml(SAMPLE_HTML, "test.html");
      mgr.scanFromHtml(SINGLE_HTML, "single.html");
      assert.equal(mgr.getCatalog().length, 2);

      mgr.clearCatalog();
      assert.equal(mgr.getCatalog().length, 0);
    });

    it("is idempotent on empty catalog", () => {
      mgr.clearCatalog();
      assert.equal(mgr.getCatalog().length, 0);
    });
  });

  // ---- isMultiInstance ----

  describe("isMultiInstance", () => {
    it("returns true for multi-instance MUP", () => {
      mgr.scanFromHtml(SAMPLE_HTML, "test.html");
      assert.equal(mgr.isMultiInstance("mup-test"), true);
    });

    it("returns false for single-instance MUP", () => {
      mgr.scanFromHtml(SINGLE_HTML, "single.html");
      assert.equal(mgr.isMultiInstance("mup-single"), false);
    });

    it("returns false for unknown MUP", () => {
      assert.equal(mgr.isMultiInstance("nonexistent"), false);
    });

    it("resolves base ID from instance ID", () => {
      mgr.scanFromHtml(SAMPLE_HTML, "test.html");
      // mup-test_3 should strip to mup-test and find the catalog entry
      assert.equal(mgr.isMultiInstance("mup-test_3"), true);
    });
  });

  // ---- registerSystemMup / isSystemMup ----

  describe("registerSystemMup / isSystemMup", () => {
    const sysManifest: MupManifest = {
      protocol: "mup/2026-03-17",
      id: "mup-system",
      name: "System MUP",
      version: "1.0.0",
      description: "A system MUP",
      functions: [{ name: "ping", description: "Ping", inputSchema: { type: "object", properties: {} } }],
      multiInstance: false,
      darkMode: false,
    };

    it("registers a system MUP and marks it as system", () => {
      mgr.registerSystemMup(sysManifest);
      assert.equal(mgr.isSystemMup("mup-system"), true);
    });

    it("returns false for non-system MUP", () => {
      assert.equal(mgr.isSystemMup("mup-test"), false);
    });

    it("system MUP is immediately active", () => {
      mgr.registerSystemMup(sysManifest);
      assert.equal(mgr.isActive("mup-system"), true);
    });

    it("system MUP appears in getAll()", () => {
      mgr.registerSystemMup(sysManifest);
      const all = mgr.getAll();
      assert.equal(all.some(m => m.manifest.id === "mup-system"), true);
    });

    it("system MUP is retrievable via get()", () => {
      mgr.registerSystemMup(sysManifest);
      const mup = mgr.get("mup-system");
      assert.notEqual(mup, undefined);
      assert.equal(mup!.manifest.name, "System MUP");
      assert.equal(mup!.filePath, "__system__");
    });

    it("system MUP cannot be deactivated", () => {
      mgr.registerSystemMup(sysManifest);
      mgr.deactivate("mup-system");
      assert.equal(mgr.isActive("mup-system"), true);
    });

    it("activate returns existing system MUP without catalog entry", () => {
      mgr.registerSystemMup(sysManifest);
      const result = mgr.activate("mup-system");
      assert.notEqual(result, null);
      assert.equal(result!.manifest.id, "mup-system");
    });
  });

  // ---- parseManifest edge cases ----

  describe("parseManifest edge cases", () => {
    it("parses notifications field", () => {
      const m = mgr.parseManifest(NOTIFY_HTML, "notify.html");
      assert.deepEqual(m.notifications, { level: "immediate", overridable: true });
    });

    it("parses non-overridable notifications", () => {
      const m = mgr.parseManifest(FIXED_NOTIFY_HTML, "fixed-notify.html");
      assert.deepEqual(m.notifications, { level: "silent", overridable: false });
    });

    it("parses permissions field", () => {
      const m = mgr.parseManifest(PERMISSIONS_HTML, "perms.html");
      assert.deepEqual(m.permissions, ["clipboard", "camera"]);
    });

    it("parses multiInstance field from manifest", () => {
      const m = mgr.parseManifest(SAMPLE_HTML, "test.html");
      assert.equal(m.multiInstance, true);

      const m2 = mgr.parseManifest(SINGLE_HTML, "single.html");
      assert.equal(m2.multiInstance, false);
    });

    it("parses darkMode field", () => {
      const m = mgr.parseManifest(DARKMODE_HTML, "dark.html");
      assert.equal(m.darkMode, true);
    });

    it("defaults darkMode to false", () => {
      const m = mgr.parseManifest(SINGLE_HTML, "single.html");
      assert.equal(m.darkMode, false);
    });

    it("notifications is undefined when not in manifest", () => {
      const m = mgr.parseManifest(SINGLE_HTML, "single.html");
      assert.equal(m.notifications, undefined);
    });

    it("defaults notifications.overridable to true when only level is given", () => {
      const html = `<!DOCTYPE html>
<html><head>
<script type="application/mup-manifest">
{ "name": "Partial Notify", "functions": [], "notifications": { "level": "silent" } }
</script>
</head><body></body></html>`;
      const m = mgr.parseManifest(html, "partial.html");
      assert.deepEqual(m.notifications, { level: "silent", overridable: true });
    });

    it("defaults notifications.level to 'notify' when only overridable is given", () => {
      const html = `<!DOCTYPE html>
<html><head>
<script type="application/mup-manifest">
{ "name": "Overridable Only", "functions": [], "notifications": { "overridable": false } }
</script>
</head><body></body></html>`;
      const m = mgr.parseManifest(html, "overridable.html");
      assert.deepEqual(m.notifications, { level: "notify", overridable: false });
    });

    it("derives ID from directory name for index.html", () => {
      const html = `<!DOCTYPE html>
<html><head>
<script type="application/mup-manifest">
{ "name": "Index MUP", "functions": [] }
</script>
</head><body></body></html>`;
      const m = mgr.parseManifest(html, "/mups/my-widget/index.html");
      assert.equal(m.id, "mup-my-widget");
    });
  });

  // ---- addEvent overflow ----

  describe("addEvent overflow", () => {
    it("drops oldest events when exceeding maxPendingEvents", () => {
      mgr.loadFromHtml(SAMPLE_HTML, "test.html");
      const max = CONFIG.maxPendingEvents;

      // Fill to capacity
      for (let i = 0; i < max; i++) {
        mgr.addEvent("mup-test", `event-${i}`, `Event ${i}`);
      }

      const mup = mgr.get("mup-test")!;
      assert.equal(mup.pendingEvents.length, max);
      assert.equal(mup.pendingEvents[0].action, "event-0");

      // Add one more — oldest should be dropped
      mgr.addEvent("mup-test", "overflow-1", "Overflow 1");
      assert.equal(mup.pendingEvents.length, max);
      assert.equal(mup.pendingEvents[0].action, "event-1");
      assert.equal(mup.pendingEvents[max - 1].action, "overflow-1");
    });

    it("drops multiple oldest events on repeated overflow", () => {
      mgr.loadFromHtml(SAMPLE_HTML, "test.html");
      const max = CONFIG.maxPendingEvents;

      // Fill to capacity
      for (let i = 0; i < max; i++) {
        mgr.addEvent("mup-test", `event-${i}`, `Event ${i}`);
      }

      // Add 3 more — the first 3 originals should be gone
      mgr.addEvent("mup-test", "over-a", "A");
      mgr.addEvent("mup-test", "over-b", "B");
      mgr.addEvent("mup-test", "over-c", "C");

      const mup = mgr.get("mup-test")!;
      assert.equal(mup.pendingEvents.length, max);
      assert.equal(mup.pendingEvents[0].action, "event-3");
      assert.equal(mup.pendingEvents[max - 1].action, "over-c");
    });

    it("sets _overflowWarned flag on first overflow", () => {
      mgr.loadFromHtml(SAMPLE_HTML, "test.html");
      const max = CONFIG.maxPendingEvents;

      for (let i = 0; i < max; i++) {
        mgr.addEvent("mup-test", `event-${i}`, `Event ${i}`);
      }

      const mup = mgr.get("mup-test")!;
      assert.equal(mup._overflowWarned, undefined);

      mgr.addEvent("mup-test", "overflow", "Overflow");
      assert.equal(mup._overflowWarned, true);
    });

    it("resets _overflowWarned after drainEvents", () => {
      mgr.loadFromHtml(SAMPLE_HTML, "test.html");
      const max = CONFIG.maxPendingEvents;

      for (let i = 0; i <= max; i++) {
        mgr.addEvent("mup-test", `event-${i}`, `Event ${i}`);
      }

      const mup = mgr.get("mup-test")!;
      assert.equal(mup._overflowWarned, true);

      mgr.drainEvents();
      assert.equal(mup._overflowWarned, false);
    });

    it("ignores addEvent for unknown MUP", () => {
      // Should not throw
      mgr.addEvent("nonexistent", "click", "Clicked");
      assert.equal(mgr.drainEvents().length, 0);
    });
  });

  // ---- hasEvents ----

  describe("hasEvents", () => {
    it("returns false when no events", () => {
      mgr.loadFromHtml(SAMPLE_HTML, "test.html");
      assert.equal(mgr.hasEvents(), false);
    });

    it("returns true when events exist", () => {
      mgr.loadFromHtml(SAMPLE_HTML, "test.html");
      mgr.addEvent("mup-test", "click", "Clicked");
      assert.equal(mgr.hasEvents(), true);
    });

    it("respects since parameter", () => {
      mgr.loadFromHtml(SAMPLE_HTML, "test.html");
      mgr.addEvent("mup-test", "click", "Clicked");
      const mup = mgr.get("mup-test")!;
      mup.pendingEvents[0].timestamp = 1000;

      assert.equal(mgr.hasEvents(999), true);
      assert.equal(mgr.hasEvents(1000), false);
      assert.equal(mgr.hasEvents(1001), false);
    });
  });

  // ---- waitForEvent ----

  describe("waitForEvent", () => {
    it("resolves when addEvent is called", async () => {
      mgr.loadFromHtml(SAMPLE_HTML, "test.html");
      const promise = mgr.waitForEvent(5000);
      mgr.addEvent("mup-test", "click", "Clicked");
      await promise; // should resolve immediately
    });

    it("resolves on timeout when no event arrives", async () => {
      mgr.loadFromHtml(SAMPLE_HTML, "test.html");
      const start = Date.now();
      await mgr.waitForEvent(50);
      const elapsed = Date.now() - start;
      assert.ok(elapsed >= 40, `Expected >= 40ms, got ${elapsed}ms`);
    });

    it("multiple waiters all resolve on a single addEvent", async () => {
      mgr.loadFromHtml(SAMPLE_HTML, "test.html");
      const p1 = mgr.waitForEvent(5000);
      const p2 = mgr.waitForEvent(5000);
      mgr.addEvent("mup-test", "click", "Clicked");
      await Promise.all([p1, p2]);
    });
  });

  // ---- cancelWaiters ----

  describe("cancelWaiters", () => {
    it("resolves all pending waiters", async () => {
      mgr.loadFromHtml(SAMPLE_HTML, "test.html");
      const p1 = mgr.waitForEvent(5000);
      const p2 = mgr.waitForEvent(5000);
      mgr.cancelWaiters();
      await Promise.all([p1, p2]);
    });
  });
});
