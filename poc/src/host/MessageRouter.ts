import type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
  JsonRpcMessage,
} from "../protocol/types";
import { isResponse, isNotification, isRequest } from "../protocol/jsonrpc";

interface PendingRequest {
  mupId: string;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

type NotificationHandler = (mupId: string, params: Record<string, unknown>) => void;
type RequestHandler = (
  mupId: string,
  method: string,
  params: Record<string, unknown>
) => Promise<unknown>;

export class MessageRouter {
  private ports = new Map<string, MessagePort>();
  private pending = new Map<number, PendingRequest>();
  private notificationHandlers = new Map<string, NotificationHandler[]>();
  private requestHandler: RequestHandler | null = null;
  private nextId = 1;
  private readonly timeout: number;

  constructor(timeoutMs = 10_000) {
    this.timeout = timeoutMs;
  }

  /** Register a MUP's MessagePort for communication */
  registerMup(mupId: string, port: MessagePort): void {
    this.ports.set(mupId, port);
    port.onmessage = (event: MessageEvent) => {
      this.handleIncoming(mupId, event.data);
    };
  }

  /** Unregister a MUP, close its port, and reject any pending requests */
  unregisterMup(mupId: string): void {
    const port = this.ports.get(mupId);
    if (port) {
      port.close();
      this.ports.delete(mupId);
    }
    // Clean up orphaned pending requests for this MUP
    for (const [id, pending] of this.pending) {
      if (pending.mupId === mupId) {
        clearTimeout(pending.timer);
        this.pending.delete(id);
        pending.reject(new Error(`MUP ${mupId} unregistered`));
      }
    }
  }

  /** Send a JSON-RPC request and await the response */
  request(mupId: string, method: string, params?: Record<string, unknown>): Promise<unknown> {
    const port = this.ports.get(mupId);
    if (!port) {
      return Promise.reject(new Error(`MUP not found: ${mupId}`));
    }

    const id = this.nextId++;
    const msg: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request timeout: ${method} to ${mupId}`));
      }, this.timeout);

      this.pending.set(id, { mupId, resolve, reject, timer });
      port.postMessage(msg);
    });
  }

  /** Send a JSON-RPC notification (no response expected) */
  notify(mupId: string, method: string, params?: Record<string, unknown>): void {
    const port = this.ports.get(mupId);
    if (!port) return;

    const msg: JsonRpcNotification = { jsonrpc: "2.0", method, params };
    port.postMessage(msg);
  }

  /** Register a handler for notifications from MUPs */
  onNotification(method: string, handler: NotificationHandler): void {
    const handlers = this.notificationHandlers.get(method) ?? [];
    handlers.push(handler);
    this.notificationHandlers.set(method, handlers);
  }

  /** Register a handler for requests from MUPs (e.g., grid resize requests) */
  onRequest(handler: RequestHandler): void {
    this.requestHandler = handler;
  }

  private handleIncoming(mupId: string, data: unknown): void {
    const msg = data as JsonRpcMessage;
    if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0") return;

    if (isResponse(msg)) {
      this.handleResponse(msg);
    } else if (isNotification(msg)) {
      this.handleNotification(mupId, msg);
    } else if (isRequest(msg)) {
      this.handleRequest(mupId, msg);
    }
  }

  private handleResponse(msg: JsonRpcResponse): void {
    const id = msg.id as number;
    const pending = this.pending.get(id);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pending.delete(id);

    if (msg.error) {
      pending.reject(new Error(`${msg.error.message} (code: ${msg.error.code})`));
    } else {
      pending.resolve(msg.result);
    }
  }

  private handleNotification(mupId: string, msg: JsonRpcNotification): void {
    const handlers = this.notificationHandlers.get(msg.method);
    if (handlers) {
      for (const handler of handlers) {
        handler(mupId, msg.params ?? {});
      }
    }
  }

  private async handleRequest(mupId: string, msg: JsonRpcRequest): Promise<void> {
    const port = this.ports.get(mupId);
    if (!port) return;

    if (this.requestHandler) {
      try {
        const result = await this.requestHandler(mupId, msg.method, msg.params ?? {});
        const response: JsonRpcResponse = { jsonrpc: "2.0", id: msg.id, result: result as Record<string, unknown> };
        port.postMessage(response);
      } catch (err) {
        const code = (err as any).code ?? -32603;
        const response: JsonRpcResponse = {
          jsonrpc: "2.0",
          id: msg.id,
          error: { code, message: (err as Error).message },
        };
        port.postMessage(response);
      }
    }
  }
}
