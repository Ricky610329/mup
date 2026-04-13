// ---- MUP Data Pipeline ----
// Host-level feature: LLM defines data pipes between MUPs, server auto-executes them.
// MUPs are unaware of pipes — this is purely host orchestration.

export interface PipeTransform {
  /** Key mapping: { targetArgName: "source.path" }
   *  - "."          → entire source data
   *  - "pattern"    → sourceData.pattern
   *  - "params.bpm" → sourceData.params.bpm
   *  - "'literal'"  → literal string value (single-quoted)
   */
  mapping: Record<string, string>;
}

export interface PipeDefinition {
  id: string;
  sourceMupId: string;
  sourceFunction?: string;        // optional: call this to get data (else use stateData)
  targetMupId: string;
  targetFunction: string;
  transform: PipeTransform;
  enabled: boolean;
  debounceMs: number;
}

export interface PipeExecution {
  pipeId: string;
  timestamp: number;
  success: boolean;
  error?: string;
}

export type CallFn = (mupId: string, fnName: string, args: Record<string, unknown>) => Promise<any>;

import { CONFIG } from "./config.js";

const MAX_PIPES = 50;
const MAX_LOG = 30;
const DEFAULT_DEBOUNCE_MS = CONFIG.channelDebounceMs;

export class PipelineManager {
  private pipes = new Map<string, PipeDefinition>();
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private executingPipes = new Set<string>();
  private log: PipeExecution[] = [];
  private nextId = 1;
  private callFn: CallFn;

  constructor(
    callFn: CallFn,
    private onPipeError?: (pipeId: string, sourceMupId: string, targetMupId: string, error: string) => void,
  ) {
    this.callFn = callFn;
  }

  addPipe(opts: {
    sourceMupId: string;
    sourceFunction?: string;
    targetMupId: string;
    targetFunction: string;
    transform: Record<string, string>;
    debounceMs?: number;
  }): { id: string } | { error: string } {
    if (this.pipes.size >= MAX_PIPES) return { error: `Max ${MAX_PIPES} pipes reached.` };
    if (opts.sourceMupId === opts.targetMupId) return { error: "Source and target cannot be the same MUP." };

    const id = `pipe_${this.nextId++}`;
    const pipe: PipeDefinition = {
      id,
      sourceMupId: opts.sourceMupId,
      sourceFunction: opts.sourceFunction,
      targetMupId: opts.targetMupId,
      targetFunction: opts.targetFunction,
      transform: { mapping: opts.transform },
      enabled: true,
      debounceMs: opts.debounceMs ?? DEFAULT_DEBOUNCE_MS,
    };

    if (this.detectCycle(pipe)) return { error: `Adding this pipe would create a cycle.` };

    this.pipes.set(id, pipe);
    return { id };
  }

  removePipe(pipeId: string): boolean {
    this.clearDebounce(pipeId);
    return this.pipes.delete(pipeId);
  }

  enablePipe(pipeId: string): boolean {
    const p = this.pipes.get(pipeId);
    if (!p) return false;
    p.enabled = true;
    return true;
  }

  disablePipe(pipeId: string): boolean {
    const p = this.pipes.get(pipeId);
    if (!p) return false;
    p.enabled = false;
    this.clearDebounce(pipeId);
    return true;
  }

  listPipes(): PipeDefinition[] {
    return [...this.pipes.values()];
  }

  getLog(): PipeExecution[] {
    return [...this.log];
  }

  /** Called when a MUP's state updates. Schedules pipe execution with debounce. */
  onStateUpdate(mupId: string, stateData: unknown): void {
    for (const pipe of this.pipes.values()) {
      if (!pipe.enabled || pipe.sourceMupId !== mupId) continue;
      if (this.executingPipes.has(pipe.id)) continue; // re-entrance guard

      this.clearDebounce(pipe.id);
      const timer = setTimeout(() => {
        this.debounceTimers.delete(pipe.id);
        this.executePipe(pipe, stateData);
      }, pipe.debounceMs);
      this.debounceTimers.set(pipe.id, timer);
    }
  }

  /** Disable pipes involving a deactivated MUP */
  onMupDeactivated(mupId: string): void {
    for (const pipe of this.pipes.values()) {
      if (pipe.sourceMupId === mupId || pipe.targetMupId === mupId) {
        pipe.enabled = false;
        this.clearDebounce(pipe.id);
      }
    }
  }

  // ---- Internal ----

  private async executePipe(pipe: PipeDefinition, stateData: unknown): Promise<void> {
    this.executingPipes.add(pipe.id);
    try {
      let sourceData = stateData;
      if (pipe.sourceFunction) {
        const result = await this.callFn(pipe.sourceMupId, pipe.sourceFunction, {});
        // Extract data from function result
        sourceData = this.extractResultData(result);
      }

      const args = this.applyTransform(sourceData, pipe.transform);
      await this.callFn(pipe.targetMupId, pipe.targetFunction, args);

      this.addLog(pipe.id, true);
    } catch (err) {
      const errorMsg = (err as Error).message;
      this.addLog(pipe.id, false, errorMsg);
      this.onPipeError?.(pipe.id, pipe.sourceMupId, pipe.targetMupId, errorMsg);
    } finally {
      this.executingPipes.delete(pipe.id);
    }
  }

  private extractResultData(result: any): unknown {
    if (!result?.content) return result;
    for (const c of result.content) {
      if (c.data !== undefined) return c.data;
      if (c.text) {
        try { return JSON.parse(c.text); } catch { /* not JSON */ }
      }
    }
    return result;
  }

  private applyTransform(data: unknown, transform: PipeTransform): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, path] of Object.entries(transform.mapping)) {
      out[key] = this.resolveValue(data, path);
    }
    return out;
  }

  private resolveValue(data: unknown, expr: string): unknown {
    // Literal string: 'value'
    if (expr.startsWith("'") && expr.endsWith("'")) return expr.slice(1, -1);
    // Literal number
    if (/^-?\d+(\.\d+)?$/.test(expr)) return Number(expr);
    // Literal boolean
    if (expr === "true") return true;
    if (expr === "false") return false;
    // Entire object
    if (expr === ".") return data;
    // Dot-path traversal
    let current: any = data;
    for (const part of expr.split(".").filter(Boolean)) {
      if (current == null || typeof current !== "object") return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }

  private detectCycle(newPipe: PipeDefinition): boolean {
    // Build adjacency list from all enabled pipes + the new one
    const adj = new Map<string, Set<string>>();
    for (const pipe of this.pipes.values()) {
      if (!pipe.enabled) continue;
      if (!adj.has(pipe.sourceMupId)) adj.set(pipe.sourceMupId, new Set());
      adj.get(pipe.sourceMupId)!.add(pipe.targetMupId);
    }
    // Add proposed edge
    if (!adj.has(newPipe.sourceMupId)) adj.set(newPipe.sourceMupId, new Set());
    adj.get(newPipe.sourceMupId)!.add(newPipe.targetMupId);

    // DFS from target: can we reach source?
    const visited = new Set<string>();
    const stack = [newPipe.targetMupId];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (node === newPipe.sourceMupId) return true; // cycle!
      if (visited.has(node)) continue;
      visited.add(node);
      const neighbors = adj.get(node);
      if (neighbors) for (const n of neighbors) stack.push(n);
    }
    return false;
  }

  private clearDebounce(pipeId: string): void {
    const t = this.debounceTimers.get(pipeId);
    if (t) { clearTimeout(t); this.debounceTimers.delete(pipeId); }
  }

  private addLog(pipeId: string, success: boolean, error?: string): void {
    this.log.push({ pipeId, timestamp: Date.now(), success, error });
    if (this.log.length > MAX_LOG) this.log.splice(0, this.log.length - MAX_LOG);
  }
}
