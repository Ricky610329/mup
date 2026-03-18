import type { ResolvedManifest, GridAllocation, InitializeResult } from "../protocol/types";
import { Methods } from "../protocol/types";
import { MessageRouter } from "./MessageRouter";
import { GridLayoutManager } from "./GridLayoutManager";

// Inline SDK
const MUP_SDK_SOURCE = `
class MupSDK {
  constructor() {
    this._port = null; this._functions = new Map(); this._readyCallback = null;
    this._pendingRequests = new Map(); this._nextId = 1; this._initialized = false;
    window.addEventListener("message", (event) => {
      if (event.data && event.data.type === "mup:init" && event.ports[0]) {
        this._port = event.ports[0];
        this._port.onmessage = (msg) => this._handleMessage(msg.data);
      }
    });
  }
  registerFunction(name, handler) { this._functions.set(name, handler); }
  onReady(callback) { this._readyCallback = callback; if (this._initialized && this._initParams) callback(this._initParams); }
  updateState(summary, data) { this._notify("notifications/state/update", { summary, data }); }
  notifyInteraction(action, summary, data) { this._notify("notifications/interaction", { action, summary, data }); }
  requestResize(width, height, reason) { return this._request("grid/resize", { width, height, reason }); }
  system(action, params) { return this._request("system/request", { action, params }); }
  _handleMessage(data) {
    if (!data || data.jsonrpc !== "2.0") return;
    if ("id" in data && !("method" in data)) {
      const p = this._pendingRequests.get(data.id);
      if (p) { this._pendingRequests.delete(data.id); data.error ? p.reject(new Error(data.error.message)) : p.resolve(data.result); }
      return;
    }
    if ("id" in data && "method" in data) { this._handleRequest(data); return; }
    if ("method" in data) { this._handleNotification(data); return; }
  }
  _handleNotification(msg) {
    if (msg.method === "notifications/shutdown") {
      this._notify("notifications/shutdown/complete", {});
    }
  }
  async _handleRequest(msg) {
    const { id, method, params } = msg;
    if (method === "initialize") {
      this._initParams = params; this._initialized = true;
      this._sendResponse(id, { protocolVersion: "mup/2026-03-17", mupInfo: { name: document.title || "MUP", version: "1.0.0" } });
      if (this._readyCallback) this._readyCallback(params);
      return;
    }
    if (method === "functions/call") {
      const handler = this._functions.get(params.name);
      if (!handler) { this._sendError(id, -33002, "Function not found: " + params.name); return; }
      try { this._sendResponse(id, await handler(params.arguments, params.source)); }
      catch (e) { this._sendError(id, -32603, e.message || "Internal error"); }
      return;
    }
    this._sendError(id, -32601, "Method not found: " + method);
  }
  _sendResponse(id, result) { if (this._port) this._port.postMessage({ jsonrpc: "2.0", id, result }); }
  _sendError(id, code, message) { if (this._port) this._port.postMessage({ jsonrpc: "2.0", id, error: { code, message } }); }
  _notify(method, params) { if (this._port) this._port.postMessage({ jsonrpc: "2.0", method, params }); }
  _request(method, params) {
    if (!this._port) return Promise.reject(new Error("Not connected"));
    const id = this._nextId++;
    return new Promise((resolve, reject) => { this._pendingRequests.set(id, { resolve, reject }); this._port.postMessage({ jsonrpc: "2.0", id, method, params }); });
  }
}
const mup = new MupSDK();
`;

export class MupContainer extends HTMLElement {
  private iframe: HTMLIFrameElement | null = null;
  private headerEl: HTMLElement | null = null;
  private manifest: ResolvedManifest | null = null;
  private gridManager: GridLayoutManager | null = null;

  connectedCallback() {
    this.innerHTML = "";
    this.classList.add("mup-container");

    // Header with drag handle
    this.headerEl = document.createElement("div");
    this.headerEl.className = "mup-header";
    this.appendChild(this.headerEl);

    // Close button (top-right)
    const closeBtn = document.createElement("div");
    closeBtn.className = "mup-close-btn";
    closeBtn.title = "Remove MUP";
    closeBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="2" y1="2" x2="8" y2="8"/><line x1="8" y1="2" x2="2" y2="8"/></svg>`;
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.dispatchEvent(new CustomEvent("mup-close", { detail: { mupId: this.manifest?.id }, bubbles: true }));
    });
    this.headerEl.appendChild(closeBtn);

    // Drag handle (top-right, after close)
    const dragHandle = document.createElement("div");
    dragHandle.className = "mup-drag-handle";
    dragHandle.title = "Drag to move";
    dragHandle.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><circle cx="3" cy="3" r="1.5"/><circle cx="7" cy="3" r="1.5"/><circle cx="3" cy="7" r="1.5"/><circle cx="7" cy="7" r="1.5"/></svg>`;
    this.headerEl.appendChild(dragHandle);

    // Iframe body
    const wrapper = document.createElement("div");
    wrapper.className = "mup-body";
    this.appendChild(wrapper);

    this.iframe = document.createElement("iframe");
    this.iframe.className = "mup-iframe";
    this.iframe.sandbox.add("allow-scripts", "allow-same-origin");
    // Permissions Policy: deny everything by default.
    // Will be set per-mup based on manifest.permissions during initialization.
    this.iframe.allow = "";
    wrapper.appendChild(this.iframe);

    // Resize handle (bottom-right)
    const resizeHandle = document.createElement("div");
    resizeHandle.className = "mup-resize-handle";
    resizeHandle.title = "Drag to resize";
    this.appendChild(resizeHandle);

    // Wire drag
    this.setupDrag(dragHandle);
    // Wire resize
    this.setupResize(resizeHandle);
  }

  disconnectedCallback() {
    if (this.iframe) this.iframe.src = "about:blank";
  }

  async initializeFromHtml(
    manifest: ResolvedManifest, htmlContent: string,
    allocation: GridAllocation, router: MessageRouter, grid?: GridLayoutManager
  ): Promise<InitializeResult> {
    this.manifest = manifest;
    this.gridManager = grid ?? null;
    this.applyHeader(manifest);
    this.applyGridPlacement(allocation);
    this.applyPermissions(manifest);
    if (!this.iframe) throw new Error("Container not connected to DOM");
    const channel = new MessageChannel();
    router.registerMup(manifest.id, channel.port1);

    const sdkScript = `<script>${MUP_SDK_SOURCE}<\/script>`;
    let injectedHtml = htmlContent;
    if (injectedHtml.includes("</head>")) {
      injectedHtml = injectedHtml.replace("</head>", `${sdkScript}\n</head>`);
    } else if (injectedHtml.includes("<body")) {
      injectedHtml = injectedHtml.replace(/<body([^>]*)>/, `<body$1>\n${sdkScript}`);
    } else {
      injectedHtml = sdkScript + "\n" + injectedHtml;
    }
    injectedHtml = injectedHtml.replace(/<script[^>]*src="[^"]*mup-sdk\.js"[^>]*><\/script>/g, "");

    const blob = new Blob([injectedHtml], { type: "text/html" });
    const blobUrl = URL.createObjectURL(blob);
    return this.loadIframe(blobUrl, blobUrl, manifest.id, allocation, router, channel);
  }

  getManifest(): ResolvedManifest | null { return this.manifest; }

  updateGridPlacement(alloc: GridAllocation): void {
    this.applyGridPlacement(alloc);
  }

  /** Set iframe Permissions Policy based on manifest.permissions.
   *  Only declared permissions are granted — everything else is denied. */
  private applyPermissions(manifest: ResolvedManifest): void {
    if (!this.iframe) return;
    const declared = manifest.permissions ?? [];
    const allPerms = new Set(declared);
    const policyParts = [...allPerms].map(p => `${p} 'src'`);
    this.iframe.allow = policyParts.join("; ");
  }

  private applyHeader(manifest: ResolvedManifest): void {
    if (this.headerEl) {
      const nameSpan = this.headerEl.querySelector(".mup-name") || document.createElement("span");
      nameSpan.className = "mup-name";
      nameSpan.textContent = manifest.name;
      this.headerEl.insertBefore(nameSpan, this.headerEl.firstChild);
    }
  }

  private applyGridPlacement(allocation: GridAllocation): void {
    if (allocation.widthSpan > 0) {
      this.style.gridColumn = `${allocation.x} / span ${allocation.widthSpan}`;
      this.style.gridRow = `${allocation.y} / span ${allocation.heightSpan}`;
    }
    this.dataset.mupId = this.manifest?.id ?? "";
  }

  // ---- Interaction overlay (prevents iframes from stealing mouse events) ----

  private overlay: HTMLElement | null = null;

  private addOverlay(): void {
    if (this.overlay) return;
    this.overlay = document.createElement("div");
    this.overlay.style.cssText = "position:fixed;inset:0;z-index:9999;cursor:inherit;";
    document.body.appendChild(this.overlay);
  }

  private removeOverlay(): void {
    this.overlay?.remove();
    this.overlay = null;
  }

  // ---- Preview ghost ----

  private preview: HTMLElement | null = null;
  private lastPreviewKey = "";

  private showPreview(x: number, y: number, w: number, h: number): void {
    if (!this.gridManager) return;
    const key = `${x},${y},${w},${h}`;
    if (key === this.lastPreviewKey) return;
    this.lastPreviewKey = key;

    if (!this.preview) {
      this.preview = document.createElement("div");
      this.preview.className = "mup-preview";
      this.parentElement?.appendChild(this.preview);
    }
    this.preview.style.gridColumn = `${x} / span ${w}`;
    this.preview.style.gridRow = `${y} / span ${h}`;
  }

  private hidePreview(): void {
    this.preview?.remove();
    this.preview = null;
    this.lastPreviewKey = "";
  }

  // ---- Drag to move: ghost follows mouse, card moves on release ----

  private setupDrag(handle: HTMLElement): void {
    handle.addEventListener("mousedown", (e) => {
      const gm = this.gridManager;
      const manifest = this.manifest;
      if (!gm || !manifest) return;

      const alloc = gm.getAllocation(manifest.id);
      if (!alloc) return;

      e.preventDefault();
      e.stopPropagation();

      const cs = gm.getCellSize();
      const gap = gm.getGap();
      const step = cs + gap;
      const origin = gm.getGridOrigin();

      const cardLeft = origin.x + (alloc.x - 1) * step;
      const cardTop = origin.y + (alloc.y - 1) * step;
      const grabPx = e.clientX - cardLeft;
      const grabPy = e.clientY - cardTop;

      let targetCol = alloc.x;
      let targetRow = alloc.y;

      this.addOverlay();
      this.classList.add("dragging");
      document.body.style.cursor = "grabbing";
      document.body.style.userSelect = "none";

      this.showPreview(alloc.x, alloc.y, alloc.widthSpan, alloc.heightSpan);

      const onMove = (ev: MouseEvent) => {
        const o = gm.getGridOrigin();
        const cardX = ev.clientX - grabPx - o.x;
        const cardY = ev.clientY - grabPy - o.y;

        let col = Math.round(cardX / step) + 1;
        let row = Math.round(cardY / step) + 1;
        col = Math.max(1, Math.min(col, gm.getColumns() - alloc.widthSpan + 1));
        row = Math.max(1, Math.min(row, gm.getRows() - alloc.heightSpan + 1));

        targetCol = col;
        targetRow = row;
        this.showPreview(col, row, alloc.widthSpan, alloc.heightSpan);
      };

      const onUp = () => {
        this.removeOverlay();
        this.hidePreview();
        this.classList.remove("dragging");
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);

        if (gm.moveMup(manifest.id, targetCol, targetRow)) {
          this.applyGridPlacement(gm.getAllocation(manifest.id)!);
        }
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  // ---- Resize: ghost shows new size, card resizes on release ----

  private setupResize(handle: HTMLElement): void {
    handle.addEventListener("mousedown", (e) => {
      const gm = this.gridManager;
      const manifest = this.manifest;
      if (!gm || !manifest) return;

      const alloc = gm.getAllocation(manifest.id);
      if (!alloc) return;

      e.preventDefault();
      e.stopPropagation();

      const cs = gm.getCellSize();
      const gap = gm.getGap();
      const step = cs + gap;

      let targetCols = alloc.widthSpan;
      let targetRows = alloc.heightSpan;

      this.addOverlay();
      this.classList.add("resizing");
      document.body.style.cursor = "nwse-resize";
      document.body.style.userSelect = "none";

      this.showPreview(alloc.x, alloc.y, alloc.widthSpan, alloc.heightSpan);

      const onMove = (ev: MouseEvent) => {
        const o = gm.getGridOrigin();

        const cardLeft = o.x + (alloc.x - 1) * step;
        const cardTop = o.y + (alloc.y - 1) * step;
        const dx = ev.clientX - cardLeft;
        const dy = ev.clientY - cardTop;

        let newCols = Math.max(1, Math.ceil(dx / step));
        let newRows = Math.max(1, Math.ceil(dy / step));

        const minC = manifest.grid?.minWidth ?? 1;
        const minR = manifest.grid?.minHeight ?? 1;
        const maxC = manifest.grid?.maxWidth ?? 4;
        const maxR = manifest.grid?.maxHeight ?? 3;
        newCols = Math.max(minC, Math.min(newCols, maxC));
        newRows = Math.max(minR, Math.min(newRows, maxR));

        newCols = Math.min(newCols, gm.getColumns() - alloc.x + 1);
        newRows = Math.min(newRows, gm.getRows() - alloc.y + 1);

        targetCols = newCols;
        targetRows = newRows;
        this.showPreview(alloc.x, alloc.y, newCols, newRows);
      };

      const onUp = () => {
        this.removeOverlay();
        this.hidePreview();
        this.classList.remove("resizing");
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);

        if (gm.resizeMup(manifest.id, targetCols, targetRows)) {
          this.applyGridPlacement(gm.getAllocation(manifest.id)!);
        }
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  private loadIframe(
    src: string, blobUrlToRevoke: string | null,
    mupId: string, allocation: GridAllocation,
    router: MessageRouter, channel: MessageChannel
  ): Promise<InitializeResult> {
    return new Promise<InitializeResult>((resolve, reject) => {
      const revoke = () => { if (blobUrlToRevoke) URL.revokeObjectURL(blobUrlToRevoke); };
      const timeout = setTimeout(() => { revoke(); reject(new Error(`MUP ${mupId} initialization timeout`)); }, 10_000);
      this.iframe!.onload = async () => {
        revoke();
        this.iframe!.contentWindow!.postMessage({ type: "mup:init" }, "*", [channel.port2]);
        try {
          const result = (await router.request(mupId, Methods.Initialize, {
            protocolVersion: "mup/2026-03-17",
            hostInfo: { name: "MUP PoC Host", version: "0.1.0" },
            gridAllocation: { width: allocation.widthSpan, height: allocation.heightSpan },
          })) as InitializeResult;
          clearTimeout(timeout);
          resolve(result);
        } catch (err) { clearTimeout(timeout); reject(err); }
      };
      this.iframe!.src = src;
    });
  }
}

customElements.define("mup-container", MupContainer);
