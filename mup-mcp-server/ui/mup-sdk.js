// ---- MUP SDK (injected into each iframe) ----
const MUP_SDK_SOURCE = `
class MupSDK {
  constructor() {
    this._port = null; this._functions = new Map(); this._readyCallback = null;
    this._pendingRequests = new Map(); this._nextId = 1; this._initialized = false;
    this._themeCallback = null; this.theme = 'light';
    window.addEventListener("message", (event) => {
      if (event.data && event.data.type === "mup:init" && event.ports[0]) {
        this._port = event.ports[0];
        this._port.onmessage = (msg) => this._handleMessage(msg.data);
      }
    });
  }
  registerFunction(name, handler) { this._functions.set(name, handler); }
  onReady(callback) { this._readyCallback = callback; if (this._initialized && this._initParams) callback(this._initParams); }
  onThemeChange(callback) { this._themeCallback = callback; if (this.theme) callback(this.theme); }
  updateState(summary, data) { this._notify("notifications/state/update", { summary, data }); }
  notifyInteraction(action, summary, data) { this._notify("notifications/interaction", { action, summary, data }); }
  emitEvent(event, data) { this._notify("notifications/event", { event, data }); }
  system(action, params) { return this._request("system/request", { action, params }); }
  async readFile(path) { const r = await this.system("readFile", { path }); if (r?.error) throw new Error(r.error); return r?.content || ""; }
  async readFileBase64(path) { const r = await this.system("readFileBase64", { path }); if (r?.error) throw new Error(r.error); return r?.content || ""; }
  async writeFile(path, content) { const r = await this.system("writeFile", { path, content }); if (r?.error) throw new Error(r.error); }
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
    if (msg.method === "notifications/shutdown") this._notify("notifications/shutdown/complete", {});
    if (msg.method === "notifications/theme") {
      this.theme = msg.params?.theme || 'light';
      if (this._themeCallback) this._themeCallback(this.theme);
    }
  }
  async _handleRequest(msg) {
    const { id, method, params } = msg;
    if (method === "initialize") {
      this._initParams = params; this._initialized = true;
      if (params.theme) { this.theme = params.theme; }
      this._sendResponse(id, { protocolVersion: "mup/2026-03-17", mupInfo: { name: document.title || "MUP", version: "1.0.0" } });
      if (this._themeCallback) this._themeCallback(this.theme);
      if (this._readyCallback) this._readyCallback(params);
      return;
    }
    if (method === "functions/call") {
      const handler = this._functions.get(params.name);
      if (!handler) { this._sendError(id, -32603, "Function not registered: " + params.name); return; }
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
