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

  // ---- resolveValue edge cases ----

  describe("resolveValue edge cases", () => {
    it("resolves nested dot-path a.b.c", async () => {
      pm.addPipe({
        sourceMupId: "mup-src",
        targetMupId: "mup-tgt",
        targetFunction: "setVal",
        transform: { deep: "a.b.c" },
        debounceMs: 0,
      });
      pm.onStateUpdate("mup-src", { a: { b: { c: "found" } } });
      await new Promise(r => setTimeout(r, 20));
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0].args, { deep: "found" });
    });

    it("returns undefined for broken nested path", async () => {
      pm.addPipe({
        sourceMupId: "mup-src",
        targetMupId: "mup-tgt",
        targetFunction: "setVal",
        transform: { val: "a.b.missing" },
        debounceMs: 0,
      });
      pm.onStateUpdate("mup-src", { a: { b: { c: 1 } } });
      await new Promise(r => setTimeout(r, 20));
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0].args, { val: undefined });
    });

    it("resolves a number literal", async () => {
      pm.addPipe({
        sourceMupId: "mup-src",
        targetMupId: "mup-tgt",
        targetFunction: "setVal",
        transform: { count: "42", neg: "-7", decimal: "3.14" },
        debounceMs: 0,
      });
      pm.onStateUpdate("mup-src", {});
      await new Promise(r => setTimeout(r, 20));
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0].args, { count: 42, neg: -7, decimal: 3.14 });
    });

    it("resolves boolean literals", async () => {
      pm.addPipe({
        sourceMupId: "mup-src",
        targetMupId: "mup-tgt",
        targetFunction: "setVal",
        transform: { on: "true", off: "false" },
        debounceMs: 0,
      });
      pm.onStateUpdate("mup-src", {});
      await new Promise(r => setTimeout(r, 20));
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0].args, { on: true, off: false });
    });
  });

  // ---- addPipe self-loop ----

  describe("addPipe self-loop", () => {
    it("rejects same source and target with same function (self-loop)", () => {
      const result = pm.addPipe({
        sourceMupId: "mup-x",
        targetMupId: "mup-x",
        targetFunction: "refresh",
        transform: { v: "." },
      });
      assert.ok("error" in result);
      assert.ok((result as { error: string }).error.includes("same"));
    });
  });

  // ---- getLog ----

  describe("getLog", () => {
    it("returns execution history after pipe fires", async () => {
      pm.addPipe({
        sourceMupId: "mup-src",
        targetMupId: "mup-tgt",
        targetFunction: "fn",
        transform: { v: "." },
        debounceMs: 0,
      });
      pm.onStateUpdate("mup-src", { x: 1 });
      await new Promise(r => setTimeout(r, 20));

      const log = pm.getLog();
      assert.equal(log.length, 1);
      assert.equal(log[0].success, true);
      assert.match(log[0].pipeId, /^pipe_/);
      assert.equal(typeof log[0].timestamp, "number");
    });

    it("records failed execution in log", async () => {
      const failCallFn: CallFn = async () => { throw new Error("boom"); };
      const failPm = new PipelineManager(failCallFn);
      failPm.addPipe({
        sourceMupId: "mup-src",
        targetMupId: "mup-tgt",
        targetFunction: "fn",
        transform: { v: "." },
        debounceMs: 0,
      });
      failPm.onStateUpdate("mup-src", {});
      await new Promise(r => setTimeout(r, 20));

      const log = failPm.getLog();
      assert.equal(log.length, 1);
      assert.equal(log[0].success, false);
      assert.equal(log[0].error, "boom");
    });
  });

  // ---- Multiple pipes from same source ----

  describe("multiple pipes from same source", () => {
    it("both pipes trigger on a single state update", async () => {
      pm.addPipe({
        sourceMupId: "mup-src",
        targetMupId: "mup-tgt1",
        targetFunction: "fn1",
        transform: { a: "x" },
        debounceMs: 0,
      });
      pm.addPipe({
        sourceMupId: "mup-src",
        targetMupId: "mup-tgt2",
        targetFunction: "fn2",
        transform: { b: "y" },
        debounceMs: 0,
      });
      pm.onStateUpdate("mup-src", { x: 10, y: 20 });
      await new Promise(r => setTimeout(r, 30));

      assert.equal(calls.length, 2);
      const mupIds = calls.map(c => c.mupId).sort();
      assert.deepEqual(mupIds, ["mup-tgt1", "mup-tgt2"]);
      assert.deepEqual(calls.find(c => c.mupId === "mup-tgt1")!.args, { a: 10 });
      assert.deepEqual(calls.find(c => c.mupId === "mup-tgt2")!.args, { b: 20 });
    });
  });

  // ---- Pipe with sourceFunction ----

  describe("pipe with sourceFunction", () => {
    it("calls source function first then transforms result to target", async () => {
      const sourceCalls: string[] = [];
      const customCallFn: CallFn = async (mupId, fnName, args) => {
        sourceCalls.push(`${mupId}.${fnName}`);
        if (mupId === "mup-src" && fnName === "getData") {
          return { content: [{ text: JSON.stringify({ level: 5, label: "high" }) }] };
        }
        calls.push({ mupId, fnName, args });
        return { content: [{ text: JSON.stringify({ ok: true }) }] };
      };
      const pmCustom = new PipelineManager(customCallFn);
      pmCustom.addPipe({
        sourceMupId: "mup-src",
        sourceFunction: "getData",
        targetMupId: "mup-tgt",
        targetFunction: "display",
        transform: { value: "level", name: "label" },
        debounceMs: 0,
      });

      calls = []; // reset shared array
      pmCustom.onStateUpdate("mup-src", { ignored: true });
      await new Promise(r => setTimeout(r, 30));

      assert.ok(sourceCalls.includes("mup-src.getData"));
      assert.equal(calls.length, 1);
      assert.equal(calls[0].mupId, "mup-tgt");
      assert.equal(calls[0].fnName, "display");
      assert.deepEqual(calls[0].args, { value: 5, name: "high" });
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
