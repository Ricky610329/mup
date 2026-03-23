import type { MupManager } from "./manager.js";
import type { WorkspaceManager } from "./workspace.js";
import type { PipelineManager } from "./pipeline.js";
import { CONFIG } from "./config.js";
import type { CallHistoryEntry } from "./types.js";

// ---- Helpers ----

export const text = (t: string) => ({ type: "text" as const, text: t });

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
    `Actions: checkInteractions, list, history, pipe`,
    `Multi-instance: call with the same base mupId again to open another instance (auto-assigned _2, _3...).`,
  ];
  if (active.length > 0) {
    lines.push(``, `Active MUPs:`);
    for (const e of active) {
      const multi = e.manifest.multiInstance ? " [multi]" : "";
      lines.push(`  ${e.manifest.id}${multi}: ${e.manifest.functions.map((f) => f.name).join(", ")}`);
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
