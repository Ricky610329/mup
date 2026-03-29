import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { Scheduler, type CallFn, type ScheduledCall } from "../scheduler.js";

function makeCall(mupId = "mup-a", functionName = "doThing", functionArgs: Record<string, unknown> = {}): ScheduledCall {
  return { mupId, functionName, functionArgs };
}

describe("Scheduler", () => {
  let scheduler: Scheduler;
  let callFn: ReturnType<typeof mock.fn<CallFn>>;

  beforeEach(() => {
    callFn = mock.fn<CallFn>(async () => {});
    scheduler = new Scheduler(callFn);
  });

  afterEach(() => {
    scheduler.clearAll();
  });

  // ---- scheduleDelay ----

  describe("scheduleDelay", () => {
    it("returns a scheduleId string", () => {
      const id = scheduler.scheduleDelay(50, [makeCall()]);
      assert.equal(typeof id, "string");
      assert.match(id as string, /^delay_/);
    });

    it("invokes callFn after delay", async () => {
      scheduler.scheduleDelay(10, [makeCall("mup-x", "ping", { v: 1 })]);
      await new Promise(r => setTimeout(r, 30));
      assert.equal(callFn.mock.callCount(), 1);
      assert.deepEqual(callFn.mock.calls[0].arguments, ["mup-x", "ping", { v: 1 }]);
    });

    it("returns error when exceeding max delays", () => {
      for (let i = 0; i < 50; i++) scheduler.scheduleDelay(50000, [makeCall()]);
      const result = scheduler.scheduleDelay(100, [makeCall()]);
      assert.deepEqual(result, { error: "Max 50 pending delays reached." });
    });

    it("returns error when delay exceeds max time", () => {
      const result = scheduler.scheduleDelay(300_001, [makeCall()]);
      assert.deepEqual(result, { error: "delayMs cannot exceed 300000 (5 minutes)." });
    });

    it("returns error when calls exceed max per delay", () => {
      const calls = Array.from({ length: 11 }, () => makeCall());
      const result = scheduler.scheduleDelay(10, calls);
      assert.deepEqual(result, { error: "Max 10 calls per delay." });
    });
  });

  // ---- cancelDelay ----

  describe("cancelDelay", () => {
    it("cancels an existing delay and returns true", async () => {
      const id = scheduler.scheduleDelay(20, [makeCall()]) as string;
      assert.equal(scheduler.cancelDelay(id), true);
      assert.equal(scheduler.pendingDelays, 0);
      await new Promise(r => setTimeout(r, 40));
      assert.equal(callFn.mock.callCount(), 0);
    });

    it("returns false for non-existing id", () => {
      assert.equal(scheduler.cancelDelay("delay_999"), false);
    });
  });

  // ---- registerEvent ----

  describe("registerEvent", () => {
    it("returns a listener id string", () => {
      const id = scheduler.registerEvent("mup-a", "click", [makeCall()]);
      assert.equal(typeof id, "string");
      assert.match(id as string, /^evt_/);
    });

    it("returns error when exceeding max listeners", () => {
      for (let i = 0; i < 50; i++) scheduler.registerEvent("mup-a", "click", [makeCall()]);
      const result = scheduler.registerEvent("mup-a", "click", [makeCall()]);
      assert.deepEqual(result, { error: "Max 50 event listeners reached." });
    });

    it("registers with a filter", () => {
      const id = scheduler.registerEvent("mup-a", "click", [makeCall()], true, { key: "Enter" });
      assert.equal(typeof id, "string");
      assert.equal(scheduler.activeListeners, 1);
    });
  });

  // ---- removeEvent ----

  describe("removeEvent", () => {
    it("removes a single listener by id", () => {
      const id = scheduler.registerEvent("mup-a", "click", [makeCall()]) as string;
      scheduler.registerEvent("mup-b", "hover", [makeCall()]);
      assert.equal(scheduler.activeListeners, 2);

      assert.equal(scheduler.removeEvent(id), true);
      assert.equal(scheduler.activeListeners, 1);
    });

    it("returns false for unknown listener id", () => {
      assert.equal(scheduler.removeEvent("evt_999"), false);
    });

    it("removes all timers and listeners when called with no args", () => {
      scheduler.scheduleDelay(50000, [makeCall()]);
      scheduler.registerEvent("mup-a", "click", [makeCall()]);
      assert.equal(scheduler.pendingDelays, 1);
      assert.equal(scheduler.activeListeners, 1);

      const result = scheduler.removeEvent();
      assert.deepEqual(result, { removed: 2 });
      assert.equal(scheduler.pendingDelays, 0);
      assert.equal(scheduler.activeListeners, 0);
    });
  });

  // ---- onMupEvent ----

  describe("onMupEvent", () => {
    it("triggers matching listener", async () => {
      scheduler.registerEvent("mup-a", "click", [makeCall("mup-a", "handleClick", { x: 10 })]);
      await scheduler.onMupEvent("mup-a", "click");
      assert.equal(callFn.mock.callCount(), 1);
      assert.deepEqual(callFn.mock.calls[0].arguments, ["mup-a", "handleClick", { x: 10 }]);
    });

    it("does not trigger on mupId mismatch", async () => {
      scheduler.registerEvent("mup-a", "click", [makeCall()]);
      await scheduler.onMupEvent("mup-b", "click");
      assert.equal(callFn.mock.callCount(), 0);
    });

    it("does not trigger on event name mismatch", async () => {
      scheduler.registerEvent("mup-a", "click", [makeCall()]);
      await scheduler.onMupEvent("mup-a", "hover");
      assert.equal(callFn.mock.callCount(), 0);
    });

    it("does not trigger when filter mismatches", async () => {
      scheduler.registerEvent("mup-a", "key", [makeCall()], true, { key: "Enter" });
      await scheduler.onMupEvent("mup-a", "key", { key: "Escape" });
      assert.equal(callFn.mock.callCount(), 0);
      // Listener still present because it wasn't matched
      assert.equal(scheduler.activeListeners, 1);
    });

    it("triggers when filter matches", async () => {
      scheduler.registerEvent("mup-a", "key", [makeCall()], true, { key: "Enter" });
      await scheduler.onMupEvent("mup-a", "key", { key: "Enter" });
      assert.equal(callFn.mock.callCount(), 1);
    });

    it("once=true auto-removes listener after trigger", async () => {
      scheduler.registerEvent("mup-a", "click", [makeCall()], true);
      assert.equal(scheduler.activeListeners, 1);

      await scheduler.onMupEvent("mup-a", "click");
      assert.equal(scheduler.activeListeners, 0);
      assert.equal(callFn.mock.callCount(), 1);

      // Second fire should not trigger
      await scheduler.onMupEvent("mup-a", "click");
      assert.equal(callFn.mock.callCount(), 1);
    });

    it("once=false keeps listener after trigger", async () => {
      scheduler.registerEvent("mup-a", "click", [makeCall()], false);

      await scheduler.onMupEvent("mup-a", "click");
      assert.equal(scheduler.activeListeners, 1);
      assert.equal(callFn.mock.callCount(), 1);

      await scheduler.onMupEvent("mup-a", "click");
      assert.equal(callFn.mock.callCount(), 2);
    });
  });

  // ---- scheduleDelay with multiple calls (batch) ----

  describe("scheduleDelay batch calls", () => {
    it("invokes all calls in a batch after delay", async () => {
      scheduler.scheduleDelay(10, [
        makeCall("mup-a", "fn1", { v: 1 }),
        makeCall("mup-b", "fn2", { v: 2 }),
        makeCall("mup-c", "fn3", { v: 3 }),
      ]);
      await new Promise(r => setTimeout(r, 40));
      assert.equal(callFn.mock.callCount(), 3);
      assert.deepEqual(callFn.mock.calls[0].arguments, ["mup-a", "fn1", { v: 1 }]);
      assert.deepEqual(callFn.mock.calls[1].arguments, ["mup-b", "fn2", { v: 2 }]);
      assert.deepEqual(callFn.mock.calls[2].arguments, ["mup-c", "fn3", { v: 3 }]);
    });
  });

  // ---- onMupEvent with data filter matching nested fields ----

  describe("onMupEvent data filter with nested data", () => {
    it("matches top-level filter keys when data also has nested objects", async () => {
      scheduler.registerEvent("mup-a", "update", [makeCall("mup-a", "handle", { ok: true })], true, { status: "active" });
      await scheduler.onMupEvent("mup-a", "update", { status: "active", meta: { level: 5, tags: ["a"] } });
      assert.equal(callFn.mock.callCount(), 1);
      assert.deepEqual(callFn.mock.calls[0].arguments, ["mup-a", "handle", { ok: true }]);
    });

    it("does not match when filter key value differs despite other nested data", async () => {
      scheduler.registerEvent("mup-a", "update", [makeCall()], true, { status: "active" });
      await scheduler.onMupEvent("mup-a", "update", { status: "inactive", meta: { level: 5 } });
      assert.equal(callFn.mock.callCount(), 0);
      assert.equal(scheduler.activeListeners, 1); // listener still present
    });

    it("matches filter with multiple keys against data with nested structure", async () => {
      scheduler.registerEvent("mup-a", "change", [makeCall("mup-a", "react", {})], true, { type: "click", zone: "header" });
      await scheduler.onMupEvent("mup-a", "change", { type: "click", zone: "header", detail: { x: 10, y: 20 } });
      assert.equal(callFn.mock.callCount(), 1);
    });
  });

  // ---- registerEvent with once=false fires multiple times with data ----

  describe("registerEvent once=false with data verification", () => {
    it("fires multiple times and each call receives the registered args", async () => {
      scheduler.registerEvent("mup-a", "tick", [makeCall("mup-a", "onTick", { seq: 0 })], false);

      await scheduler.onMupEvent("mup-a", "tick", { round: 1 });
      await scheduler.onMupEvent("mup-a", "tick", { round: 2 });
      await scheduler.onMupEvent("mup-a", "tick", { round: 3 });

      assert.equal(callFn.mock.callCount(), 3);
      assert.equal(scheduler.activeListeners, 1);
      // All three calls should have the same registered args
      for (let i = 0; i < 3; i++) {
        assert.deepEqual(callFn.mock.calls[i].arguments, ["mup-a", "onTick", { seq: 0 }]);
      }
    });
  });

  // ---- cancelDelay after partial execution of batch ----

  describe("cancelDelay partial batch", () => {
    it("cancelling a delay prevents its calls from executing", async () => {
      const id = scheduler.scheduleDelay(30, [
        makeCall("mup-a", "step1", {}),
        makeCall("mup-a", "step2", {}),
      ]) as string;

      // Cancel before the delay fires
      await new Promise(r => setTimeout(r, 10));
      assert.equal(scheduler.cancelDelay(id), true);
      assert.equal(scheduler.pendingDelays, 0);

      // Wait past the original delay time
      await new Promise(r => setTimeout(r, 40));
      assert.equal(callFn.mock.callCount(), 0);
    });
  });

  // ---- Concurrent onMupEvent ----

  describe("concurrent onMupEvent", () => {
    it("sequential once=true events: second call does not fire after first removes listener", async () => {
      scheduler.registerEvent("mup-a", "click", [makeCall("mup-a", "handle", { n: 1 })], true);
      assert.equal(scheduler.activeListeners, 1);

      // Fire sequentially — first removes the listener, second finds nothing
      await scheduler.onMupEvent("mup-a", "click");
      assert.equal(scheduler.activeListeners, 0);
      assert.equal(callFn.mock.callCount(), 1);

      await scheduler.onMupEvent("mup-a", "click");
      assert.equal(callFn.mock.callCount(), 1); // still 1 — no double-fire
    });

    it("once=false listener fires for each concurrent event", async () => {
      scheduler.registerEvent("mup-a", "ping", [makeCall("mup-a", "pong", {})], false);

      const p1 = scheduler.onMupEvent("mup-a", "ping");
      const p2 = scheduler.onMupEvent("mup-a", "ping");
      await Promise.all([p1, p2]);

      // Both should fire since once=false keeps the listener
      assert.equal(callFn.mock.callCount(), 2);
      assert.equal(scheduler.activeListeners, 1);
    });
  });

  // ---- clearAll ----

  describe("clearAll", () => {
    it("removes all timers and listeners", async () => {
      scheduler.scheduleDelay(50000, [makeCall()]);
      scheduler.scheduleDelay(50000, [makeCall()]);
      scheduler.registerEvent("mup-a", "click", [makeCall()]);
      scheduler.registerEvent("mup-b", "hover", [makeCall()]);

      assert.equal(scheduler.pendingDelays, 2);
      assert.equal(scheduler.activeListeners, 2);

      scheduler.clearAll();

      assert.equal(scheduler.pendingDelays, 0);
      assert.equal(scheduler.activeListeners, 0);
    });

    it("cancelled delays do not fire", async () => {
      scheduler.scheduleDelay(10, [makeCall()]);
      scheduler.clearAll();
      await new Promise(r => setTimeout(r, 30));
      assert.equal(callFn.mock.callCount(), 0);
    });
  });

  // ---- pendingDelays / activeListeners getters ----

  describe("pendingDelays / activeListeners getters", () => {
    it("pendingDelays reflects scheduled and completed delays", async () => {
      assert.equal(scheduler.pendingDelays, 0);
      scheduler.scheduleDelay(10, [makeCall()]);
      assert.equal(scheduler.pendingDelays, 1);

      await new Promise(r => setTimeout(r, 30));
      assert.equal(scheduler.pendingDelays, 0);
    });

    it("activeListeners reflects registered and removed listeners", () => {
      assert.equal(scheduler.activeListeners, 0);
      const id = scheduler.registerEvent("mup-a", "click", [makeCall()]) as string;
      assert.equal(scheduler.activeListeners, 1);

      scheduler.removeEvent(id);
      assert.equal(scheduler.activeListeners, 0);
    });
  });
});
