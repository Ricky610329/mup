// ---- MUP Scheduler ----
// Host-level feature: LLM defines delayed calls and event-triggered call sequences.
// MUPs are unaware of the scheduler — this is purely host orchestration.
// Listeners default to once=true: fire once then auto-remove.

export type CallFn = (mupId: string, fnName: string, args: Record<string, unknown>) => Promise<any>;

const MAX_DELAYS = 50;
const MAX_LISTENERS = 50;
const MAX_CALLS_PER_LISTENER = 10;
const MAX_DELAY_MS = 300_000; // 5 minutes

export interface ScheduledCall {
  mupId: string;
  functionName: string;
  functionArgs: Record<string, unknown>;
  delayMs?: number; // delay relative to trigger time (for onEvent calls)
}

interface DelayEntry {
  id: string;
  timers: ReturnType<typeof setTimeout>[];
}

interface EventListener {
  id: string;
  sourceMupId: string;
  event: string;
  calls: ScheduledCall[];
  once: boolean;
  filter?: Record<string, unknown>;
}

export class Scheduler {
  private delays = new Map<string, DelayEntry>();
  private listeners = new Map<string, EventListener>();
  private nextDelayId = 1;
  private nextListenerId = 1;
  private callFn: CallFn;

  constructor(callFn: CallFn) {
    this.callFn = callFn;
  }

  // ---- Delayed Calls ----

  scheduleDelay(delayMs: number, calls: ScheduledCall[]): string | { error: string } {
    if (this.delays.size >= MAX_DELAYS) return { error: `Max ${MAX_DELAYS} pending delays reached.` };
    if (delayMs > MAX_DELAY_MS) return { error: `delayMs cannot exceed ${MAX_DELAY_MS} (5 minutes).` };
    if (calls.length > MAX_CALLS_PER_LISTENER) return { error: `Max ${MAX_CALLS_PER_LISTENER} calls per delay.` };

    const id = `delay_${this.nextDelayId++}`;
    const timer = setTimeout(async () => {
      this.delays.delete(id);
      await this.executeCalls(calls, id);
    }, delayMs);

    this.delays.set(id, { id, timers: [timer] });
    return id;
  }

  cancelDelay(scheduleId: string): boolean {
    const entry = this.delays.get(scheduleId);
    if (!entry) return false;
    for (const t of entry.timers) clearTimeout(t);
    this.delays.delete(scheduleId);
    return true;
  }

  // ---- Event Listeners ----

  registerEvent(sourceMupId: string, event: string, calls: ScheduledCall[], once: boolean = true, filter?: Record<string, unknown>): string | { error: string } {
    if (this.listeners.size >= MAX_LISTENERS) return { error: `Max ${MAX_LISTENERS} event listeners reached.` };
    if (calls.length > MAX_CALLS_PER_LISTENER) return { error: `Max ${MAX_CALLS_PER_LISTENER} calls per listener.` };

    const id = `evt_${this.nextListenerId++}`;
    this.listeners.set(id, { id, sourceMupId, event, calls, once, filter });
    return id;
  }

  removeEvent(listenerId?: string): boolean | { removed: number } {
    if (!listenerId) {
      const count = this.delays.size + this.listeners.size;
      this.clearAll();
      return { removed: count };
    }
    return this.listeners.delete(listenerId);
  }

  async onMupEvent(mupId: string, event: string, data?: unknown): Promise<void> {
    const toRemove: string[] = [];
    let onceHandled = false;

    for (const [id, listener] of this.listeners) {
      if (listener.sourceMupId !== mupId || listener.event !== event) continue;

      if (listener.filter) {
        const d = data as Record<string, unknown> | undefined;
        const match = Object.entries(listener.filter).every(([k, v]) => d?.[k] === v);
        if (!match) continue;
      }

      if (listener.once) {
        if (!listener.filter && onceHandled) continue;
        if (!listener.filter) onceHandled = true;
        toRemove.push(id);
      }

      await this.executeCalls(listener.calls, id);
    }

    for (const id of toRemove) this.listeners.delete(id);
  }

  // ---- Shared call executor ----

  private async executeCalls(calls: ScheduledCall[], sourceId: string): Promise<void> {
    for (const call of calls) {
      if (call.delayMs && call.delayMs > 0) {
        setTimeout(async () => {
          try {
            await this.callFn(call.mupId, call.functionName, call.functionArgs);
          } catch (e: any) {
            console.error(`[mup-mcp] Scheduler ${sourceId} delayed call failed:`, e.message || e);
          }
        }, call.delayMs);
      } else {
        try {
          await this.callFn(call.mupId, call.functionName, call.functionArgs);
        } catch (e: any) {
          console.error(`[mup-mcp] Scheduler ${sourceId} call failed:`, e.message || e);
        }
      }
    }
  }

  // ---- Cleanup ----

  clearAll(): void {
    for (const entry of this.delays.values()) {
      for (const t of entry.timers) clearTimeout(t);
    }
    this.delays.clear();
    this.listeners.clear();
  }

  get pendingDelays(): number { return this.delays.size; }
  get activeListeners(): number { return this.listeners.size; }
}
