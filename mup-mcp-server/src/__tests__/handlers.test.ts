import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  parseArgs,
  handleList,
  handleCheckInteractions,
  handleHistory,
  handlePipe,
  handleToolCall,
  buildToolDescription,
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

  it("action=detail returns MUP function details", async () => {
    const result = await handleToolCall({ params: { arguments: { action: "detail", mupId: "mup-test" } } }, ctx) as any;
    assert.ok(result.content[0].text.includes("doThing"));
    assert.ok(result.content[0].text.includes("Does a thing"));
  });

  it("action=detail returns error for missing mupId", async () => {
    const result = await handleToolCall({ params: { arguments: { action: "detail" } } }, ctx) as any;
    assert.equal(result.isError, true);
  });

  it("action=detail returns error for unknown mupId", async () => {
    const result = await handleToolCall({ params: { arguments: { action: "detail", mupId: "mup-unknown" } } }, ctx) as any;
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.includes("not found"));
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

// ---- buildToolDescription Tests ----

const MULTI_MANIFEST = {
  name: "Multi MUP",
  id: "mup-multi",
  description: "A multi-instance MUP for testing",
  multiInstance: true,
  functions: [
    { name: "alpha", description: "Alpha fn", inputSchema: { type: "object", properties: {} } },
    { name: "beta", description: "Beta fn", inputSchema: { type: "object", properties: {} } },
  ],
};

describe("buildToolDescription", () => {
  it("generates compact format with name, description, and fn count", () => {
    const mgr = makeMockManager({
      catalog: [{ active: true, manifest: SAMPLE_MANIFEST }],
    });
    const desc = buildToolDescription(mgr, 3000);
    // Should include id, fn count, and description — NOT list individual function names
    assert.ok(desc.includes("mup-test"));
    assert.ok(desc.includes("1 fn"));
    assert.ok(desc.includes("A test MUP"));
    // Should NOT list individual function names in the compact listing
    assert.ok(!desc.includes("doThing"));
  });

  it("separates active and inactive MUPs", () => {
    const mgr = makeMockManager({
      catalog: [
        { active: true, manifest: SAMPLE_MANIFEST },
        { active: false, manifest: { ...SAMPLE_MANIFEST, id: "mup-inactive", name: "Inactive" } },
      ],
    });
    const desc = buildToolDescription(mgr, 3000);
    assert.ok(desc.includes("Active MUPs:"));
    assert.ok(desc.includes("mup-test"));
    assert.ok(desc.includes("Available:"));
    assert.ok(desc.includes("mup-inactive"));
    // "detail" hint should appear when there are active MUPs
    assert.ok(desc.includes("detail"));
  });

  it("shows [multi] tag for multiInstance MUPs", () => {
    const mgr = makeMockManager({
      catalog: [
        { active: true, manifest: MULTI_MANIFEST },
      ],
    });
    const desc = buildToolDescription(mgr, 3000);
    assert.ok(desc.includes("[multi]"));
    assert.ok(desc.includes("2 fn"));
  });

  it("shows notification level override when not 'notify'", () => {
    const mgr = makeMockManager({
      catalog: [{ active: true, manifest: SAMPLE_MANIFEST }],
      notifLevel: "silent",
    });
    const desc = buildToolDescription(mgr, 3000);
    assert.ok(desc.includes("[silent]"));
  });

  it("omits notification level tag when level is 'notify' (default)", () => {
    const mgr = makeMockManager({
      catalog: [{ active: true, manifest: SAMPLE_MANIFEST }],
      notifLevel: "notify",
    });
    const desc = buildToolDescription(mgr, 3000);
    assert.ok(!desc.includes("[notify]"));
  });

  it("includes port in localhost URL", () => {
    const mgr = makeMockManager({ catalog: [] });
    const desc = buildToolDescription(mgr, 4567);
    assert.ok(desc.includes("http://localhost:4567"));
  });

  it("truncates long descriptions to 60 chars", () => {
    const longDesc = "A".repeat(80);
    const longManifest = { ...SAMPLE_MANIFEST, id: "mup-long", description: longDesc };
    const mgr = makeMockManager({
      catalog: [{ active: true, manifest: longManifest }],
    });
    const desc = buildToolDescription(mgr, 3000);
    // Original is 80 chars, should be truncated to 57 + "..."
    assert.ok(desc.includes("..."));
    assert.ok(!desc.includes(longDesc));
  });

  it("shows only Available section when no active MUPs", () => {
    const mgr = makeMockManager({
      catalog: [
        { active: false, manifest: SAMPLE_MANIFEST },
      ],
    });
    const desc = buildToolDescription(mgr, 3000);
    assert.ok(!desc.includes("Active MUPs:"));
    assert.ok(desc.includes("Available:"));
    // No "detail" hint since no active MUPs
    assert.ok(!desc.includes("Use { \"action\": \"detail\""));
  });

  it("shows inactive multi-instance MUPs with [multi] in Available line", () => {
    const mgr = makeMockManager({
      catalog: [{ active: false, manifest: MULTI_MANIFEST }],
    });
    const desc = buildToolDescription(mgr, 3000);
    assert.ok(desc.includes("mup-multi [multi]"));
  });
});

// ---- handleToolCall schema validation ----

const SCHEMA_MANIFEST = {
  name: "Schema MUP",
  id: "mup-schema",
  description: "MUP with strict schema",
  functions: [
    {
      name: "create",
      description: "Create something",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          count: { type: "integer" },
          tags: { type: "array" },
        },
        required: ["title", "count"],
      },
    },
  ],
};

describe("handleToolCall schema validation", () => {
  let ctx: ToolCallContext;

  beforeEach(() => {
    ctx = {
      manager: makeMockManager({
        catalog: [{ active: true, manifest: SCHEMA_MANIFEST }],
        events: [],
        all: [{ manifest: SCHEMA_MANIFEST, stateSummary: "ready" }],
      }),
      bridge: makeMockBridge(),
      ws: makeMockWs({}),
      sendLoadMup: () => {},
      ensureActive: () => ({}),
      pipeline: makeMockPipeline(),
      scheduler: makeMockScheduler(),
    };
  });

  it("returns error for missing required field", async () => {
    const result = await handleToolCall({
      params: { arguments: { mupId: "mup-schema", functionName: "create", functionArgs: { title: "hi" } } },
    }, ctx) as any;
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.includes("Missing required field(s)"));
    assert.ok(result.content[0].text.includes("count"));
  });

  it("returns error for multiple missing required fields", async () => {
    const result = await handleToolCall({
      params: { arguments: { mupId: "mup-schema", functionName: "create", functionArgs: {} } },
    }, ctx) as any;
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.includes("title"));
    assert.ok(result.content[0].text.includes("count"));
  });

  it("returns error when string given where integer expected", async () => {
    const result = await handleToolCall({
      params: { arguments: { mupId: "mup-schema", functionName: "create", functionArgs: { title: "hi", count: "five" } } },
    }, ctx) as any;
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.includes("count"));
    assert.ok(result.content[0].text.includes("integer"));
  });

  it("returns error when float given where integer expected", async () => {
    const result = await handleToolCall({
      params: { arguments: { mupId: "mup-schema", functionName: "create", functionArgs: { title: "hi", count: 3.14 } } },
    }, ctx) as any;
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.includes("count"));
    assert.ok(result.content[0].text.includes("integer"));
  });

  it("returns error when wrong type provided (string where array expected)", async () => {
    const result = await handleToolCall({
      params: { arguments: { mupId: "mup-schema", functionName: "create", functionArgs: { title: "hi", count: 5, tags: "not-array" } } },
    }, ctx) as any;
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.includes("tags"));
    assert.ok(result.content[0].text.includes("array"));
  });

  it("succeeds with valid args matching schema", async () => {
    const result = await handleToolCall({
      params: { arguments: { mupId: "mup-schema", functionName: "create", functionArgs: { title: "hi", count: 5 } } },
    }, ctx) as any;
    assert.equal(result.isError, false);
  });
});

// ---- handleToolCall setNotificationLevel ----

describe("handleToolCall setNotificationLevel", () => {
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

  it("succeeds with valid level 'immediate'", async () => {
    const result = await handleToolCall({
      params: { arguments: { action: "setNotificationLevel", mupId: "mup-test", level: "immediate" } },
    }, ctx) as any;
    assert.equal(result.isError, undefined);
    assert.ok(result.content[0].text.includes("Notification level"));
    assert.ok(result.content[0].text.includes("immediate"));
  });

  it("succeeds with valid level 'silent'", async () => {
    const result = await handleToolCall({
      params: { arguments: { action: "setNotificationLevel", mupId: "mup-test", level: "silent" } },
    }, ctx) as any;
    assert.equal(result.isError, undefined);
    assert.ok(result.content[0].text.includes("silent"));
  });

  it("succeeds with valid level 'notify'", async () => {
    const result = await handleToolCall({
      params: { arguments: { action: "setNotificationLevel", mupId: "mup-test", level: "notify" } },
    }, ctx) as any;
    assert.equal(result.isError, undefined);
    assert.ok(result.content[0].text.includes("notify"));
  });

  it("returns error when MUP not found", async () => {
    const result = await handleToolCall({
      params: { arguments: { action: "setNotificationLevel", mupId: "mup-nonexistent", level: "silent" } },
    }, ctx) as any;
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.includes("not found"));
  });
});

// ---- handlePipe edge cases ----

describe("handlePipe edge cases", () => {
  it("create fails with missing sourceMupId", () => {
    const pipeline = makeMockPipeline();
    const result = handlePipe(pipeline, {
      subAction: "create",
      targetMupId: "mup-b",
      targetFunction: "update",
      transform: { x: "." },
    });
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.includes("requires"));
  });

  it("create fails with missing targetFunction", () => {
    const pipeline = makeMockPipeline();
    const result = handlePipe(pipeline, {
      subAction: "create",
      sourceMupId: "mup-a",
      targetMupId: "mup-b",
      transform: { x: "." },
    });
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.includes("requires"));
  });

  it("create fails with missing transform", () => {
    const pipeline = makeMockPipeline();
    const result = handlePipe(pipeline, {
      subAction: "create",
      sourceMupId: "mup-a",
      targetMupId: "mup-b",
      targetFunction: "update",
    });
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.includes("requires"));
  });

  it("create fails with missing targetMupId", () => {
    const pipeline = makeMockPipeline();
    const result = handlePipe(pipeline, {
      subAction: "create",
      sourceMupId: "mup-a",
      targetFunction: "update",
      transform: { x: "." },
    });
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.includes("requires"));
  });

  it("delete non-existing pipe returns not found message", () => {
    const pipeline = makeMockPipeline([]); // no pipes
    const result = handlePipe(pipeline, { subAction: "delete", pipeId: "pipe_999" });
    assert.ok(result.content[0].text.includes("Pipe not found"));
  });

  it("enable non-existing pipe returns not found message", () => {
    const pipeline = makeMockPipeline([]); // no pipes
    const result = handlePipe(pipeline, { subAction: "enable", pipeId: "pipe_999" });
    assert.ok(result.content[0].text.includes("Pipe not found"));
  });

  it("disable non-existing pipe returns not found message", () => {
    const pipeline = makeMockPipeline([]); // no pipes
    const result = handlePipe(pipeline, { subAction: "disable", pipeId: "pipe_999" });
    assert.ok(result.content[0].text.includes("Pipe not found"));
  });

  it("delete without pipeId returns error", () => {
    const pipeline = makeMockPipeline();
    const result = handlePipe(pipeline, { subAction: "delete" });
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.includes("pipeId"));
  });

  it("enable without pipeId returns error", () => {
    const pipeline = makeMockPipeline();
    const result = handlePipe(pipeline, { subAction: "enable" });
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.includes("pipeId"));
  });

  it("disable without pipeId returns error", () => {
    const pipeline = makeMockPipeline();
    const result = handlePipe(pipeline, { subAction: "disable" });
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.includes("pipeId"));
  });

  it("create fails when source and target are the same MUP", () => {
    const pipeline = makeMockPipeline();
    const result = handlePipe(pipeline, {
      subAction: "create",
      sourceMupId: "mup-a",
      targetMupId: "mup-a",
      targetFunction: "update",
      transform: { x: "." },
    });
    assert.equal(result.isError, true);
  });
});

// ---- handleHistory edge cases ----

const SECOND_MANIFEST = {
  name: "Second MUP",
  id: "mup-second",
  description: "Another test MUP",
  functions: [
    { name: "render", description: "Render something", inputSchema: { type: "object", properties: {} } },
  ],
};

describe("handleHistory edge cases", () => {
  it("returns history for multiple MUPs", () => {
    const now = Date.now();
    const ws = makeMockWs({
      "mup-test": [
        { functionName: "doThing", args: { x: 1 }, result: "ok", timestamp: now },
      ],
      "mup-second": [
        { functionName: "render", args: {}, result: "done", timestamp: now },
      ],
    });
    const mgr = makeMockManager({
      all: [
        { manifest: SAMPLE_MANIFEST, stateSummary: "" },
        { manifest: SECOND_MANIFEST, stateSummary: "loaded" },
      ],
    });
    const result = handleHistory(ws, mgr, {});
    const output = result.content[0].text;
    assert.ok(output.includes("Test MUP"));
    assert.ok(output.includes("doThing"));
    assert.ok(output.includes("Second MUP"));
    assert.ok(output.includes("render"));
    // Second MUP has a stateSummary
    assert.ok(output.includes("loaded"));
  });

  it("truncates long history and shows summary of older calls", () => {
    const now = Date.now();
    // Create more entries than CONFIG.recentHistoryCount (which is 5)
    const history = [];
    for (let i = 0; i < 10; i++) {
      history.push({
        functionName: i < 7 ? "doThing" : "otherFn",
        args: { x: i },
        result: `result-${i}`,
        timestamp: now + i * 1000,
      });
    }
    const ws = makeMockWs({ "mup-test": history });
    const mgr = makeMockManager({
      all: [{ manifest: SAMPLE_MANIFEST, stateSummary: "" }],
    });
    const result = handleHistory(ws, mgr, {});
    const output = result.content[0].text;
    // Should include truncation summary for older entries
    assert.ok(output.includes("earlier calls"));
    // The 5 most recent should still show up individually
    assert.ok(output.includes("result-9"));
    assert.ok(output.includes("result-5"));
    // Total count should be 10
    assert.ok(output.includes("10 calls"));
  });

  it("truncates long history for specific mupId", () => {
    const now = Date.now();
    const history = [];
    for (let i = 0; i < 8; i++) {
      history.push({
        functionName: "doThing",
        args: { x: i },
        result: `r${i}`,
        timestamp: now + i * 1000,
      });
    }
    const ws = makeMockWs({ "mup-test": history });
    const mgr = makeMockManager({
      all: [{ manifest: SAMPLE_MANIFEST, stateSummary: "counter=42" }],
    });
    const result = handleHistory(ws, mgr, { mupId: "mup-test" });
    const output = result.content[0].text;
    assert.ok(output.includes("earlier calls"));
    assert.ok(output.includes("8 calls"));
    assert.ok(output.includes("counter=42"));
  });

  it("shows stateSummary for specific mupId even with no history", () => {
    const ws = makeMockWs({});
    const mgr = makeMockManager({
      all: [{ manifest: SAMPLE_MANIFEST, stateSummary: "idle-state" }],
    });
    const result = handleHistory(ws, mgr, { mupId: "mup-test" });
    const output = result.content[0].text;
    assert.ok(output.includes("idle-state"));
    assert.ok(output.includes("No call history for this MUP."));
  });

  it("truncation summary groups by function name with counts", () => {
    const now = Date.now();
    const history = [];
    // 3 calls to "doThing", 4 calls to "otherFn", then 5 recent
    for (let i = 0; i < 3; i++) {
      history.push({ functionName: "doThing", args: {}, result: "ok", timestamp: now + i });
    }
    for (let i = 0; i < 4; i++) {
      history.push({ functionName: "otherFn", args: {}, result: "ok", timestamp: now + 3 + i });
    }
    for (let i = 0; i < 5; i++) {
      history.push({ functionName: "recentFn", args: {}, result: "ok", timestamp: now + 7 + i });
    }
    const ws = makeMockWs({ "mup-test": history });
    const mgr = makeMockManager({
      all: [{ manifest: SAMPLE_MANIFEST, stateSummary: "" }],
    });
    const result = handleHistory(ws, mgr, {});
    const output = result.content[0].text;
    // 7 older calls should be summarized
    assert.ok(output.includes("7 earlier calls"));
    assert.ok(output.includes("doThing(3x)"));
    assert.ok(output.includes("otherFn(4x)"));
  });
});
