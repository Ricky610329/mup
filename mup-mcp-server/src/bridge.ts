import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { EventEmitter } from "node:events";
import type { MupManager } from "./manager.js";
import { CONFIG } from "./config.js";
import type {
  FunctionResult,
  BrowserMessage,
  ServerMessage,
  BridgeEvents,
  CatalogSummary,
  FolderTreeNode,
} from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface PendingCall {
  resolve: (result: FunctionResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

// ---- Typed Event Emitter ----

export class UiBridge extends EventEmitter {
  private httpServer: http.Server;
  private wss: WebSocketServer;
  private ws: WebSocket | null = null;
  private pendingCalls = new Map<string, PendingCall>();
  private callIdCounter = 0;
  private connectionEpoch = 0;
  private port: number;
  private manager: MupManager;
  public folderTree: FolderTreeNode[] = [];
  public folderPath: string = "";

  constructor(manager: MupManager, port: number) {
    super();
    this.manager = manager;
    this.port = port;

    this.httpServer = http.createServer((req, res) => this.handleHttp(req, res));
    this.wss = new WebSocketServer({ server: this.httpServer, maxPayload: 10 * 1024 * 1024 });

    this.wss.on("connection", (ws) => {
      this.connectionEpoch++;
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        console.error("[mup-mcp] New connection replacing existing one");
        this.ws.close(4001, "Replaced by new connection");
        for (const [id, pending] of this.pendingCalls) {
          clearTimeout(pending.timer);
          pending.resolve({ content: [{ type: "text", text: "Browser reconnected — previous call cancelled" }], isError: true });
          this.pendingCalls.delete(id);
        }
      }

      this.ws = ws;
      console.error("[mup-mcp] Browser panel connected");
      this.typedEmit("browser-connected");

      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString()) as BrowserMessage;
          this.handleBrowserMessage(msg);
        } catch (e) {
          console.error("[mup-mcp] Invalid message from browser:", e);
        }
      });

      ws.on("close", () => {
        console.error("[mup-mcp] Browser panel disconnected");
        this.ws = null;
        for (const [id, pending] of this.pendingCalls) {
          clearTimeout(pending.timer);
          pending.resolve({ content: [{ type: "text", text: "Browser disconnected" }], isError: true });
          this.pendingCalls.delete(id);
        }
        this.typedEmit("browser-disconnected");
      });

      // Send catalog + folder tree on connect
      this.sendRaw({ type: "mup-catalog", catalog: this.buildCatalogSummary() });
      if (this.folderTree.length > 0) {
        this.sendRaw({ type: "folder-tree", tree: this.folderTree, path: this.folderPath });
      }

      // Send already-active MUPs with saved state
      for (const mup of this.manager.getAll()) {
        this.sendRaw({
          type: "load-mup",
          mupId: mup.manifest.id,
          html: mup.html,
          manifest: mup.manifest,
        });
      }
    });
  }

  // ---- Typed Event Helpers ----

  typedOn<K extends keyof BridgeEvents>(event: K, listener: BridgeEvents[K]): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  typedOnce<K extends keyof BridgeEvents>(event: K, listener: BridgeEvents[K]): this {
    return super.once(event, listener as (...args: unknown[]) => void);
  }

  typedEmit<K extends keyof BridgeEvents>(event: K, ...args: Parameters<BridgeEvents[K]>): boolean {
    return super.emit(event, ...args);
  }

  // ---- Lifecycle ----

  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.httpServer.listen(this.port, () => {
        console.error(`[mup-mcp] UI panel: http://localhost:${this.port}`);
        resolve();
      });
    });
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /** Wait for a specific MUP to finish loading in the browser, with timeout fallback */
  waitForMupLoaded(mupId: string, timeoutMs = CONFIG.functionCallTimeoutMs): Promise<void> {
    return new Promise((resolve) => {
      const onLoaded = (loadedId: string) => {
        if (loadedId === mupId) { clearTimeout(timer); this.removeListener("mup-loaded", onLoaded); resolve(); }
      };
      const timer = setTimeout(() => { this.removeListener("mup-loaded", onLoaded); resolve(); }, timeoutMs);
      this.on("mup-loaded", onLoaded);
    });
  }

  // ---- Communication ----

  sendRaw(msg: ServerMessage): void {
    if (this.isConnected()) {
      this.ws!.send(JSON.stringify(msg));
    }
  }

  async callFunction(mupId: string, functionName: string, args: Record<string, unknown>): Promise<FunctionResult> {
    if (!this.isConnected()) {
      return {
        content: [{ type: "text", text: `MUP UI panel is not connected. Ask the user to open http://localhost:${this.port} in their browser.` }],
        isError: true,
      };
    }

    const callId = `c${this.connectionEpoch}_${++this.callIdCounter}`;

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingCalls.delete(callId);
        this.sendRaw({ type: "error", message: `${functionName} timed out (30s) on ${mupId}` });
        resolve({ content: [{ type: "text", text: "Function call timed out (30s)" }], isError: true });
      }, CONFIG.functionCallTimeoutMs);

      this.pendingCalls.set(callId, { resolve, timer });
      this.sendRaw({ type: "call", callId, mupId, fn: functionName, args });
    });
  }

  getPort(): number {
    return this.port;
  }

  // ---- Helpers ----

  buildCatalogSummary(): CatalogSummary[] {
    return this.manager.getCatalog().map((e) => ({
      id: e.manifest.id,
      name: e.manifest.name,
      description: e.manifest.description,
      functions: e.manifest.functions.length,
      active: e.active,
      grid: e.manifest.grid,
      multiInstance: e.manifest.multiInstance || false,
    }));
  }

  // ---- Message Dispatch ----

  private handleBrowserMessage(msg: BrowserMessage): void {
    switch (msg.type) {
      case "ready":
        console.error("[mup-mcp] Browser panel ready");
        break;

      case "mup-loaded":
        console.error(`[mup-mcp] MUP initialized: ${msg.mupId}`);
        this.typedEmit("mup-loaded", msg.mupId);
        break;

      case "result": {
        const pending = this.pendingCalls.get(msg.callId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingCalls.delete(msg.callId);
          pending.resolve(msg.result);
        } else {
          console.error(`[mup-mcp] Discarding stale result for ${msg.callId}`);
        }
        break;
      }

      case "state":
        this.manager.updateState(msg.mupId, msg.summary);
        this.typedEmit("state-update", msg.mupId, msg.summary, msg.data);
        break;

      case "interaction":
        this.manager.addEvent(msg.mupId, msg.action, msg.summary, msg.data);
        this.typedEmit("interaction", msg.mupId, msg.action, msg.summary, msg.data);
        break;

      case "activate-mup":
        this.typedEmit("activate-mup", msg.mupId);
        break;

      case "deactivate-mup":
        this.typedEmit("deactivate-mup", msg.mupId);
        break;

      case "register-and-activate":
        this.typedEmit("register-and-activate", msg.mupId, msg.html, msg.fileName);
        break;

      case "load-folder":
        this.typedEmit("load-folder", msg.mups);
        break;

      case "new-instance":
        this.typedEmit("new-instance", msg.mupId, msg.customName);
        break;

      case "save-grid-layout":
        this.typedEmit("save-grid-layout", msg.layout);
        break;

      case "rename-mup":
        this.typedEmit("rename-mup", msg.mupId, msg.customName);
        break;

      case "flush-save":
        this.typedEmit("flush-save");
        break;

      case "rename-workspace":
        this.typedEmit("rename-workspace", msg.name);
        break;

      case "set-mups-path":
        this.typedEmit("set-mups-path", msg.path);
        break;
    }
  }

  // ---- HTTP ----

  private handleHttp(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (req.url === "/" || req.url === "/index.html") {
      const uiPath = path.join(__dirname, "..", "ui", "index.html");
      try {
        let content = fs.readFileSync(uiPath, "utf-8");
        content = content.replace(/__WS_PORT__/g, String(this.port));
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
        res.end(content);
      } catch (err) {
        console.error("[mup-mcp] UI file not found:", uiPath, err);
        res.writeHead(500);
        res.end("UI file not found. Check installation.");
      }
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  }
}
