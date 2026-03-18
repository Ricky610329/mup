// Sandbox page: hosts MUP iframes with inline scripts (CSP relaxed here)
// Communicates with panel.html via window.postMessage

const MUP_SDK_SOURCE = [
  "class MupSDK {",
  "  constructor() {",
  "    this._port = null; this._functions = new Map(); this._readyCallback = null;",
  "    this._pendingRequests = new Map(); this._nextId = 1; this._initialized = false;",
  '    window.addEventListener("message", (event) => {',
  '      if (event.data && event.data.type === "mup:init" && event.ports[0]) {',
  "        this._port = event.ports[0];",
  "        this._port.onmessage = (msg) => this._handleMessage(msg.data);",
  "      }",
  "    });",
  "  }",
  "  registerFunction(name, handler) { this._functions.set(name, handler); }",
  "  onReady(callback) { this._readyCallback = callback; if (this._initialized && this._initParams) callback(this._initParams); }",
  '  updateState(summary, data) { this._notify("notifications/state/update", { summary, data }); }',
  '  notifyInteraction(action, summary, data) { this._notify("notifications/interaction", { action, summary, data }); }',
  '  requestResize(width, height, reason) { return this._request("grid/resize", { width, height, reason }); }',
  '  system(action, params) { return this._request("system/request", { action, params }); }',
  "  _handleMessage(data) {",
  '    if (!data || data.jsonrpc !== "2.0") return;',
  '    if ("id" in data && !("method" in data)) {',
  "      const p = this._pendingRequests.get(data.id);",
  "      if (p) { this._pendingRequests.delete(data.id); data.error ? p.reject(new Error(data.error.message)) : p.resolve(data.result); }",
  "      return;",
  "    }",
  '    if ("id" in data && "method" in data) { this._handleRequest(data); return; }',
  '    if ("method" in data) { this._handleNotification(data); return; }',
  "  }",
  "  _handleNotification(msg) {",
  '    if (msg.method === "notifications/shutdown") {',
  '      this._notify("notifications/shutdown/complete", {});',
  "    }",
  "  }",
  "  async _handleRequest(msg) {",
  "    const { id, method, params } = msg;",
  '    if (method === "initialize") {',
  "      this._initParams = params; this._initialized = true;",
  '      this._sendResponse(id, { protocolVersion: "mup/2026-03-17", mupInfo: { name: document.title || "MUP", version: "1.0.0" } });',
  "      if (this._readyCallback) this._readyCallback(params);",
  "      return;",
  "    }",
  '    if (method === "functions/call") {',
  "      const handler = this._functions.get(params.name);",
  '      if (!handler) { this._sendError(id, -33002, "Function not found: " + params.name); return; }',
  "      try { this._sendResponse(id, await handler(params.arguments, params.source)); }",
  '      catch (e) { this._sendError(id, -32603, e.message || "Internal error"); }',
  "      return;",
  "    }",
  '    this._sendError(id, -32601, "Method not found: " + method);',
  "  }",
  '  _sendResponse(id, result) { if (this._port) this._port.postMessage({ jsonrpc: "2.0", id, result }); }',
  '  _sendError(id, code, message) { if (this._port) this._port.postMessage({ jsonrpc: "2.0", id, error: { code, message } }); }',
  '  _notify(method, params) { if (this._port) this._port.postMessage({ jsonrpc: "2.0", method, params }); }',
  "  _request(method, params) {",
  '    if (!this._port) return Promise.reject(new Error("Not connected"));',
  "    const id = this._nextId++;",
  '    return new Promise((resolve, reject) => { this._pendingRequests.set(id, { resolve, reject }); this._port.postMessage({ jsonrpc: "2.0", id, method, params }); });',
  "  }",
  "}",
  "const mup = new MupSDK();",
].join("\n");

const mups = new Map(); // mupId -> { iframe, port }
const callMap = new Map(); // jsonrpc msgId -> callId
const systemRequests = new Map(); // reqId -> { mupId, rpcId }
let nextMsgId = 1;

// Listen for commands from panel
window.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg || !msg.type) return;

  switch (msg.type) {
    case "load-mup":
      loadMup(msg.mupId, msg.html, msg.manifest);
      break;
    case "unload-mup":
      unloadMup(msg.mupId);
      break;
    case "call-function":
      callFunction(msg.callId, msg.mupId, msg.fn, msg.args);
      break;
    case "system-response": {
      // Response from native host, route back to MUP
      const req = systemRequests.get(msg.reqId);
      if (req) {
        systemRequests.delete(msg.reqId);
        const mup = mups.get(req.mupId);
        if (mup) {
          if (msg.error) {
            mup.port.postMessage({ jsonrpc: "2.0", id: req.rpcId, error: { code: -32603, message: msg.error } });
          } else {
            mup.port.postMessage({ jsonrpc: "2.0", id: req.rpcId, result: msg.data });
          }
        }
      }
      break;
    }
  }
});

function loadMup(mupId, html, manifest) {
  if (mups.has(mupId)) return;

  const container = document.createElement("div");
  container.id = "mup-" + mupId;
  container.style.cssText = "width:100%; height:100%; position:relative;";

  const iframe = document.createElement("iframe");
  iframe.style.cssText = "width:100%; height:100%; border:none; display:block; overflow:hidden;";
  iframe.setAttribute("scrolling", "no");
  // No sandbox attribute — the host page is already sandboxed via manifest
  if (manifest.permissions && manifest.permissions.length > 0) {
    iframe.allow = manifest.permissions.map(function(p) { return p + " *"; }).join("; ");
  }
  container.appendChild(iframe);
  document.body.appendChild(container);

  // Inject SDK
  const sdkScript = "<script>\n" + MUP_SDK_SOURCE + "\n</" + "script>";
  let injected = html;
  if (injected.indexOf("</head>") !== -1) {
    injected = injected.replace("</head>", sdkScript + "\n</head>");
  } else if (injected.indexOf("<body") !== -1) {
    injected = injected.replace(/<body([^>]*)>/, "<body$1>\n" + sdkScript);
  } else {
    injected = sdkScript + "\n" + injected;
  }
  injected = injected.replace(/<script[^>]*src="[^"]*mup-sdk\.js"[^>]*><\/script>/g, "");

  // MessageChannel
  const channel = new MessageChannel();
  const mupPort = channel.port1;
  mupPort.onmessage = function(e) {
    handleMupMessage(mupId, e.data);
  };

  iframe.onload = function() {
    // Transfer MessageChannel port to MUP iframe
    iframe.contentWindow.postMessage({ type: "mup:init" }, "*", [channel.port2]);
    // Send initialize
    const initId = nextMsgId++;
    mupPort.postMessage({
      jsonrpc: "2.0",
      id: initId,
      method: "initialize",
      params: {
        protocolVersion: "mup/2026-03-17",
        hostInfo: { name: "MUP Extension Panel", version: "0.1.0" },
        gridAllocation: {
          width: (manifest.grid && manifest.grid.preferredWidth) || (manifest.grid && manifest.grid.minWidth) || 2,
          height: (manifest.grid && manifest.grid.preferredHeight) || (manifest.grid && manifest.grid.minHeight) || 2,
        },
      },
    });
  };

  // srcdoc in sandbox page — no child sandbox attribute means it inherits sandbox's permissive CSP
  iframe.srcdoc = injected;
  mups.set(mupId, { iframe: iframe, port: mupPort, container: container });

  // Notify panel
  parent.postMessage({ type: "mup-loaded", mupId: mupId }, "*");
}

function unloadMup(mupId) {
  const mup = mups.get(mupId);
  if (!mup) return;
  mup.port.close();
  mup.container.remove();
  mups.delete(mupId);
}

function callFunction(callId, mupId, fn, args) {
  const mup = mups.get(mupId);
  if (!mup) {
    parent.postMessage({
      type: "function-result",
      callId: callId,
      result: { content: [{ type: "text", text: "MUP not loaded: " + mupId }], isError: true },
    }, "*");
    return;
  }

  const msgId = nextMsgId++;
  callMap.set(msgId, callId);
  mup.port.postMessage({
    jsonrpc: "2.0",
    id: msgId,
    method: "functions/call",
    params: { name: fn, arguments: args || {}, source: "llm" },
  });
}

function handleMupMessage(mupId, data) {
  if (!data || data.jsonrpc !== "2.0") return;

  // Response
  if ("id" in data && !("method" in data)) {
    if (callMap.has(data.id)) {
      const callId = callMap.get(data.id);
      callMap.delete(data.id);
      const result = data.error
        ? { content: [{ type: "text", text: data.error.message || "Error" }], isError: true }
        : data.result || { content: [{ type: "text", text: "OK" }], isError: false };
      parent.postMessage({ type: "function-result", callId: callId, result: result }, "*");
    }
    return;
  }

  // Notification
  if ("method" in data && !("id" in data)) {
    if (data.method === "notifications/state/update") {
      parent.postMessage({
        type: "state-update", mupId: mupId,
        summary: (data.params && data.params.summary) || "",
      }, "*");
    } else if (data.method === "notifications/interaction") {
      parent.postMessage({
        type: "interaction", mupId: mupId,
        action: (data.params && data.params.action) || "",
        summary: (data.params && data.params.summary) || "",
      }, "*");
    }
    return;
  }

  // Request from MUP
  if ("id" in data && "method" in data) {
    const mup = mups.get(mupId);
    if (!mup) return;

    if (data.method === "grid/resize") {
      mup.port.postMessage({
        jsonrpc: "2.0", id: data.id,
        result: { granted: true, width: (data.params && data.params.width) || 2, height: (data.params && data.params.height) || 2 },
      });
    } else if (data.method === "system/request") {
      // Route to panel → service worker → native host
      const reqId = "sys-" + mupId + "-" + data.id;
      systemRequests.set(reqId, { mupId: mupId, rpcId: data.id });
      parent.postMessage({
        type: "system-request",
        reqId: reqId,
        action: data.params.action,
        params: data.params.params,
      }, "*");
    }
  }
}

// Tell panel we're ready
parent.postMessage({ type: "sandbox-ready" }, "*");
