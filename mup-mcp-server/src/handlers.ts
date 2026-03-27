import type { MupManager } from "./manager.js";
import type { UiBridge } from "./bridge.js";
import type { WorkspaceManager } from "./workspace.js";
import type { PipelineManager } from "./pipeline.js";
import { CONFIG } from "./config.js";
import type { CallHistoryEntry, FunctionResult, GridLayoutItem, SendLoadMupFn } from "./types.js";

// ---- Tool Call Context ----

export interface ToolCallContext {
  manager: MupManager;
  bridge: UiBridge;
  ws: WorkspaceManager;
  sendLoadMup: SendLoadMupFn;
  ensureActive: (mupId: string) => { error?: string; activated?: string };
  pipeline: PipelineManager;
}

// ---- Helpers ----

export const text = (t: string) => ({ type: "text" as const, text: t });

export function parseArgs(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "string") { try { return JSON.parse(raw); } catch { return {}; } }
  if (typeof raw === "object") return raw as Record<string, unknown>;
  return {};
}

export function buildMupDetail(manifest: { name: string; id: string; description: string; functions: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> }): string {
  const lines = [`${manifest.name} (${manifest.id}): ${manifest.description}`];
  for (const fn of manifest.functions) {
    const props = (fn.inputSchema.properties || {}) as Record<string, Record<string, unknown>>;
    const required = (fn.inputSchema.required || []) as string[];
    const params = Object.entries(props).map(([k, v]) => `${k}${required.includes(k) ? "" : "?"}: ${v.type || "any"}`);
    lines.push(`  - ${fn.name}(${params.join(", ")}) — ${fn.description}`);
  }
  return lines.join("\n");
}

export function buildToolDescription(manager: MupManager, port: number): string {
  const catalog = manager.getCatalog();
  const active = catalog.filter((e) => e.active);
  const inactive = catalog.filter((e) => !e.active);
  const lines = [
    `MUP — Interactive UI panels in browser at http://localhost:${port}. Auto-activated on first use.`,
    ``, `Call: { "mupId": "...", "functionName": "...", "functionArgs": { ... } }`,
    `Actions: checkInteractions, list, history, pipe, setNotificationLevel, setLayout, getLayout`,
    `Multi-instance: use { "action": "new-instance", "mupId": "..." } to open another panel. Returns the new instance ID (_2, _3...).`,
  ];
  if (active.length > 0) {
    lines.push(``, `Active MUPs:`);
    for (const e of active) {
      const multi = e.manifest.multiInstance ? " [multi]" : "";
      const level = manager.getNotificationLevel(e.manifest.id);
      const levelTag = level !== "notify" ? ` [${level}]` : "";
      lines.push(`  ${e.manifest.id}${multi}${levelTag}: ${e.manifest.functions.map((f) => f.name).join(", ")}`);
    }
  }
  if (inactive.length > 0) {
    lines.push(``, `Available: ${inactive.map((e) => {
      const multi = e.manifest.multiInstance ? " [multi]" : "";
      return e.manifest.id + multi;
    }).join(", ")}`);
  }
  return lines.join("\n");
}

// ---- Action Handlers ----

export function handleList(manager: MupManager) {
  const sections = manager.getCatalog().map((e) => `${e.active ? "[ACTIVE]" : "[available]"} ${buildMupDetail(e.manifest)}`);
  return { content: [text(sections.join("\n\n"))] };
}

export function handleCheckInteractions(manager: MupManager, args: Record<string, unknown>) {
  const since = typeof args.since === "number" ? args.since : undefined;
  const events = manager.drainEvents(since);
  const states = manager.getAll().filter((m) => m.stateSummary).map((m) => `[${m.manifest.name}] ${m.stateSummary}`);
  const parts: string[] = [];

  if (events.length > 0) {
    const groups = new Map<string, { mupName: string; action: string; count: number; lastSummary: string }>();
    for (const e of events) {
      const key = `${e.mupName}|${e.action}`;
      const g = groups.get(key);
      if (g) { g.count++; g.lastSummary = e.summary; }
      else groups.set(key, { mupName: e.mupName, action: e.action, count: 1, lastSummary: e.summary });
    }
    const lines = Array.from(groups.values()).map((g) =>
      g.count === 1 ? `  [${g.mupName}] ${g.action}: ${g.lastSummary}` : `  [${g.mupName}] ${g.action} (${g.count}x, latest: ${g.lastSummary})`
    );
    parts.push("User interactions:\n" + lines.join("\n"));
  }
  if (states.length > 0) parts.push("Current states:\n" + states.map((s) => `  ${s}`).join("\n"));
  return { content: [text(parts.length > 0 ? parts.join("\n\n") : "No interactions or state changes.")] };
}

export function handleHistory(ws: WorkspaceManager, manager: MupManager, args: Record<string, unknown>) {
  const mupId = args.mupId as string;

  function formatHistory(history: CallHistoryEntry[], limit: number): string[] {
    const lines: string[] = [];
    if (history.length > limit) {
      const older = history.slice(0, -limit);
      const fnCounts = new Map<string, number>();
      for (const h of older) fnCounts.set(h.functionName, (fnCounts.get(h.functionName) || 0) + 1);
      lines.push(`  ... ${older.length} earlier calls: ${Array.from(fnCounts.entries()).map(([fn, c]) => `${fn}(${c}x)`).join(", ")}`);
    }
    for (const h of history.slice(-limit)) {
      const time = new Date(h.timestamp).toLocaleTimeString();
      const argStr = JSON.stringify(h.args);
      lines.push(`  [${time}] ${h.functionName}(${argStr.length > 80 ? argStr.slice(0, 80) + "..." : argStr}) → ${h.result}`);
    }
    return lines;
  }

  if (!mupId) {
    const parts: string[] = [];
    for (const mup of manager.getAll()) {
      const history = ws.callHistory[mup.manifest.id];
      if (history && history.length > 0) {
        parts.push(`## ${mup.manifest.name} (${mup.manifest.id})`);
        if (mup.stateSummary) parts.push(`State: ${mup.stateSummary}`);
        parts.push(`${history.length} calls:`, ...formatHistory(history, CONFIG.recentHistoryCount));
      }
    }
    return { content: [text(parts.length > 0 ? parts.join("\n") : "No call history yet.")] };
  }

  const history = ws.callHistory[mupId];
  const mup = manager.get(mupId);
  const parts: string[] = [];
  if (mup?.stateSummary) parts.push(`State: ${mup.stateSummary}`);
  if (!history || history.length === 0) parts.push("No call history for this MUP.");
  else { parts.push(`${history.length} calls:`, ...formatHistory(history, CONFIG.recentHistoryCount)); }
  return { content: [text(parts.join("\n"))] };
}

// ---- Pipe Handlers ----

export function handlePipe(pipeline: PipelineManager, args: Record<string, unknown>) {
  const sub = args.subAction as string;

  if (sub === "create") {
    if (!args.sourceMupId || !args.targetMupId || !args.targetFunction || !args.transform) {
      return { content: [text('Pipe create requires: sourceMupId, targetMupId, targetFunction, transform.')], isError: true };
    }
    const result = pipeline.addPipe({
      sourceMupId: args.sourceMupId as string,
      sourceFunction: args.sourceFunction as string | undefined,
      targetMupId: args.targetMupId as string,
      targetFunction: args.targetFunction as string,
      transform: args.transform as Record<string, string>,
      debounceMs: args.debounceMs as number | undefined,
    });
    if ("error" in result) return { content: [text(result.error)], isError: true };
    return { content: [text(`Pipe created: ${result.id} (${args.sourceMupId} → ${args.targetMupId}.${args.targetFunction})`)] };
  }

  if (sub === "list") {
    const pipes = pipeline.listPipes();
    if (pipes.length === 0) return { content: [text("No pipes defined.")] };
    const lines = pipes.map(p =>
      `${p.id}: ${p.sourceMupId}${p.sourceFunction ? `.${p.sourceFunction}` : ""} → ${p.targetMupId}.${p.targetFunction} [${p.enabled ? "active" : "disabled"}] (${p.debounceMs}ms)`
    );
    return { content: [text(lines.join("\n"))] };
  }

  if (sub === "delete") {
    if (!args.pipeId) return { content: [text('Provide "pipeId".')], isError: true };
    return { content: [text(pipeline.removePipe(args.pipeId as string) ? `Deleted ${args.pipeId}` : `Pipe not found: ${args.pipeId}`)] };
  }

  if (sub === "enable") {
    if (!args.pipeId) return { content: [text('Provide "pipeId".')], isError: true };
    return { content: [text(pipeline.enablePipe(args.pipeId as string) ? `Enabled ${args.pipeId}` : `Pipe not found: ${args.pipeId}`)] };
  }

  if (sub === "disable") {
    if (!args.pipeId) return { content: [text('Provide "pipeId".')], isError: true };
    return { content: [text(pipeline.disablePipe(args.pipeId as string) ? `Disabled ${args.pipeId}` : `Pipe not found: ${args.pipeId}`)] };
  }

  return { content: [text('Pipe subAction must be: create, list, delete, enable, disable.')], isError: true };
}

// ---- Tool Call Dispatch ----

export async function handleToolCall(
  request: { params: { arguments?: Record<string, unknown> } },
  ctx: ToolCallContext
) {
  const { manager, bridge, ws, sendLoadMup, ensureActive, pipeline } = ctx;
  const args = (request.params.arguments || {}) as Record<string, unknown>;

  // Dispatch by action
  if (args.action === "list") return handleList(manager);
  if (args.action === "checkInteractions") return handleCheckInteractions(manager, args);
  if (args.action === "history") return handleHistory(ws, manager, args);
  if (args.action === "pipe") return handlePipe(pipeline, args);
  if (args.action === "setNotificationLevel") {
    const mupId = args.mupId as string;
    const level = args.level as string;
    if (!mupId || !level) return { content: [text('Provide "mupId" and "level" ("immediate", "notify", or "silent").')], isError: true };
    if (!["immediate", "notify", "silent"].includes(level)) return { content: [text(`Invalid level "${level}". Use "immediate", "notify", or "silent".`)], isError: true };
    const error = manager.setNotificationLevel(mupId, level as "immediate" | "notify" | "silent");
    if (error) return { content: [text(error)], isError: true };
    const mup = manager.get(mupId);
    return { content: [text(`Notification level for "${mup?.manifest.name}" set to "${level}".`)] };
  }
  if (args.action === "getLayout") {
    // Ask browser for current live layout, wait for response
    const info = await new Promise<{ cols: number; cellSize: number; cellGap: number; viewportWidth: number; layout: GridLayoutItem[] } | null>((resolve) => {
      const timeout = setTimeout(() => resolve(null), 2000);
      bridge.typedOnce("grid-layout-info", (data) => {
        clearTimeout(timeout);
        resolve(data);
      });
      bridge.sendRaw({ type: "get-layout" });
    });
    if (!info) return { content: [text("Browser not connected or did not respond.")], isError: true };
    const lines = info.layout.map(l => `  ${l.id}: ${l.w}×${l.h} at (${l.x},${l.y})`);
    return { content: [text(`Grid: ${info.cols} columns, viewport ${info.viewportWidth}px, cell ${info.cellSize}px + ${info.cellGap}px gap\n\nPanels:\n${lines.join("\n")}`)] };
  }
  if (args.action === "setLayout") {
    const raw = args.layout ?? (args.functionArgs as Record<string, unknown>)?.layout ?? args.functionArgs;
    const layout = (Array.isArray(raw) ? raw : undefined) as GridLayoutItem[] | undefined;
    if (!layout) return { content: [text('Provide "layout": array of { id, x, y, w, h }. Pass via functionArgs.')], isError: true };
    for (const item of layout) {
      if (!item.id || item.x === undefined || item.y === undefined || item.w === undefined || item.h === undefined) {
        return { content: [text(`Each layout item needs: id, x, y, w, h. Invalid: ${JSON.stringify(item)}`)], isError: true };
      }
      // Auto-activate MUPs that aren't active yet
      ensureActive(item.id);
    }
    bridge.sendRaw({ type: "set-layout", layout });
    ws.gridLayout = layout;
    ws.markMetadataDirty();
    return { content: [text(`Layout updated for ${layout.length} panel(s): ${layout.map(l => `${l.id}(${l.w}×${l.h}@${l.x},${l.y})`).join(", ")}`)] };
  }
  if (args.action === "new-instance") {
    const baseMupId = args.mupId as string;
    if (!baseMupId) return { content: [text('Provide "mupId" for the base MUP to create an instance of.')], isError: true };
    ensureActive(baseMupId);
    const mup = manager.activateInstance(baseMupId);
    if (!mup) return { content: [text(`Cannot create instance: "${baseMupId}" not found or does not support multi-instance.`)], isError: true };
    sendLoadMup(mup.manifest.id, mup);
    ws.markMetadataDirty();
    console.error(`[mup-mcp] New instance: ${mup.manifest.name} (${mup.manifest.id})`);
    return { content: [text(`Created ${mup.manifest.id}\n${buildMupDetail(mup.manifest)}`)] };
  }
  // --- Call MUP function ---
  const mupId = args.mupId as string;
  const fn = args.functionName as string;
  if (!mupId || !fn) return { content: [text('Provide "mupId" and "functionName", or use "action": "list" / "checkInteractions" / "history".')], isError: true };

  const activation = ensureActive(mupId);
  if (activation.error) return { content: [text(activation.error)], isError: true };

  const fnArgs = parseArgs(args.functionArgs);

  // Lightweight schema validation: check required fields and basic types
  const mup = manager.get(mupId);
  const fnDef = mup?.manifest.functions.find(f => f.name === fn);
  if (fnDef?.inputSchema) {
    const schema = fnDef.inputSchema;
    const required = (schema.required || []) as string[];
    const properties = (schema.properties || {}) as Record<string, Record<string, unknown>>;
    const missing = required.filter(r => fnArgs[r] === undefined);
    if (missing.length > 0) {
      return { content: [text(`Missing required field(s): ${missing.join(", ")}`)], isError: true };
    }
    for (const [key, val] of Object.entries(fnArgs)) {
      const prop = properties[key];
      if (prop?.type && val !== undefined && val !== null) {
        const actual = Array.isArray(val) ? "array" : typeof val;
        if (prop.type === "integer" && (typeof val !== "number" || !Number.isInteger(val as number))) {
          return { content: [text(`Field "${key}" must be an integer, got ${typeof val}`)], isError: true };
        } else if (prop.type !== "integer" && prop.type !== actual && !(prop.type === "number" && actual === "number")) {
          return { content: [text(`Field "${key}" must be ${prop.type}, got ${actual}`)], isError: true };
        }
      }
    }
  }

  if (!mup?.stateSummary && manager.isActive(mupId)) await bridge.waitForMupLoaded(mupId);

  let result: FunctionResult;
  try {
    result = await bridge.callFunction(mupId, fn, fnArgs);
  } catch (err) {
    return { content: [text(`Function call failed: ${(err as Error).message}`)], isError: true };
  }
  const resultText = result.content.map((c) => c.text || "").join(" ").trim();
  ws.addCallHistory(mupId, fn, fnArgs, resultText);

  const content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> = [];
  if (activation.activated) content.push(text(`[Auto-activated] ${activation.activated}`));

  for (const c of result.content) {
    if (c.type === "image" && c.data && c.mimeType) {
      content.push({ type: "image", data: c.data as string, mimeType: c.mimeType as string });
    } else if (c.data !== undefined && c.type !== "image") {
      const json = JSON.stringify(c.data);
      if (json.length > CONFIG.maxDataResponseLength) {
        content.push({ type: "text", text: `[data truncated, ${json.length} chars. Use specific queries instead of full data dumps.]` });
      } else {
        content.push({ type: "text", text: json });
      }
    } else {
      let t = c.text || "";
      if (t.length > CONFIG.maxResponseLength) t = t.slice(0, CONFIG.maxResponseLength) + `\n... (truncated, ${t.length} chars total)`;
      content.push({ type: "text", text: t });
    }
  }

  ws.markMetadataDirty();
  return { content, isError: result.isError };
}
