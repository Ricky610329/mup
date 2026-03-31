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
  // Heartbeat
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private isAlive = false;
  // Message queue for critical messages (permission requests) during disconnection
  private messageQueue: Array<{ msg: ServerMessage; timestamp: number }> = [];
  // File access permissions: mupId → allowed path prefixes
  private fileAccess = new Map<string, string[]>();
  private static MAX_READ_SIZE = 1_048_576; // 1MB
  // Rate limiting: mupId → { count, resetAt }
  private rateLimits = new Map<string, { count: number; resetAt: number }>();

  constructor(manager: MupManager, port: number) {
    super();
    this.manager = manager;
    this.port = port;

    this.httpServer = http.createServer((req, res) => this.handleHttp(req, res));
    this.wss = new WebSocketServer({ server: this.httpServer, maxPayload: CONFIG.wsMaxPayloadBytes });

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
      this.isAlive = true;
      this.startHeartbeat();
      console.error("[mup-mcp] Browser panel connected");
      this.typedEmit("browser-connected");

      ws.on("pong", () => { this.isAlive = true; });

      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString()) as BrowserMessage;
          this.handleBrowserMessage(msg);
        } catch (e) {
          console.error("[mup-mcp] Invalid message from browser:", e);
        }
      });

      ws.on("close", () => {
        this.stopHeartbeat();
        console.error("[mup-mcp] Browser panel disconnected");
        this.ws = null;
        for (const [id, pending] of this.pendingCalls) {
          clearTimeout(pending.timer);
          pending.resolve({ content: [{ type: "text", text: "Browser disconnected" }], isError: true });
          this.pendingCalls.delete(id);
        }
        this.typedEmit("browser-disconnected");
      });

      // Send catalog + folder tree immediately (lightweight, no grid needed)
      this.sendRaw({ type: "mup-catalog", catalog: this.buildCatalogSummary() });
      if (this.folderTree.length > 0) {
        this.sendRaw({ type: "folder-tree", tree: this.folderTree, path: this.folderPath });
      }
      // Active MUPs are sent after browser signals "browser-ready" (grid initialized)
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

  // ---- Heartbeat ----

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.isAlive = true;
    this.pingInterval = setInterval(() => {
      if (!this.ws) { this.stopHeartbeat(); return; }
      if (!this.isAlive) {
        console.error("[mup-mcp] Heartbeat timeout — terminating stale connection");
        this.ws.terminate();
        return;
      }
      this.isAlive = false;
      this.ws.ping();
    }, CONFIG.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  // ---- Message Queue ----

  private flushMessageQueue(): void {
    const now = Date.now();
    const valid = this.messageQueue.filter(m => now - m.timestamp < CONFIG.messageQueueTtlMs);
    this.messageQueue.length = 0;
    if (valid.length > 0) {
      console.error(`[mup-mcp] Flushing ${valid.length} queued message(s)`);
      for (const { msg } of valid) {
        this.sendRaw(msg);
      }
    }
  }

  // ---- Communication ----

  sendRaw(msg: ServerMessage): void {
    if (this.isConnected()) {
      this.ws!.send(JSON.stringify(msg));
    } else if ((msg as Record<string, unknown>).type === "permission-request") {
      // Queue permission requests — they're critical and must survive reconnection
      this.messageQueue.push({ msg, timestamp: Date.now() });
      console.error("[mup-mcp] Queued permission request (browser disconnected)");
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
        // Grid is initialized — now safe to send active MUPs
        for (const mup of this.manager.getAll()) {
          this.sendRaw({
            type: "load-mup",
            mupId: mup.manifest.id,
            html: mup.html,
            manifest: mup.manifest,
          });
        }
        this.typedEmit("browser-ready");
        // Flush queued permission requests after MUPs are loaded
        this.flushMessageQueue();
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

      case "mup-event":
        this.typedEmit("mup-event", msg.mupId, msg.event, msg.data);
        break;

      // ---- Pure event forwarding ----
      case "activate-mup":         this.typedEmit("activate-mup", msg.mupId); break;
      case "deactivate-mup":       this.typedEmit("deactivate-mup", msg.mupId); break;
      case "register-and-activate": this.typedEmit("register-and-activate", msg.mupId, msg.html, msg.fileName); break;
      case "load-folder":          this.typedEmit("load-folder", msg.mups); break;
      case "new-instance":         this.typedEmit("new-instance", msg.mupId, msg.customName); break;
      case "save-grid-layout":     this.typedEmit("save-grid-layout", msg.layout); break;
      case "grid-layout-info":     this.typedEmit("grid-layout-info", { cols: msg.cols, cellSize: msg.cellSize, cellGap: msg.cellGap, viewportWidth: msg.viewportWidth, layout: msg.layout }); break;
      case "rename-mup":           this.typedEmit("rename-mup", msg.mupId, msg.customName); break;
      case "flush-save":           this.typedEmit("flush-save"); break;
      case "rename-workspace":     this.typedEmit("rename-workspace", msg.name); break;
      case "set-mups-path":        this.typedEmit("set-mups-path", msg.path); break;
      case "permission-verdict":   this.typedEmit("permission-verdict", msg.requestId, msg.behavior); break;
      case "system-request":       this.handleSystemRequest(msg.requestId, msg.mupId, msg.action, msg.args); break;
    }
  }

  // ---- System Requests (readFile etc.) ----

  setFileAccess(mupId: string, allowedPaths: string[]): void {
    this.fileAccess.set(mupId, allowedPaths.map(p => path.resolve(p)));
  }

  getFileAccess(mupId: string): string[] {
    return this.fileAccess.get(mupId) || [];
  }

  /** Check if a resolved path is within the MUP's allowed paths */
  private checkPathAccess(mupId: string, resolved: string): boolean {
    const allowed = this.fileAccess.get(mupId) || [];
    return allowed.some(prefix => {
      // Normalize: strip trailing sep for comparison, then check with sep
      const base = prefix.endsWith(path.sep) ? prefix.slice(0, -1) : prefix;
      return resolved === base || resolved === base + path.sep || resolved.startsWith(base + path.sep);
    });
  }

  /** Rate limit system requests per MUP */
  private checkRateLimit(mupId: string): boolean {
    const now = Date.now();
    const entry = this.rateLimits.get(mupId) || { count: 0, resetAt: now + 1000 };
    if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + 1000; }
    entry.count++;
    this.rateLimits.set(mupId, entry);
    return entry.count <= CONFIG.maxSystemRequestsPerSec;
  }

  private handleSystemRequest(requestId: string, mupId: string, action: string, args: Record<string, unknown>): void {
    // Rate limit check
    if (!this.checkRateLimit(mupId)) {
      this.sendRaw({ type: "system-response", requestId, result: { error: "Rate limit exceeded. Max 20 requests/sec." } });
      return;
    }
    if (action === "readFile") {
      const filePath = args.path as string;
      if (!filePath) {
        this.sendRaw({ type: "system-response", requestId, result: { error: "Missing path" } });
        return;
      }
      const resolved = path.resolve(filePath);
      const hasAccess = this.checkPathAccess(mupId, resolved);
      if (!hasAccess) {
        this.sendRaw({ type: "system-response", requestId, result: { error: `Access denied: ${filePath}. Use setFileAccess to grant access.` } });
        return;
      }
      try {
        const stat = fs.statSync(resolved);
        if (stat.size > UiBridge.MAX_READ_SIZE) {
          this.sendRaw({ type: "system-response", requestId, result: { error: `File too large (${stat.size} bytes, max ${UiBridge.MAX_READ_SIZE})` } });
          return;
        }
        const content = fs.readFileSync(resolved, "utf-8");
        this.sendRaw({ type: "system-response", requestId, result: { content } });
      } catch (err) {
        this.sendRaw({ type: "system-response", requestId, result: { error: `Read failed: ${(err as Error).message}` } });
      }
    } else if (action === "readFileBase64") {
      const filePath = args.path as string;
      if (!filePath) { this.sendRaw({ type: "system-response", requestId, result: { error: "Missing path" } }); return; }
      const resolved = path.resolve(filePath);
      const hasAccess = this.checkPathAccess(mupId, resolved);
      if (!hasAccess) { this.sendRaw({ type: "system-response", requestId, result: { error: `Access denied: ${filePath}` } }); return; }
      try {
        const stat = fs.statSync(resolved);
        const MAX_BINARY = 5 * 1024 * 1024;
        if (stat.size > MAX_BINARY) { this.sendRaw({ type: "system-response", requestId, result: { error: `File too large (${stat.size} bytes, max ${MAX_BINARY})` } }); return; }
        const content = fs.readFileSync(resolved).toString('base64');
        this.sendRaw({ type: "system-response", requestId, result: { content } });
      } catch (err) {
        this.sendRaw({ type: "system-response", requestId, result: { error: `Read failed: ${(err as Error).message}` } });
      }
    } else if (action === "scanDirectory") {
      const dirPath = args.path as string;
      if (!dirPath) { this.sendRaw({ type: "system-response", requestId, result: { error: "Missing path" } }); return; }
      const resolved = path.resolve(dirPath);
      const hasAccess = this.checkPathAccess(mupId, resolved);
      if (!hasAccess) { this.sendRaw({ type: "system-response", requestId, result: { error: `Access denied: ${dirPath}` } }); return; }
      try {
        const files: string[] = [];
        const scan = (dir: string) => {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) scan(full);
            else files.push(full);
          }
        };
        scan(resolved);
        this.sendRaw({ type: "system-response", requestId, result: { content: JSON.stringify(files) } });
      } catch (err) {
        this.sendRaw({ type: "system-response", requestId, result: { error: `Scan failed: ${(err as Error).message}` } });
      }
    } else if (action === "getCwd") {
      this.sendRaw({ type: "system-response", requestId, result: { content: process.cwd() } });
    } else if (action === "getPort") {
      this.sendRaw({ type: "system-response", requestId, result: { content: String(this.port) } });
    } else if (action === "registerWorkspace") {
      const fileTypes = (args.fileTypes || []) as string[];
      const cwd = process.cwd();
      const cwdPrefix = cwd.endsWith(path.sep) ? cwd : cwd + path.sep;
      // Auto-grant cwd access for this MUP
      const existing = this.fileAccess.get(mupId) || [];
      this.fileAccess.set(mupId, [...new Set([...existing, cwd])]);
      // Scan cwd recursively and filter by requested file types
      const files: string[] = [];
      const scan = (dir: string) => {
        try {
          for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) scan(full);
            else if (!fileTypes.length || fileTypes.some(ext => full.toLowerCase().endsWith(ext.toLowerCase()))) files.push(full);
          }
        } catch {}
      };
      scan(cwd);
      this.sendRaw({ type: "system-response", requestId, result: {
        content: JSON.stringify({ cwd: cwdPrefix, port: this.port, files })
      }});
      console.error(`[mup-mcp] Workspace registered for ${mupId}: ${files.length} files (${fileTypes.join(', ') || 'all'})`);
    } else if (action === "grantFileAccess") {
      const paths = args.paths as string[];
      if (!paths || !Array.isArray(paths)) {
        this.sendRaw({ type: "system-response", requestId, result: { error: "Missing paths array" } });
        return;
      }
      // Security: MUP can only self-grant access within cwd
      const cwd = process.cwd();
      const cwdPrefix = cwd.endsWith(path.sep) ? cwd : cwd + path.sep;
      const resolved = paths.map(p => path.resolve(p));
      const withinCwd = resolved.filter(p => p === cwd || p.startsWith(cwdPrefix));
      const denied = resolved.filter(p => p !== cwd && !p.startsWith(cwdPrefix));
      if (withinCwd.length) {
        const existing = this.fileAccess.get(mupId) || [];
        this.fileAccess.set(mupId, [...new Set([...existing, ...withinCwd])]);
        console.error(`[mup-mcp] File access granted for ${mupId}: ${withinCwd.join(', ')}`);
      }
      if (denied.length) {
        console.error(`[mup-mcp] File access DENIED for ${mupId} (outside cwd): ${denied.join(', ')}`);
        this.sendRaw({ type: "system-response", requestId, result: { error: `Denied paths outside workspace: ${denied.map(d => d.split(path.sep).pop()).join(', ')}` } });
        return;
      }
      this.sendRaw({ type: "system-response", requestId, result: { content: "ok" } });
    } else if (action === "writeFile") {
      const filePath = args.path as string;
      const content = args.content as string;
      if (!filePath || content === undefined) {
        this.sendRaw({ type: "system-response", requestId, result: { error: "Missing path or content" } });
        return;
      }
      const resolved = path.resolve(filePath);
      if (resolved.includes("..") || !path.isAbsolute(resolved)) {
        this.sendRaw({ type: "system-response", requestId, result: { error: "Invalid path" } });
        return;
      }
      const hasAccess = this.checkPathAccess(mupId, resolved);
      if (!hasAccess) {
        this.sendRaw({ type: "system-response", requestId, result: { error: `Access denied: ${filePath}. Use setFileAccess to grant access.` } });
        return;
      }
      try {
        const dir = path.dirname(resolved);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(resolved, content, "utf-8");
        this.sendRaw({ type: "system-response", requestId, result: { content: "ok" } });
      } catch (err) {
        this.sendRaw({ type: "system-response", requestId, result: { error: `Write failed: ${(err as Error).message}` } });
      }
    } else if (action === "writeFileBase64") {
      const filePath = args.path as string;
      const content = args.content as string;
      if (!filePath || !content) { this.sendRaw({ type: "system-response", requestId, result: { error: "Missing path or content" } }); return; }
      const resolved = path.resolve(filePath);
      const hasAccess = this.checkPathAccess(mupId, resolved);
      if (!hasAccess) { this.sendRaw({ type: "system-response", requestId, result: { error: `Access denied: ${filePath}` } }); return; }
      try {
        const dir = path.dirname(resolved);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(resolved, Buffer.from(content, 'base64'));
        this.sendRaw({ type: "system-response", requestId, result: { content: "ok" } });
      } catch (err) {
        this.sendRaw({ type: "system-response", requestId, result: { error: `Write failed: ${(err as Error).message}` } });
      }
    } else if (action === "deleteFile") {
      const filePath = args.path as string;
      if (!filePath) { this.sendRaw({ type: "system-response", requestId, result: { error: "Missing path" } }); return; }
      const resolved = path.resolve(filePath);
      const hasAccess = this.checkPathAccess(mupId, resolved);
      if (!hasAccess) { this.sendRaw({ type: "system-response", requestId, result: { error: `Access denied: ${filePath}` } }); return; }
      try {
        fs.unlinkSync(resolved);
        this.sendRaw({ type: "system-response", requestId, result: { content: "ok" } });
      } catch (err) {
        this.sendRaw({ type: "system-response", requestId, result: { error: `Delete failed: ${(err as Error).message}` } });
      }
    } else {
      this.sendRaw({ type: "system-response", requestId, result: { error: `Unknown system action: ${action}` } });
    }
  }

  // ---- HTTP (static file serving from ui/) ----

  private static CONTENT_TYPES: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
  };

  private handleHttp(req: http.IncomingMessage, res: http.ServerResponse): void {
    const rawUrl = req.url || "/";

    // Serve workspace files: /ws-file?path=/absolute/path
    if (rawUrl.startsWith("/ws-file")) {
      const urlObj = new URL(`http://localhost${rawUrl}`);
      const wsPath = urlObj.searchParams.get("path");
      if (!wsPath) { res.writeHead(400); res.end("Missing path"); return; }
      const resolved = path.resolve(wsPath);
      const cwd = process.cwd();
      const cwdBase = cwd.endsWith(path.sep) ? cwd.slice(0, -1) : cwd;
      if (resolved !== cwdBase && !resolved.startsWith(cwdBase + path.sep)) { res.writeHead(403); res.end("Forbidden"); return; }
      try {
        const content = fs.readFileSync(resolved);
        const ext = path.extname(resolved).toLowerCase();
        res.writeHead(200, {
          "Content-Type": UiBridge.CONTENT_TYPES[ext] || "application/octet-stream",
          "Cache-Control": "no-cache",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(content);
      } catch { res.writeHead(404); res.end("Not found"); }
      return;
    }

    const url = rawUrl.split("?")[0];
    const filePath = url === "/" ? "index.html" : url.replace(/^\//, "");

    if (filePath.includes("..") || path.isAbsolute(filePath)) {
      res.writeHead(403); res.end("Forbidden"); return;
    }

    const fullPath = path.join(__dirname, "..", "ui", filePath);
    try {
      const content = fs.readFileSync(fullPath, "utf-8");
      const ext = path.extname(fullPath).toLowerCase();
      res.writeHead(200, {
        "Content-Type": UiBridge.CONTENT_TYPES[ext] || "application/octet-stream",
        "Cache-Control": "no-cache",
      });
      res.end(content);
    } catch {
      res.writeHead(404); res.end("Not found");
    }
  }
}
