// Service worker: routes messages between Side Panel ↔ Content Scripts ↔ Native Host
// Uses chrome.tabs.sendMessage for content scripts (robust against SW restarts)

// ---- Native messaging ----
let nativePort = null;
const nativePending = new Map(); // id → { resolve, reject, timer }

function connectNative() {
  if (nativePort) return nativePort;
  try {
    nativePort = chrome.runtime.connectNative("com.mup.native");
    nativePort.onMessage.addListener((msg) => {
      const pending = nativePending.get(msg.id);
      if (pending) {
        clearTimeout(pending.timer);
        nativePending.delete(msg.id);
        if (msg.type === "error") pending.reject(new Error(msg.message));
        else pending.resolve(msg.data);
      }
    });
    nativePort.onDisconnect.addListener(() => {
      nativePort = null;
      // Reject all pending
      for (const [id, p] of nativePending) {
        clearTimeout(p.timer);
        p.reject(new Error("Native host disconnected"));
      }
      nativePending.clear();
    });
    return nativePort;
  } catch (e) {
    console.error("[MUP] Native host connection failed:", e);
    return null;
  }
}

let nativeIdCounter = 0;
function callNative(type, params) {
  return new Promise((resolve, reject) => {
    const port = connectNative();
    if (!port) return reject(new Error("Native host not available. Run: node mup-native-host/install.js"));
    const id = "n" + (++nativeIdCounter);
    const timer = setTimeout(() => {
      nativePending.delete(id);
      reject(new Error("Native host timeout"));
    }, 30000);
    nativePending.set(id, { resolve, reject, timer });
    port.postMessage({ id, type, params: params || {} });
  });
}

// Open side panel when extension icon clicked
chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ tabId: tab.id });
});

// Panel persistent connection
let panelPort = null;
let loadedMups = [];

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "mup-panel") {
    panelPort = port;
    port.onDisconnect.addListener(() => {
      panelPort = null;
    });

    port.onMessage.addListener((msg) => {
      if (msg.type === "mups-updated") {
        loadedMups = msg.mups;
        broadcastToContentScripts({ type: "mups-updated", mups: loadedMups });
      } else if (msg.type === "function-result") {
        broadcastToContentScripts({
          type: "function-result",
          callId: msg.callId,
          result: msg.result,
        });
      } else if (msg.type === "inject-prompt") {
        broadcastToContentScripts({ type: "inject-prompt" });
      } else if (msg.type === "interaction") {
        broadcastToContentScripts({
          type: "interaction",
          mupId: msg.mupId,
          mupName: msg.mupName,
          action: msg.action,
          summary: msg.summary,
        });
      }
    });
  }
});

// Content scripts use one-off messages (robust against SW restarts)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "get-mups") {
    sendResponse({ mups: loadedMups });
    return;
  }

  if (msg.type === "system-request") {
    // Route to native messaging host
    callNative(msg.action, msg.params)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // async sendResponse
  }

  if (msg.type === "call-function") {
    // Content script detected a MUP call — forward to panel
    if (panelPort) {
      panelPort.postMessage({
        type: "call-function",
        callId: msg.callId,
        mupId: msg.mupId,
        fn: msg.fn,
        args: msg.args,
        _replyTabId: sender.tab?.id,
      });
    }
    sendResponse({ ok: true });
    return;
  }
});

// Broadcast to all content scripts on matching tabs
async function broadcastToContentScripts(msg) {
  try {
    const tabs = await chrome.tabs.query({
      url: [
        "https://chatgpt.com/*",
        "https://chat.openai.com/*",
        "https://claude.ai/*",
        "https://gemini.google.com/*",
      ],
    });
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, msg).catch(() => {
        // Tab might not have content script loaded yet, ignore
      });
    }
  } catch {
    // tabs API not available, ignore
  }
}
