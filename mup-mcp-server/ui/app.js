// ---- Theme ----
const sunIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
const moonIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>';

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('mup-theme', theme);
  const btn = document.getElementById('themeToggleBtn');
  btn.innerHTML = theme === 'dark' ? sunIcon : moonIcon;
  btn.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
}
applyTheme(localStorage.getItem('mup-theme') || 'light');
document.getElementById('themeToggleBtn').addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  const newTheme = current === 'dark' ? 'light' : 'dark';
  applyTheme(newTheme);
  for (const [, m] of mups) {
    if (m.manifest.darkMode && m.port) {
      m.port.postMessage({ jsonrpc: "2.0", method: "notifications/theme", params: { theme: newTheme } });
    }
  }
});

// ---- State ----
const mups = new Map();
const initResolvers = new Map();
const callMap = new Map();
let nextMsgId = 1;
let ws = null;

const statusDot = document.getElementById("statusDot");
const eventBadges = document.getElementById("eventBadges");

function escapeHtml(text) { return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }

// ---- Event Badges ----
function addEventBadge(mupName, summary) {
  const badge = document.createElement('div');
  const isError = mupName === 'Error';
  badge.className = 'event-badge';
  if (isError) badge.style.borderColor = 'var(--red)';
  badge.textContent = `${mupName}: ${summary}`;
  eventBadges.appendChild(badge);
  setTimeout(() => badge.remove(), isError ? 5000 : 3000);
}

// ---- Save Indicator ----
let _saveTimer = null;
function showSaveIndicator() {
  const el = document.getElementById('saveIndicator');
  el.classList.add('show');
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => el.classList.remove('show'), 1500);
}

// ---- GridStack ----
const CELL_SIZE = 260;
const CELL_GAP = 10;
const GS_MARGIN = CELL_GAP / 2;
const MIN_COLS = 1;
let grid;
let currentCols = 4;
let COL_SLOT = CELL_SIZE + 2 * GS_MARGIN;

function calcColumns() {
  const dashboard = document.getElementById('dashboard');
  const cols = Math.floor(dashboard.clientWidth / COL_SLOT);
  return Math.max(MIN_COLS, cols);
}

function setGridWidth(cols) {
  const gridEl = document.getElementById('grid');
  const totalW = cols * COL_SLOT;
  gridEl.style.width = totalW + 'px';
  gridEl.style.maxWidth = totalW + 'px';
  gridEl.style.minWidth = totalW + 'px';
  gridEl.style.margin = '0 auto';
}

function initGrid() {
  currentCols = calcColumns();
  setGridWidth(currentCols);
  grid = GridStack.init({
    column: currentCols,
    cellHeight: COL_SLOT,
    margin: GS_MARGIN,
    float: false,
    animate: false,
    sizeToContent: false,
    draggable: { handle: '.mup-card-header' },
    resizable: { handles: 'se' },
    minRow: 1,
  }, '#grid');
  grid.on('dragstart resizestart', () => document.body.classList.add('grid-stack-dragging'));
  grid.on('dragstop resizestop', () => {
    document.body.classList.remove('grid-stack-dragging');
    debouncedSaveGrid();
  });
}

let _gridSaveTimer = null;
function debouncedSaveGrid() {
  clearTimeout(_gridSaveTimer);
  _gridSaveTimer = setTimeout(saveGridLayout, 500);
}

function applyPendingLayout(gsId, widgetEl) {
  if (!window._pendingGridLayout || !grid) return;
  const saved = window._pendingGridLayout.find(l => l.id === gsId);
  if (saved) grid.update(widgetEl, { x: saved.x, y: saved.y, w: saved.w, h: saved.h });
}

function saveGridLayout() {
  if (!grid || !ws || ws.readyState !== WebSocket.OPEN) return;
  const layout = [];
  for (const item of grid.getGridItems()) {
    const id = item.getAttribute('gs-id');
    if (id) {
      layout.push({
        id,
        x: parseInt(item.getAttribute('gs-x') || '0'),
        y: parseInt(item.getAttribute('gs-y') || '0'),
        w: parseInt(item.getAttribute('gs-w') || '1'),
        h: parseInt(item.getAttribute('gs-h') || '1'),
      });
    }
  }
  ws.send(JSON.stringify({ type: "save-grid-layout", layout }));
}

window.addEventListener('beforeunload', () => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    saveGridLayout();
    for (const [mupId, mup] of mups) {
      if (mup.customName) {
        ws.send(JSON.stringify({ type: "rename-mup", mupId, customName: mup.customName }));
      }
    }
  }
});

window.addEventListener('resize', () => {
  if (!grid) return;
  const newCols = calcColumns();
  if (newCols !== currentCols) {
    currentCols = newCols;
    setGridWidth(newCols);
    grid.column(newCols, 'compact');
  }
});

// ---- WebSocket (with exponential backoff) ----
let _reconnectDelay = 1000;
const _maxReconnectDelay = 30000;

function connect() {
  const wsUrl = `ws://${location.host}`;
  ws = new WebSocket(wsUrl);
  ws.onopen = () => {
    statusDot.className = "status-dot connected";
    _reconnectDelay = 1000;
    callMap.clear();
    if (grid) {
      ws.send(JSON.stringify({ type: "ready" }));
      for (const [mupId] of mups) {
        ws.send(JSON.stringify({ type: "mup-loaded", mupId }));
      }
    }
  };
  ws.onclose = () => {
    statusDot.className = "status-dot disconnected";
    setTimeout(connect, _reconnectDelay);
    _reconnectDelay = Math.min(_reconnectDelay * 2, _maxReconnectDelay);
  };
  ws.onerror = () => { statusDot.className = "status-dot disconnected"; };
  ws.onmessage = (e) => {
    try { handleServerMessage(JSON.parse(e.data)); }
    catch (err) { console.error("Invalid message:", err); }
  };
}

// ---- Server Message Handling ----
let catalog = [];
const loadingBar = document.getElementById('loadingBar');

function clearAllMupWidgets() {
  if (grid) {
    for (const item of grid.getGridItems()) {
      const gid = item.getAttribute('gs-id');
        if (gid !== '__manager__' && gid !== 'mup-chat') grid.removeWidget(item);
    }
  }
  mups.clear();
}

function handleServerMessage(msg) {
  switch (msg.type) {
    case "mup-catalog": catalog = msg.catalog; renderManagerCard(); break;
    case "error": addEventBadge("Error", msg.message || "Unknown error"); break;
    case "folder-tree":
      folderTree = msg.tree || [];
      navStack = [];
      if (msg.path) {
        const pathInput = document.getElementById('mupsPathInput');
        if (pathInput) pathInput.value = msg.path;
      }
      renderManagerCard();
      break;
    case "load-mup": loadMup(msg.mupId, msg.html, msg.manifest); break;
    case "call":
      loadingBar.classList.add('active');
      callMupFunction(msg.callId, msg.mupId, msg.fn, msg.args);
      break;
    case "auto-saved": showSaveIndicator(); break;
    case "workspace-restored":
      if (msg.customNames) window._pendingCustomNames = msg.customNames;
      if (msg.gridLayout) {
        window._pendingGridLayout = msg.gridLayout;
        if (grid) {
          for (const saved of msg.gridLayout) {
            for (const item of grid.getGridItems()) {
              if (item.getAttribute('gs-id') === saved.id) {
                grid.update(item, { x: saved.x, y: saved.y, w: saved.w, h: saved.h });
                break;
              }
            }
          }
        }
      }
      if (msg.name) setWorkspaceName(msg.name);
      break;
    case "mups-path-changed": {
      const pathInput = document.getElementById('mupsPathInput');
      if (pathInput) pathInput.value = msg.path;
      break;
    }
    case "mups-path-error":
      addEventBadge("Error", (msg.errors || []).join("; "));
      break;
    case "mups-path-warnings":
      addEventBadge("Warning", (msg.warnings || []).join("; "));
      break;
    case "mup-deactivated":
      removeMup(msg.mupId);
      break;
    case "permission-request":
      showPermissionRequest(msg.requestId, msg.toolName, msg.description, msg.inputPreview);
      break;
    case "thinking":
      setThinkingIndicator(msg.active);
      break;
  }
}

// ---- MUP Loading ----
const pendingMups = [];

function loadMup(mupId, html, manifest) {
  if (mupId === 'mup-chat') { initChatWidget(); return; }
  if (grid) {
    for (const item of grid.getGridItems()) {
      if (item.getAttribute('gs-id') === mupId) return;
    }
  }
  if (!grid) { pendingMups.push({ mupId, html, manifest }); return; }

  const displayName = (window._pendingCustomNames && window._pendingCustomNames[mupId]) || manifest.name;
  const allowAttr = (manifest.permissions || []).length ? ` allow="${manifest.permissions.map(p => p + " 'src'").join('; ')}"` : '';
  const el = document.createElement('div');
  el.classList.add('grid-stack-item');
  el.setAttribute('gs-w', '1');
  el.setAttribute('gs-h', '1');
  el.setAttribute('gs-min-w', '1');
  el.setAttribute('gs-min-h', '1');
  el.setAttribute('gs-auto-position', 'true');
  el.setAttribute('gs-id', mupId);
  el.innerHTML = `
    <div class="grid-stack-item-content">
      <div class="mup-card-header">
        <span class="mup-name" title="Click to rename">${escapeHtml(displayName)}</span>
        <button class="mup-close-btn" data-mup-id="${mupId}" title="Remove">&times;</button>
      </div>
      <div class="mup-card-body"${manifest.darkMode ? ' data-dark-mode' : ''}>
        <iframe sandbox="allow-scripts allow-same-origin allow-popups allow-downloads"${allowAttr}></iframe>
      </div>
    </div>`;

  const closeBtn = el.querySelector('.mup-close-btn');
  closeBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    removeMup(mupId, el);
  });

  const nameEl = el.querySelector('.mup-name');
  nameEl.addEventListener('click', () => {
    const current = nameEl.textContent;
    const newName = prompt('Rename panel:', current);
    if (newName && newName !== current) {
      nameEl.textContent = newName;
      const mup = mups.get(mupId);
      if (mup) mup.customName = newName;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "rename-mup", mupId, customName: newName }));
      }
    }
  });

  const widget = grid.makeWidget(el);
  debouncedSaveGrid();
  const iframe = widget.querySelector('iframe');
  setupMupIframe(mupId, manifest, iframe, html);
}

function setupMupIframe(mupId, manifest, iframe, html) {
  const sdkScript = `<script>${MUP_SDK_SOURCE}<\/script>`;
  let injected = html;
  if (injected.includes("</head>")) {
    injected = injected.replace("</head>", sdkScript + "\n</head>");
  } else if (injected.includes("<body")) {
    injected = injected.replace(/<body([^>]*)>/, `<body$1>\n${sdkScript}`);
  } else {
    injected = sdkScript + "\n" + injected;
  }
  injected = injected.replace(/<script[^>]*src="[^"]*mup-sdk\.js"[^>]*><\/script>/g, "");

  const blob = new Blob([injected], { type: "text/html" });
  const blobUrl = URL.createObjectURL(blob);

  const channel = new MessageChannel();
  const port = channel.port1;
  port.onmessage = (e) => handleMupMessage(mupId, manifest.name, e.data);

  iframe.onload = () => {
    URL.revokeObjectURL(blobUrl);
    iframe.contentWindow.postMessage({ type: "mup:init" }, "*", [channel.port2]);
    const initId = nextMsgId++;
    initResolvers.set(initId, mupId);
    const initParams = {
      protocolVersion: "mup/2026-03-17",
      hostInfo: { name: "MUP MCP Panel", version: "0.1.0" },
      gridAllocation: { width: 1, height: 1 },
      theme: document.documentElement.getAttribute('data-theme') || 'light',
    };
    port.postMessage({ jsonrpc: "2.0", id: initId, method: "initialize", params: initParams });
  };
  iframe.onerror = () => {
    URL.revokeObjectURL(blobUrl);
    const body = iframe.parentElement;
    if (body) body.innerHTML = '<div style="padding:12px;color:#c00;">Failed to load MUP</div>';
  };

  iframe.src = blobUrl;
  mups.set(mupId, { iframe, port, manifest, customName: null });
}

function handleMupMessage(mupId, mupName, data) {
  if (!data || data.jsonrpc !== "2.0") return;

  if ("id" in data && !("method" in data)) {
    if (initResolvers.has(data.id)) {
      initResolvers.delete(data.id);
      const catEntry = catalog.find(c => c.id === mupId);
      if (catEntry) catEntry.active = true;
      renderManagerCard();
      if (window._pendingGridLayout && grid) {
        const saved = window._pendingGridLayout.find(l => l.id === mupId);
        if (saved) {
          for (const item of grid.getGridItems()) {
            if (item.getAttribute('gs-id') === mupId) {
              grid.update(item, { x: saved.x, y: saved.y, w: saved.w, h: saved.h });
              debouncedSaveGrid();
              break;
            }
          }
        }
      }
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "mup-loaded", mupId }));
      return;
    }
    if (callMap.has(data.id)) {
      const callId = callMap.get(data.id);
      callMap.delete(data.id);
      const result = data.error
        ? { content: [{ type: "text", text: data.error.message || "Error" }], isError: true }
        : (data.result || { content: [{ type: "text", text: "No result" }], isError: false });
      loadingBar.classList.remove('active');
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "result", callId, result }));
      return;
    }
    return;
  }

  if ("method" in data && !("id" in data)) {
    if (data.method === "notifications/state/update") {
      if (ws && ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ type: "state", mupId, summary: data.params?.summary || "", data: data.params?.data }));
    } else if (data.method === "notifications/interaction") {
      addEventBadge(mupName, data.params?.summary || data.params?.action);
      if (ws && ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ type: "interaction", mupId, action: data.params?.action || "", summary: data.params?.summary || "", data: data.params?.data }));
    }
  }
}

function callMupFunction(callId, mupId, fn, args) {
  if (mupId === 'mup-chat') {
    const result = handleChatFunctionCall(fn, args || {});
    loadingBar.classList.remove('active');
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "result", callId, result }));
    return;
  }
  const mup = mups.get(mupId);
  if (!mup) {
    loadingBar.classList.remove('active');
    if (ws && ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ type: "result", callId, result: { content: [{ type: "text", text: `MUP not loaded: ${mupId}` }], isError: true } }));
    return;
  }
  const msgId = nextMsgId++;
  callMap.set(msgId, callId);
  mup.port.postMessage({ jsonrpc: "2.0", id: msgId, method: "functions/call", params: { name: fn, arguments: args || {}, source: "llm" } });
}

function removeMup(mupId, widgetEl) {
  if (widgetEl) {
    try { grid.removeWidget(widgetEl); } catch {}
  } else {
    for (const item of grid.getGridItems()) {
      if (item.getAttribute('gs-id') === mupId) {
        grid.removeWidget(item);
        break;
      }
    }
  }
  debouncedSaveGrid();
  mups.delete(mupId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "deactivate-mup", mupId }));
  }
  const entry = catalog.find(c => c.id === mupId);
  if (entry) entry.active = false;
  renderManagerCard();
}

// ---- Workspace Name ----
const headerTitle = document.getElementById('headerTitle');
let workspaceName = '';

function setWorkspaceName(name) {
  workspaceName = name || '';
  if (headerTitle) headerTitle.textContent = workspaceName || 'MUP Panel';
  document.title = workspaceName ? `${workspaceName} — MUP Panel` : 'MUP Panel (MCP)';
}

if (headerTitle) {
  headerTitle.addEventListener('click', () => {
    const name = prompt('Workspace name:', workspaceName);
    if (name === null) return;
    setWorkspaceName(name);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "rename-workspace", name }));
    }
  });
}

// ---- Save Button ----
const flushSaveBtn = document.getElementById('flushSaveBtn');
if (flushSaveBtn) {
  flushSaveBtn.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "flush-save" }));
      showSaveIndicator();
    }
  });
}
