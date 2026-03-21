import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { EventEmitter } from "node:events";
import type { MupManager } from "./manager.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface PendingCall {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface FunctionResult {
  content: Array<{
    type: string;
    text?: string;
    data?: unknown;
    mimeType?: string;
  }>;
  isError: boolean;
}

export class UiBridge extends EventEmitter {
  private httpServer: http.Server;
  private wss: WebSocketServer;
  private ws: WebSocket | null = null;
  private pendingCalls = new Map<string, PendingCall>();
  private callIdCounter = 0;
  private port: number;
  private manager: MupManager;
  public folderTree: unknown[] = [];
  public folderPath: string = "";

  constructor(manager: MupManager, port: number) {
    super();
    this.manager = manager;
    this.port = port;

    this.httpServer = http.createServer((req, res) =>
      this.handleHttp(req, res)
    );
    this.wss = new WebSocketServer({ server: this.httpServer });

    this.wss.on("connection", (ws) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        ws.close(4000, "Another panel is already connected");
        return;
      }

      this.ws = ws;
      console.error("[mup-mcp] Browser panel connected");
      this.emit("browser-connected");

      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
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
          pending.reject(new Error("Browser disconnected"));
          this.pendingCalls.delete(id);
        }
      });

      // Send catalog + folder tree on connect
      const catalog = this.manager.getCatalog().map((e) => ({
        id: e.manifest.id,
        name: e.manifest.name,
        description: e.manifest.description,
        functions: e.manifest.functions.length,
        active: e.active,
        grid: e.manifest.grid,
        multiInstance: e.manifest.multiInstance || false,
      }));
      ws.send(JSON.stringify({ type: "mup-catalog", catalog }));
      if (this.folderTree.length > 0) {
        ws.send(JSON.stringify({ type: "folder-tree", tree: this.folderTree, path: this.folderPath }));
      }

      // Send already-active MUPs with saved state
      for (const mup of this.manager.getAll()) {
        ws.send(
          JSON.stringify({
            type: "load-mup",
            mupId: mup.manifest.id,
            html: mup.html,
            manifest: mup.manifest,
            savedState: mup.stateData,
          })
        );
      }
    });
  }

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

  sendRaw(msg: Record<string, unknown>): void {
    if (this.isConnected()) {
      this.ws!.send(JSON.stringify(msg));
    }
  }

  async callFunction(
    mupId: string,
    functionName: string,
    args: Record<string, unknown>
  ): Promise<FunctionResult> {
    if (!this.isConnected()) {
      const msg = `MUP UI panel is not connected. Ask the user to open http://localhost:${this.port} in their browser.`;
      return {
        content: [{ type: "text", text: msg }],
        isError: true,
      };
    }

    const callId = `c${++this.callIdCounter}`;

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingCalls.delete(callId);
        this.sendRaw({ type: "error", message: `${functionName} timed out (30s) on ${mupId}` });
        resolve({
          content: [{ type: "text", text: "Function call timed out (30s)" }],
          isError: true,
        });
      }, 30_000);

      this.pendingCalls.set(callId, {
        resolve: (result) => resolve(result as FunctionResult),
        reject: () =>
          resolve({
            content: [{ type: "text", text: "Call failed" }],
            isError: true,
          }),
        timer,
      });

      this.ws!.send(
        JSON.stringify({ type: "call", callId, mupId, fn: functionName, args })
      );
    });
  }

  getPort(): number {
    return this.port;
  }

  private handleBrowserMessage(msg: Record<string, unknown>): void {
    switch (msg.type) {
      case "ready":
        console.error("[mup-mcp] Browser panel ready");
        break;

      case "mup-loaded":
        console.error(`[mup-mcp] MUP initialized: ${msg.mupId}`);
        break;

      case "result": {
        const pending = this.pendingCalls.get(msg.callId as string);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingCalls.delete(msg.callId as string);
          pending.resolve(msg.result);
        }
        break;
      }

      case "state":
        this.manager.updateState(
          msg.mupId as string,
          msg.summary as string,
          msg.data
        );
        this.emit("state-update", msg.mupId, msg.summary, msg.data);
        break;

      case "interaction":
        this.manager.addEvent(
          msg.mupId as string,
          msg.action as string,
          msg.summary as string,
          msg.data
        );
        this.emit("interaction", msg.mupId, msg.action, msg.summary);
        break;

      case "activate-mup":
        this.emit("activate-mup", msg.mupId as string);
        break;

      case "deactivate-mup":
        this.emit("deactivate-mup", msg.mupId as string);
        break;

      case "register-and-activate":
        this.emit("register-and-activate", msg.mupId as string, msg.html as string, msg.fileName as string);
        break;

      case "new-instance":
        this.emit("new-instance", msg.mupId as string, msg.customName as string | undefined);
        break;

      case "list-workspaces":
        this.emit("list-workspaces");
        break;

      case "save-workspace":
        this.emit("save-workspace", msg.name as string, msg.description as string | undefined);
        break;

      case "load-workspace":
        this.emit("load-workspace", msg.name as string);
        break;

      case "delete-workspace":
        this.emit("delete-workspace", msg.name as string, msg.isCurrent as boolean);
        break;

      case "save-grid-layout":
        this.emit("save-grid-layout", msg.layout);
        break;
    }
  }

  private handleHttp(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (req.url === "/" || req.url === "/index.html") {
      const uiPath = path.join(__dirname, "..", "ui", "index.html");
      try {
        let content = fs.readFileSync(uiPath, "utf-8");
        content = content.replace(/__WS_PORT__/g, String(this.port));
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache",
        });
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
