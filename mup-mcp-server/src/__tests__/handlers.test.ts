import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  parseArgs,
  handleList,
  handleCheckInteractions,
  handleHistory,
  handlePipe,
  handleToolCall,
  type ToolCallContext,
} from "../handlers.js";

// ---- Lightweight Mocks ----

function makeMockManager(opts: {
  catalog?: Array<{ active: boolean; manifest: any }>;
  events?: any[];
  all?: any[];
  notifLevel?: string;
} = {}) {
  return {
    getCatalog: () => opts.catalog ?? [],
    drainEvents: (since?: number) => {
      const evts = opts.events ?? [];
      if (since !== undefined) return evts.filter((e: any) => e.timestamp > since);
      return evts;
    },
    getAll: () => opts.all ?? [],
    get: (id: string) => (opts.all ?? []).find((m: any) => m.manifest.id === id) ?? null,
    isActive: () => true,
    getNotificationLevel: () => opts.notifLevel ?? "notify",
    setNotificationLevel: (mupId: string, level: string) => {
      if (!(opts.all ?? []).find((m: any) => m.manifest.id === mupId)) return `MUP "${mupId}" not found.`;
      return undefined;
    },
    addEvent: () => {},
    activateInstance: () => null,
  } as any;
}

function makeMockWs(history: Record<string, any[]> = {}) {
  return {
    callHistory: history,
    addCallHistory: () => {},
    markMetadataDirty: () => {},
    gridLayout: [],
  } as any;
}

function makeMockBridge() {
  return {
    callFunction: async () => ({ content: [{ type: "text", text: "ok" }], isError: false }),
    waitForMupLoaded: async () => {},
    sendRaw: () => {},
    setFileAccess: () => {},
    typedOnce: () => {},
  } as any;
}

function makeMockPipeline(pipes: any[] = []) {
  return {
    addPipe: (opts: any) => {
      if (opts.sourceMupId === opts.targetMupId) return { error: "Source and target cannot be the same MUP." };
      return { id: "pipe_1" };
    },
    listPipes: () => pipes,
    removePipe: (id: string) => pipes.some((p) => p.id === id),
    enablePipe: (id: string) => pipes.some((p) => p.id === id),
    disablePipe: (id: string) => pipes.some((p) => p.id === id),
  } as any;
}

function makeMockScheduler() {
  return {
    scheduleDelay: () => "delay_1",
    cancelDelay: (id: string) => id === "delay_1",
    registerEvent: () => "evt_1",
    removeEvent: (id?: string) => (id ? id === "evt_1" : { removed: 2 }),
  } as any;
}

const SAMPLE_MANIFEST = {
  name: "Test MUP",
  id: "mup-test",
  description: "A test MUP",
  functions: [
    { name: "doThing", description: "Does a thing", inputSchema: { type: "object", properties: { x: { type: "number" } } } },
  ],
};

// ---- Tests ----

describe("parseArgs", () => {
  it("returns {} for null", () => {
    assert.deepEqual(parseArgs(null), {});
  });

  it("returns {} for undefined", () => {
    assert.deepEqual(parseArgs(undefined), {});
  });

  it("parses a valid JSON string", () => {
    assert.deepEqual(parseArgs('{"a":1}'), { a: 1 });
  });

  it("returns {} for invalid JSON string", () => {
    assert.deepEqual(parseArgs("{bad}"), {});
  });

  it("passes through a plain object", () => {
    const obj = { x: 42 };
    assert.deepEqual(parseArgs(obj), obj);
  });

  it("returns {} for non-object non-string", () => {
    assert.deepEqual(parseArgs(123), {});
  });
});

describe("handleList", () => {
  it("lists active and available MUPs", () => {
    const mgr = makeMockManager({
      catalog: [
        { active: true, manifest: SAMPLE_MANIFEST },
        { active: false, manifest: { ...SAMPLE_MANIFEST, id: "mup-other", name: "Other MUP" } },
      ],
    });
    const result = handleList(mgr);
    assert.equal(result.content.length, 1);
    assert.ok(result.content[0].text.includes("[ACTIVE]"));
    assert.ok(result.content[0].text.includes("[available]"));
  });

  it("returns empty text for empty catalog", () => {
    const mgr = makeMockManager({ catalog: [] });
    const result = handleList(mgr);
    assert.equal(result.content[0].text, "");
  });
});

describe("handleCheckInteractions", () => {
  it("returns interactions when events exist", () => {
    const mgr = makeMockManager({
      events: [
        { mupName: "Test", action: "click", summary: "User clicked", timestamp: 1000 },
      ],
      all: [],
    });
    const result = handleCheckInteractions(mgr, {});
    assert.ok(result.content[0].text.includes("User interactions"));
    assert.ok(result.content[0].text.includes("click"));
  });

  it("returns no-interactions message when empty", () => {
    const mgr = makeMockManager({ events: [], all: [] });
    const result = handleCheckInteractions(mgr, {});
    assert.equal(result.content[0].text, "No interactions or state changes.");
  });

  it("filters events by since timestamp", () => {
    const mgr = makeMockManager({
      events: [
        { mupName: "Test", action: "old", summary: "Old", timestamp: 500 },
        { mupName: "Test", action: "new", summary: "New", timestamp: 1500 },
      ],
      all: [],
    });
    const result = handleCheckInteractions(mgr, { since: 1000 });
    assert.ok(result.content[0].text.includes("new"));
    assert.ok(!result.content[0].text.includes("old:"));
  });
});

describe("handleHistory", () => {
  it("returns history for all MUPs", () => {
    const ws = makeMockWs({
      "mup-test": [{ functionName: "doThing", args: {}, result: "ok", timestamp: Date.now() }],
    });
    const mgr = makeMockManager({
      all: [{ manifest: SAMPLE_MANIFEST, stateSummary: "" }],
    });
    const result = handleHistory(ws, mgr, {});
    assert.ok(result.content[0].text.includes("doThing"));
  });

  it("returns no-history message when empty", () => {
    const ws = makeMockWs({});
    const mgr = makeMockManager({ all: [] });
    const result = handleHistory(ws, mgr, {});
    assert.equal(result.content[0].text, "No call history yet.");
  });

  it("returns history for a specific mupId", () => {
    const ws = makeMockWs({
      "mup-test": [{ functionName: "doThing", args: { x: 1 }, result: "done", timestamp: Date.now() }],
    });
    const mgr = makeMockManager({
      all: [{ manifest: SAMPLE_MANIFEST, stateSummary: "counter=5" }],
    });
    const result = handleHistory(ws, mgr, { mupId: "mup-test" });
    assert.ok(result.content[0].text.includes("doThing"));
    assert.ok(result.content[0].text.includes("counter=5"));
  });

  it("returns no-history for unknown mupId", () => {
    const ws = makeMockWs({});
    const mgr = makeMockManager({ all: [] });
    const result = handleHistory(ws, mgr, { mupId: "mup-unknown" });
    assert.ok(result.content[0].text.includes("No call history for this MUP."));
  });
});

describe("handlePipe", () => {
  it("create succeeds with valid args", () => {
    const pipeline = makeMockPipeline();
    const result = handlePipe(pipeline, {
      subAction: "create",
      sourceMupId: "mup-a",
      targetMupId: "mup-b",
      targetFunction: "update",
      transform: { x: "." },
    });
    assert.ok(result.content[0].text.includes("Pipe created"));
  });

  it("create fails with missing args", () => {
    const pipeline = makeMockPipeline();
    const result = handlePipe(pipeline, { subAction: "create", sourceMupId: "mup-a" });
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.includes("requires"));
  });

  it("list shows pipes", () => {
    const pipes = [{ id: "pipe_1", sourceMupId: "a", targetMupId: "b", targetFunction: "fn", enabled: true, debounceMs: 500 }];
    const pipeline = makeMockPipeline(pipes);
    const result = handlePipe(pipeline, { subAction: "list" });
    assert.ok(result.content[0].text.includes("pipe_1"));
  });

  it("list shows empty message", () => {
    const pipeline = makeMockPipeline([]);
    const result = handlePipe(pipeline, { subAction: "list" });
    assert.equal(result.content[0].text, "No pipes defined.");
  });

  it("delete removes existing pipe", () => {
    const pipes = [{ id: "pipe_1" }];
    const pipeline = makeMockPipeline(pipes);
    const result = handlePipe(pipeline, { subAction: "delete", pipeId: "pipe_1" });
    assert.ok(result.content[0].text.includes("Deleted"));
  });

  it("enable enables existing pipe", () => {
    const pipes = [{ id: "pipe_1" }];
    const pipeline = makeMockPipeline(pipes);
    const result = handlePipe(pipeline, { subAction: "enable", pipeId: "pipe_1" });
    assert.ok(result.content[0].text.includes("Enabled"));
  });

  it("disable disables existing pipe", () => {
    const pipes = [{ id: "pipe_1" }];
    const pipeline = makeMockPipeline(pipes);
    const result = handlePipe(pipeline, { subAction: "disable", pipeId: "pipe_1" });
    assert.ok(result.content[0].text.includes("Disabled"));
  });

  it("unknown subAction returns error", () => {
    const pipeline = makeMockPipeline();
    const result = handlePipe(pipeline, { subAction: "explode" });
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.includes("subAction must be"));
  });
});

describe("handleToolCall routing", () => {
  let ctx: ToolCallContext;

  beforeEach(() => {
    ctx = {
      manager: makeMockManager({
        catalog: [{ active: true, manifest: SAMPLE_MANIFEST }],
        events: [],
        all: [{ manifest: SAMPLE_MANIFEST, stateSummary: "" }],
      }),
      bridge: makeMockBridge(),
      ws: makeMockWs({}),
      sendLoadMup: () => {},
      ensureActive: () => ({}),
      pipeline: makeMockPipeline(),
      scheduler: makeMockScheduler(),
    };
  });

  it("action=list dispatches to handleList", async () => {
    const result = await handleToolCall({ params: { arguments: { action: "list" } } }, ctx) as any;
    assert.ok(result.content[0].text.includes("[ACTIVE]"));
  });

  it("action=checkInteractions dispatches correctly", async () => {
    const result = await handleToolCall({ params: { arguments: { action: "checkInteractions" } } }, ctx) as any;
    assert.ok(result.content[0].text.includes("No interactions"));
  });

  it("action=history dispatches correctly", async () => {
    const result = await handleToolCall({ params: { arguments: { action: "history" } } }, ctx) as any;
    assert.ok(result.content[0].text.includes("No call history"));
  });

  it("action=setNotificationLevel validates inputs", async () => {
    const result = await handleToolCall(
      { params: { arguments: { action: "setNotificationLevel" } } }, ctx,
    ) as any;
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.includes("Provide"));
  });

  it("action=setNotificationLevel rejects invalid level", async () => {
    const result = await handleToolCall(
      { params: { arguments: { action: "setNotificationLevel", mupId: "mup-test", level: "bogus" } } }, ctx,
    ) as any;
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.includes("Invalid level"));
  });

  it("action=setFileAccess validates inputs", async () => {
    const result = await handleToolCall(
      { params: { arguments: { action: "setFileAccess" } } }, ctx,
    ) as any;
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.includes("Provide"));
  });

  it("action=setFileAccess succeeds with valid args", async () => {
    const result = await handleToolCall(
      { params: { arguments: { action: "setFileAccess", mupId: "mup-test", allowedPaths: ["/tmp"] } } }, ctx,
    ) as any;
    assert.ok(result.content[0].text.includes("File access"));
    assert.ok(result.content[0].text.includes("/tmp"));
  });

  it("missing mupId and functionName returns error", async () => {
    const result = await handleToolCall({ params: { arguments: {} } }, ctx) as any;
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.includes("Provide"));
  });
});
