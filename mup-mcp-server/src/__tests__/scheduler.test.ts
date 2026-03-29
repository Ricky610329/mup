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
