// Panel: proper grid manager + PoC-matching drag/resize
// Architecture matches PoC's GridLayoutManager + MupContainer
// Gemini input ref: https://github.com/Nagi-ovo/gemini-voyager

// ===== Grid Manager (port of PoC GridLayoutManager) =====
class GridManager {
  constructor(container, cols = 4, rows = 3) {
    this.container = container;
    this.allocations = new Map(); // mupId → {x, y, w, h}
    this.cols = cols;
    this.fixedRows = rows;
    this.gap = 10;
  }

  updateCols() {
    // Fixed columns — no reflow on resize
  }

  getCellSize() {
    const usable = this.container.clientWidth - this.gap * 2;
    return Math.floor((usable - this.gap * (this.cols - 1)) / this.cols);
  }

  getStep() { return this.getCellSize() + this.gap; }

  getGridOrigin() {
    const rect = this.container.getBoundingClientRect();
    return { x: rect.left + this.gap, y: rect.top + this.gap - this.container.scrollTop };
  }

  getColumns() { return this.cols; }

  getRows() {
    let maxRow = 0;
    for (const a of this.allocations.values()) maxRow = Math.max(maxRow, a.y + a.h - 1);
    return Math.max(this.fixedRows, maxRow + 1);
  }

  allocate(mupId, w, h) {
    w = Math.min(w, this.cols);
    for (let y = 1; y <= 50; y++) {
      for (let x = 1; x <= this.cols - w + 1; x++) {
        if (this.canPlace(x, y, w, h, mupId)) {
          this.allocations.set(mupId, { x, y, w, h });
          return { x, y, w, h };
        }
      }
    }
    return null;
  }

  canPlace(x, y, w, h, excludeId) {
    if (x < 1 || x + w - 1 > this.cols) return false;
    for (const [id, a] of this.allocations) {
      if (id === excludeId) continue;
      if (x < a.x + a.w && x + w > a.x && y < a.y + a.h && y + h > a.y) return false;
    }
    return true;
  }

  move(mupId, newX, newY) {
    const a = this.allocations.get(mupId);
    if (!a) return false;
    newX = Math.max(1, Math.min(newX, this.cols - a.w + 1));
    newY = Math.max(1, newY);
    if (this.canPlace(newX, newY, a.w, a.h, mupId)) {
      a.x = newX; a.y = newY;
      return true;
    }
    return false;
  }

  resize(mupId, newW, newH) {
    const a = this.allocations.get(mupId);
    if (!a) return false;
    newW = Math.max(1, Math.min(newW, this.cols - a.x + 1));
    newH = Math.max(1, newH);
    if (this.canPlace(a.x, a.y, newW, newH, mupId)) {
      a.w = newW; a.h = newH;
      return true;
    }
    return false;
  }

  deallocate(mupId) { this.allocations.delete(mupId); }
  getAllocation(mupId) { return this.allocations.get(mupId); }
}

// ===== State =====
const mups = new Map();
const grid = document.getElementById("grid");
const fileInput = document.getElementById("fileInput");
const gm = new GridManager(grid, 4, 3); // 4×3 grid, same as PoC

// ===== Service Worker =====
let port = null;
try {
  port = chrome.runtime.connect({ name: "mup-panel" });
  port.onMessage.addListener((msg) => {
    if (msg.type === "call-function") {
      const mup = mups.get(msg.mupId);
      if (mup?.sandbox?.contentWindow) {
        mup.sandbox.contentWindow.postMessage({
          type: "call-function", callId: msg.callId,
          mupId: msg.mupId, fn: msg.fn, args: msg.args,
        }, "*");
      }
    }
  });
} catch (e) { console.warn("[MUP] SW unavailable:", e); }

window.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg?.type) return;
  if (msg.type === "function-result" && port)
    port.postMessage({ type: "function-result", callId: msg.callId, result: msg.result });
  if (msg.type === "system-request") {
    // Route to service worker → native host
    chrome.runtime.sendMessage({
      type: "system-request",
      action: msg.action,
      params: msg.params,
    }, (response) => {
      // Route response back to the sandbox that requested it
      const source = event.source;
      if (source) {
        source.postMessage({
          type: "system-response",
          reqId: msg.reqId,
          data: response?.data,
          error: response?.error,
        }, "*");
      }
    });
    return;
  }
  if (msg.type === "interaction" && port) {
    const mup = mups.get(msg.mupId);
    port.postMessage({ type: "interaction", mupId: msg.mupId,
      mupName: mup?.manifest.name || msg.mupId, action: msg.action || "", summary: msg.summary || "" });
  }
});

// ===== File Loading =====
fileInput.addEventListener("change", (e) => { for (const f of e.target.files) loadFile(f); fileInput.value = ""; });
// File drop on grid area
grid.addEventListener("dragover", (e) => e.preventDefault());
grid.addEventListener("drop", (e) => { e.preventDefault(); for (const f of e.dataTransfer.files) loadFile(f); });

// Context auto-injects on first message — no manual sync needed

async function loadFile(file) {
  if (!file.name.endsWith(".html") && !file.name.endsWith(".htm")) return;
  loadMup(await file.text(), file.name);
}

// ===== MUP Loading =====
function loadMup(html, fileName) {
  const match = html.match(/<script\s+type=["']application\/mup-manifest["']\s*>([\s\S]*?)<\/script>/);
  if (!match) return;
  let raw; try { raw = JSON.parse(match[1].trim()); } catch { return; }

  const manifest = {
    protocol: raw.protocol || "mup/2026-03-17",
    id: raw.id || "mup-" + fileName.replace(/\.html?$/, ""),
    name: raw.name || fileName, version: raw.version || "1.0.0",
    description: raw.description || raw.name || fileName,
    grid: raw.grid || {},
    functions: (raw.functions || []).map(fn => ({
      name: fn.name, description: fn.description || fn.name,
      inputSchema: fn.inputSchema || { type: "object", properties: {} },
    })),
    permissions: raw.permissions || [],
  };
  if (mups.has(manifest.id)) return;
  // grid ready

  gm.updateCols();
  const w = Math.min(manifest.grid.minWidth || 1, gm.getColumns());
  const h = manifest.grid.minHeight || 1;
  const alloc = gm.allocate(manifest.id, w, h);
  if (!alloc) return;

  // Build card (matches PoC MupContainer)
  const card = document.createElement("div");
  card.className = "mup-card";

  const header = document.createElement("div");
  header.className = "mup-card-header";
  const nameSpan = document.createElement("span");
  nameSpan.className = "mup-name";
  nameSpan.textContent = manifest.name;
  header.appendChild(nameSpan);

  const closeBtn = document.createElement("div");
  closeBtn.className = "mup-close-btn";
  closeBtn.title = "Remove MUP";
  closeBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="2" y1="2" x2="8" y2="8"/><line x1="8" y1="2" x2="2" y2="8"/></svg>';
  closeBtn.addEventListener("click", (e) => { e.stopPropagation(); unloadMup(manifest.id); });
  header.appendChild(closeBtn);

  const dragHandle = document.createElement("div");
  dragHandle.className = "mup-drag-handle";
  dragHandle.title = "Drag to move";
  dragHandle.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><circle cx="3" cy="3" r="1.5"/><circle cx="7" cy="3" r="1.5"/><circle cx="3" cy="7" r="1.5"/><circle cx="7" cy="7" r="1.5"/></svg>';
  header.appendChild(dragHandle);
  card.appendChild(header);

  const body = document.createElement("div");
  body.className = "mup-card-body";
  const sandbox = document.createElement("iframe");
  sandbox.src = chrome.runtime.getURL("sandbox/mup-host.html");
  sandbox.style.cssText = "width:100%;height:100%;border:none;display:block;";
  // Pass MUP permissions up through the iframe chain
  if (manifest.permissions && manifest.permissions.length > 0) {
    sandbox.allow = manifest.permissions.map(p => p + " *").join("; ");
  }
  body.appendChild(sandbox);
  card.appendChild(body);

  const resizeHandle = document.createElement("div");
  resizeHandle.className = "mup-resize-handle";
  resizeHandle.title = "Drag to resize";
  card.appendChild(resizeHandle);

  grid.appendChild(card);
  applyPlacement(card, alloc);

  mups.set(manifest.id, { manifest, card, sandbox, html });

  // Wire PoC-style drag & resize
  setupDrag(dragHandle, manifest.id);
  setupResize(resizeHandle, manifest);

  sandbox.onload = () => {
    sandbox.contentWindow.postMessage({ type: "load-mup", mupId: manifest.id, html, manifest }, "*");
  };

  renderGrid();
  notifyMupsUpdated();
}

function unloadMup(mupId) {
  const mup = mups.get(mupId);
  if (!mup) return;
  if (mup.sandbox?.contentWindow) mup.sandbox.contentWindow.postMessage({ type: "unload-mup", mupId }, "*");
  mup.card.remove();
  mups.delete(mupId);
  gm.deallocate(mupId);
  // grid updated
  renderGrid();
  notifyMupsUpdated();
}

// ===== Apply grid placement to a card =====
function applyPlacement(card, alloc) {
  card.style.gridColumn = alloc.x + " / span " + alloc.w;
  card.style.gridRow = alloc.y + " / span " + alloc.h;
}

// ===== Render grid: set template + empty cells =====
function renderGrid() {
  gm.updateCols();
  const cols = gm.getColumns();
  const rows = gm.getRows();

  const cellPx = gm.getCellSize();
  grid.style.gridTemplateColumns = "repeat(" + cols + ", " + cellPx + "px)";
  grid.style.gridTemplateRows = "repeat(" + rows + ", " + cellPx + "px)";

  // Re-apply placements (cols may have changed)
  for (const [mupId, mup] of mups) {
    const alloc = gm.getAllocation(mupId);
    if (alloc) applyPlacement(mup.card, alloc);
  }

  // Clear and rebuild empty cells
  grid.querySelectorAll(".grid-cell-empty").forEach(el => el.remove());
  const occupied = new Set();
  for (const a of gm.allocations.values()) {
    for (let y = a.y; y < a.y + a.h; y++)
      for (let x = a.x; x < a.x + a.w; x++)
        occupied.add(x + "," + y);
  }
  for (let y = 1; y <= rows; y++) {
    for (let x = 1; x <= cols; x++) {
      if (!occupied.has(x + "," + y)) {
        const cell = document.createElement("div");
        cell.className = "grid-cell-empty";
        cell.style.gridColumn = x + "";
        cell.style.gridRow = y + "";
        cell.addEventListener("click", () => fileInput.click());
        grid.appendChild(cell);
      }
    }
  }

  document.getElementById("mupCount").textContent = mups.size > 0 ? mups.size + " active" : "";
}

// Fixed grid — no reflow on resize, just re-render empty cells
window.addEventListener("resize", () => renderGrid());

// ===== PoC-style Drag =====
function setupDrag(handle, mupId) {
  handle.addEventListener("mousedown", (e) => {
    e.preventDefault(); e.stopPropagation();
    const alloc = gm.getAllocation(mupId);
    const mup = mups.get(mupId);
    if (!alloc || !mup) return;

    const step = gm.getStep();
    const origin = gm.getGridOrigin();
    const cardLeft = origin.x + (alloc.x - 1) * step;
    const cardTop = origin.y + (alloc.y - 1) * step;
    const grabX = e.clientX - cardLeft;
    const grabY = e.clientY - cardTop;
    let targetCol = alloc.x, targetRow = alloc.y;

    addOverlay();
    mup.card.classList.add("dragging");
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";

    const preview = createPreview();
    preview.style.gridColumn = alloc.x + " / span " + alloc.w;
    preview.style.gridRow = alloc.y + " / span " + alloc.h;

    const onMove = (ev) => {
      const o = gm.getGridOrigin();
      const s = gm.getStep();
      let col = Math.round((ev.clientX - grabX - o.x) / s) + 1;
      let row = Math.round((ev.clientY - grabY - o.y) / s) + 1;
      col = Math.max(1, Math.min(col, gm.getColumns() - alloc.w + 1));
      row = Math.max(1, row);
      targetCol = col; targetRow = row;
      preview.style.gridColumn = col + " / span " + alloc.w;
      preview.style.gridRow = row + " / span " + alloc.h;
    };

    const onUp = () => {
      removeOverlay();
      mup.card.classList.remove("dragging");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      removePreview(preview);

      if (gm.move(mupId, targetCol, targetRow)) {
        applyPlacement(mup.card, gm.getAllocation(mupId));
      }
      renderGrid();
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
}

// ===== PoC-style Resize =====
function setupResize(handle, manifest) {
  handle.addEventListener("mousedown", (e) => {
    e.preventDefault(); e.stopPropagation();
    const mup = mups.get(manifest.id);
    const alloc = gm.getAllocation(manifest.id);
    if (!mup || !alloc) return;

    const step = gm.getStep();
    const origin = gm.getGridOrigin();
    const cardLeft = origin.x + (alloc.x - 1) * step;
    const cardTop = origin.y + (alloc.y - 1) * step;

    const minW = manifest.grid.minWidth || 1;
    const minH = manifest.grid.minHeight || 1;
    const maxW = manifest.grid.maxWidth || gm.getColumns();
    const maxH = manifest.grid.maxHeight || 6;
    let targetW = alloc.w, targetH = alloc.h;

    addOverlay();
    mup.card.style.zIndex = "100";
    document.body.style.cursor = "nwse-resize";
    document.body.style.userSelect = "none";

    const preview = createPreview();
    preview.style.gridColumn = alloc.x + " / span " + alloc.w;
    preview.style.gridRow = alloc.y + " / span " + alloc.h;

    const onMove = (ev) => {
      const s = gm.getStep();
      const dx = ev.clientX - cardLeft;
      const dy = ev.clientY - cardTop;
      let newW = Math.max(minW, Math.min(Math.ceil(dx / s), maxW));
      let newH = Math.max(minH, Math.min(Math.ceil(dy / s), maxH));
      newW = Math.min(newW, gm.getColumns() - alloc.x + 1);
      targetW = newW; targetH = newH;
      preview.style.gridColumn = alloc.x + " / span " + newW;
      preview.style.gridRow = alloc.y + " / span " + newH;
    };

    const onUp = () => {
      removeOverlay();
      mup.card.style.zIndex = "";
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      removePreview(preview);

      if (gm.resize(manifest.id, targetW, targetH)) {
        applyPlacement(mup.card, gm.getAllocation(manifest.id));
      }
      renderGrid();
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
}

// ===== Preview ghost =====
function createPreview() {
  const p = document.createElement("div");
  p.className = "mup-preview";
  grid.appendChild(p);
  return p;
}
function removePreview(p) { if (p) p.remove(); }

// ===== Overlay =====
let overlay = null;
function addOverlay() {
  if (overlay) return;
  overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;z-index:9999;cursor:inherit;";
  document.body.appendChild(overlay);
}
function removeOverlay() { if (overlay) { overlay.remove(); overlay = null; } }

function notifyMupsUpdated() {
  if (!port) return;
  try {
    port.postMessage({ type: "mups-updated",
      mups: Array.from(mups.values()).map(m => ({ mupId: m.manifest.id, manifest: m.manifest })),
    });
  } catch {}
}
