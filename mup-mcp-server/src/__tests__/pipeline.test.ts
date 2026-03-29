import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { PipelineManager, CallFn } from "../pipeline.js";

describe("PipelineManager", () => {
  let pm: PipelineManager;
  let callFn: CallFn;
  let calls: { mupId: string; fnName: string; args: Record<string, unknown> }[];

  beforeEach(() => {
    calls = [];
    callFn = mock.fn(async (mupId: string, fnName: string, args: Record<string, unknown>) => {
      calls.push({ mupId, fnName, args });
      return { content: [{ text: JSON.stringify({ ok: true }) }] };
    }) as unknown as CallFn;
    pm = new PipelineManager(callFn);
  });

  // ---- addPipe ----

  describe("addPipe", () => {
    it("adds a valid pipe and returns an id", () => {
      const result = pm.addPipe({
        sourceMupId: "mup-a",
        targetMupId: "mup-b",
        targetFunction: "update",
        transform: { value: "count" },
      });
      assert.ok("id" in result);
      assert.match((result as { id: string }).id, /^pipe_/);
    });

    it("returns error when sourceMupId is missing required target fields", () => {
      // Same source and target should fail
      const result = pm.addPipe({
        sourceMupId: "mup-a",
        targetMupId: "mup-a",
        targetFunction: "update",
        transform: { value: "." },
      });
      assert.ok("error" in result);
    });

    it("returns error when max pipe limit is reached", () => {
      for (let i = 0; i < 50; i++) {
        pm.addPipe({
          sourceMupId: `src-${i}`,
          targetMupId: `tgt-${i}`,
          targetFunction: "fn",
          transform: { x: "." },
        });
      }
      const result = pm.addPipe({
        sourceMupId: "src-extra",
        targetMupId: "tgt-extra",
        targetFunction: "fn",
        transform: { x: "." },
      });
      assert.ok("error" in result);
      assert.ok((result as { error: string }).error.includes("Max"));
    });
  });

  // ---- removePipe ----

  describe("removePipe", () => {
    it("removes an existing pipe", () => {
      const { id } = pm.addPipe({
        sourceMupId: "mup-a",
        targetMupId: "mup-b",
        targetFunction: "fn",
        transform: { x: "." },
      }) as { id: string };
      assert.equal(pm.removePipe(id), true);
      assert.equal(pm.listPipes().length, 0);
    });

    it("returns false for non-existent pipe", () => {
      assert.equal(pm.removePipe("pipe_999"), false);
    });
  });

  // ---- enablePipe / disablePipe ----

  describe("enablePipe / disablePipe", () => {
    it("disables and re-enables a pipe", () => {
      const { id } = pm.addPipe({
        sourceMupId: "mup-a",
        targetMupId: "mup-b",
        targetFunction: "fn",
        transform: { x: "." },
      }) as { id: string };

      assert.equal(pm.disablePipe(id), true);
      assert.equal(pm.listPipes()[0].enabled, false);

      assert.equal(pm.enablePipe(id), true);
      assert.equal(pm.listPipes()[0].enabled, true);
    });

    it("returns false for unknown pipe id", () => {
      assert.equal(pm.enablePipe("pipe_999"), false);
      assert.equal(pm.disablePipe("pipe_999"), false);
    });
  });

  // ---- listPipes ----

  describe("listPipes", () => {
    it("returns all registered pipes", () => {
      pm.addPipe({ sourceMupId: "a", targetMupId: "b", targetFunction: "f1", transform: { x: "." } });
      pm.addPipe({ sourceMupId: "c", targetMupId: "d", targetFunction: "f2", transform: { y: "." } });
      const pipes = pm.listPipes();
      assert.equal(pipes.length, 2);
      assert.equal(pipes[0].targetFunction, "f1");
      assert.equal(pipes[1].targetFunction, "f2");
    });
  });

  // ---- detectCycle (tested via addPipe) ----

  describe("detectCycle", () => {
    it("allows a non-cyclic chain A→B→C", () => {
      const r1 = pm.addPipe({ sourceMupId: "a", targetMupId: "b", targetFunction: "fn", transform: { x: "." } });
      assert.ok("id" in r1);
      const r2 = pm.addPipe({ sourceMupId: "b", targetMupId: "c", targetFunction: "fn", transform: { x: "." } });
      assert.ok("id" in r2);
    });

    it("rejects A→B→A cycle", () => {
      pm.addPipe({ sourceMupId: "a", targetMupId: "b", targetFunction: "fn", transform: { x: "." } });
      const result = pm.addPipe({ sourceMupId: "b", targetMupId: "a", targetFunction: "fn", transform: { x: "." } });
      assert.ok("error" in result);
      assert.ok((result as { error: string }).error.includes("cycle"));
    });
  });

  // ---- applyTransform (tested via pipe execution) ----

  describe("applyTransform", () => {
    it("resolves a dot-path value", async () => {
      pm.addPipe({
        sourceMupId: "mup-src",
        targetMupId: "mup-tgt",
        targetFunction: "setVal",
        transform: { bpm: "params.bpm" },
        debounceMs: 0,
      });
      pm.onStateUpdate("mup-src", { params: { bpm: 120 } });
      // flush the setTimeout(0)
      await new Promise(r => setTimeout(r, 20));
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0].args, { bpm: 120 });
    });

    it("resolves a literal string value", async () => {
      pm.addPipe({
        sourceMupId: "mup-src",
        targetMupId: "mup-tgt",
        targetFunction: "setVal",
        transform: { mode: "'dark'" },
        debounceMs: 0,
      });
      pm.onStateUpdate("mup-src", {});
      await new Promise(r => setTimeout(r, 20));
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0].args, { mode: "dark" });
    });

    it("resolves '.' to entire source data", async () => {
      pm.addPipe({
        sourceMupId: "mup-src",
        targetMupId: "mup-tgt",
        targetFunction: "setVal",
        transform: { payload: "." },
        debounceMs: 0,
      });
      const data = { a: 1, b: 2 };
      pm.onStateUpdate("mup-src", data);
      await new Promise(r => setTimeout(r, 20));
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0].args, { payload: data });
    });
  });

  // ---- onStateUpdate ----

  describe("onStateUpdate", () => {
    it("triggers matching pipe on source update", async () => {
      pm.addPipe({
        sourceMupId: "mup-src",
        targetMupId: "mup-tgt",
        targetFunction: "refresh",
        transform: { val: "x" },
        debounceMs: 0,
      });
      pm.onStateUpdate("mup-src", { x: 42 });
      await new Promise(r => setTimeout(r, 20));
      assert.equal(calls.length, 1);
      assert.equal(calls[0].mupId, "mup-tgt");
      assert.equal(calls[0].fnName, "refresh");
      assert.deepEqual(calls[0].args, { val: 42 });
    });

    it("skips disabled pipes", async () => {
      const { id } = pm.addPipe({
        sourceMupId: "mup-src",
        targetMupId: "mup-tgt",
        targetFunction: "refresh",
        transform: { val: "." },
        debounceMs: 0,
      }) as { id: string };
      pm.disablePipe(id);

      pm.onStateUpdate("mup-src", { x: 1 });
      await new Promise(r => setTimeout(r, 20));
      assert.equal(calls.length, 0);
    });
  });

  // ---- onMupDeactivated ----

  describe("onMupDeactivated", () => {
    it("disables pipes where deactivated MUP is source", () => {
      pm.addPipe({ sourceMupId: "mup-src", targetMupId: "mup-tgt", targetFunction: "fn", transform: { x: "." } });
      pm.onMupDeactivated("mup-src");
      assert.equal(pm.listPipes()[0].enabled, false);
    });

    it("disables pipes where deactivated MUP is target", () => {
      pm.addPipe({ sourceMupId: "mup-src", targetMupId: "mup-tgt", targetFunction: "fn", transform: { x: "." } });
      pm.onMupDeactivated("mup-tgt");
      assert.equal(pm.listPipes()[0].enabled, false);
    });
  });
});
