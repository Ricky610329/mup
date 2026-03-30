// ---- PDF Reader MUP ----
// pdfjsLib loaded via <script> tag in index.html (global)
// Set worker after DOM ready to ensure pdfjsLib is loaded
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// ---- State ----
const STORE_KEY = 'mup-pdf-data';
let store = { _v: 1, folderMeta: {}, docMeta: {} };
let pdfDoc = null;
let currentPage = 1;
let totalPages = 0;
let currentPath = null;
let scale = 2.0;
let selection = null; // { x, y, w, h } in canvas pixels

// ---- Helpers ----
function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function ok(text, data) { const c = [{ type: 'text', text }]; if (data !== undefined) c.push({ type: 'data', data }); return { content: c, isError: false }; }
function err(text) { return { content: [{ type: 'text', text }], isError: true }; }

// ---- Persistence ----
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch {} }
function load() {
  try { const d = JSON.parse(localStorage.getItem(STORE_KEY)); if (d?._v === 1) store = d; } catch {}
}

// ---- State Broadcasting ----
let broadcastTimer = null;
function broadcastState() {
  clearTimeout(broadcastTimer);
  broadcastTimer = setTimeout(() => {
    const parts = [];
    if (currentPath) parts.push(`Viewing "${currentPath.split('/').pop()}" p${currentPage}/${totalPages}`);
    if (selection) parts.push(`Selection: ${Math.round(selection.w)}x${Math.round(selection.h)}`);
    mup.updateState('PDF: ' + (parts.length ? parts.join('. ') : 'idle') + '.', {
      pdf: currentPath, page: currentPage, totalPages, scale, selection,
    });
  }, 300);
}

// ==== PDF RENDERING ====

const pdfCanvas = document.getElementById('pdfCanvas');
const pdfCtx = pdfCanvas.getContext('2d');

async function renderPage(pageNum) {
  if (!pdfDoc) return;
  pageNum = Math.max(1, Math.min(totalPages, pageNum));
  currentPage = pageNum;
  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  pdfCanvas.width = viewport.width;
  pdfCanvas.height = viewport.height;
  await page.render({ canvasContext: pdfCtx, viewport }).promise;
  document.getElementById('pageInput').value = pageNum;
  drawSelection();
  broadcastState();
}

async function loadPdfFromPath(filePath) {
  if (typeof pdfjsLib === 'undefined') {
    document.getElementById('emptyState').innerHTML = '<div class="empty-icon">!</div><div class="empty-text" style="color:var(--red)">PDF.js failed to load from CDN</div>';
    document.getElementById('emptyState').style.display = '';
    return;
  }
  try {
    const base64 = await mup.readFileBase64(filePath);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    pdfDoc = await pdfjsLib.getDocument({ data: bytes }).promise;
    totalPages = pdfDoc.numPages;
    currentPath = filePath;
    currentPage = 1;
    selection = null;
    document.getElementById('pdfTitle').textContent = filePath.split('/').pop();
    document.getElementById('pageControls').style.display = '';
    document.getElementById('pageTotal').textContent = `/ ${totalPages}`;
    document.getElementById('pageInput').max = totalPages;
    document.getElementById('emptyState').style.display = 'none';
    document.getElementById('pdfContainer').style.display = '';
    await renderPage(1);
    renderFileTree();
    mup.notifyInteraction('pdf-opened', `Opened ${filePath.split('/').pop()} (${totalPages} pages)`, { path: filePath, pages: totalPages });
  } catch (e) {
    const denied = e.message?.includes('Access denied');
    const container = document.getElementById('emptyState');
    container.style.display = ''; document.getElementById('pdfContainer').style.display = 'none';
    if (denied) {
      const folder = filePath.substring(0, filePath.lastIndexOf('/') + 1);
      const folderName = folder.split('/').filter(Boolean).pop() || folder;
      container.innerHTML = `<div style="font-size:13px;margin-bottom:12px;color:var(--text-muted)">Access required</div><button id="grantBtn" style="padding:6px 16px;border:1px solid var(--accent);border-radius:5px;background:transparent;color:var(--accent);cursor:pointer;font-size:12px">Grant Access to ${esc(folderName)}/</button>`;
      document.getElementById('grantBtn').addEventListener('click', async () => {
        try { await mup.system('grantFileAccess', { paths: [folder] }); await loadPdfFromPath(filePath); } catch {}
      });
    } else {
      container.innerHTML = `<div class="empty-icon">!</div><div class="empty-text" style="color:var(--red)">${esc(e.message)}</div>`;
    }
  }
}

// ==== PAGE NAVIGATION ====

document.getElementById('prevPage').addEventListener('click', () => { if (currentPage > 1) renderPage(currentPage - 1); });
document.getElementById('nextPage').addEventListener('click', () => { if (currentPage < totalPages) renderPage(currentPage + 1); });
document.getElementById('pageInput').addEventListener('change', (e) => {
  const p = parseInt(e.target.value);
  if (p >= 1 && p <= totalPages) renderPage(p);
});
document.getElementById('pageInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.target.blur(); const p = parseInt(e.target.value); if (p >= 1 && p <= totalPages) renderPage(p); }
});

// ==== ZOOM ====

document.getElementById('zoomIn').addEventListener('click', () => { scale = Math.min(4, scale + 0.25); updateZoom(); });
document.getElementById('zoomOut').addEventListener('click', () => { scale = Math.max(0.5, scale - 0.25); updateZoom(); });
document.getElementById('content').addEventListener('wheel', (e) => {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    scale = Math.max(0.5, Math.min(4, scale + (e.deltaY < 0 ? 0.1 : -0.1)));
    updateZoom();
  }
}, { passive: false });

function updateZoom() {
  document.getElementById('zoomLevel').textContent = `${Math.round(scale * 100)}%`;
  if (pdfDoc) renderPage(currentPage);
}

// ==== SELECTION ====

const overlay = document.getElementById('selectionOverlay');
let dragging = false;
let dragStart = null;
let dragMode = null; // 'create' | 'move' | 'resize-nw' | 'resize-ne' | 'resize-sw' | 'resize-se'
let dragOffset = null;

overlay.addEventListener('pointerdown', (e) => {
  const rect = overlay.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  // Check if clicking on existing selection
  if (selection) {
    const { x, y, w, h } = selection;
    const margin = 8;
    // Check resize handles (corners)
    if (Math.abs(mx - x) < margin && Math.abs(my - y) < margin) { dragMode = 'resize-nw'; }
    else if (Math.abs(mx - (x + w)) < margin && Math.abs(my - y) < margin) { dragMode = 'resize-ne'; }
    else if (Math.abs(mx - x) < margin && Math.abs(my - (y + h)) < margin) { dragMode = 'resize-sw'; }
    else if (Math.abs(mx - (x + w)) < margin && Math.abs(my - (y + h)) < margin) { dragMode = 'resize-se'; }
    // Check if inside selection (move)
    else if (mx >= x && mx <= x + w && my >= y && my <= y + h) {
      dragMode = 'move';
      dragOffset = { dx: mx - x, dy: my - y };
    }
    // Outside selection = create new
    else { dragMode = 'create'; }
  } else {
    dragMode = 'create';
  }

  dragging = true;
  dragStart = { x: mx, y: my };
  if (dragMode === 'create') selection = { x: mx, y: my, w: 0, h: 0 };
  overlay.setPointerCapture(e.pointerId);
});

overlay.addEventListener('pointermove', (e) => {
  if (!dragging || !selection) return;
  const rect = overlay.getBoundingClientRect();
  const mx = Math.max(0, Math.min(pdfCanvas.width, e.clientX - rect.left));
  const my = Math.max(0, Math.min(pdfCanvas.height, e.clientY - rect.top));

  if (dragMode === 'create') {
    selection.w = mx - dragStart.x;
    selection.h = my - dragStart.y;
  } else if (dragMode === 'move') {
    selection.x = mx - dragOffset.dx;
    selection.y = my - dragOffset.dy;
  } else if (dragMode === 'resize-se') {
    selection.w = mx - selection.x;
    selection.h = my - selection.y;
  } else if (dragMode === 'resize-nw') {
    selection.w += selection.x - mx;
    selection.h += selection.y - my;
    selection.x = mx; selection.y = my;
  } else if (dragMode === 'resize-ne') {
    selection.w = mx - selection.x;
    selection.h += selection.y - my;
    selection.y = my;
  } else if (dragMode === 'resize-sw') {
    selection.w += selection.x - mx;
    selection.x = mx;
    selection.h = my - selection.y;
  }
  drawSelection();
});

overlay.addEventListener('pointerup', () => {
  if (!dragging) return;
  dragging = false;
  if (selection) {
    // Normalize negative widths/heights
    if (selection.w < 0) { selection.x += selection.w; selection.w = -selection.w; }
    if (selection.h < 0) { selection.y += selection.h; selection.h = -selection.h; }
    // Remove tiny accidental selections
    if (selection.w < 5 && selection.h < 5) { selection = null; }
    drawSelection();
    if (selection) {
      broadcastState();
      mup.notifyInteraction('selection-changed', `Selection on page ${currentPage}`, { page: currentPage, rect: selection });
    }
  }
});

function drawSelection() {
  // Remove old
  overlay.querySelectorAll('.selection-box').forEach(el => el.remove());
  if (!selection) return;
  const { x, y, w, h } = selection;
  const box = document.createElement('div');
  box.className = 'selection-box';
  box.style.left = `${Math.min(x, x + w)}px`;
  box.style.top = `${Math.min(y, y + h)}px`;
  box.style.width = `${Math.abs(w)}px`;
  box.style.height = `${Math.abs(h)}px`;
  box.innerHTML = '<div class="resize-handle nw"></div><div class="resize-handle ne"></div><div class="resize-handle sw"></div><div class="resize-handle se"></div>';
  overlay.appendChild(box);
}

// ==== SIDEBAR ====

document.getElementById('sidebarToggle').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('collapsed'));

// Upload PDF
document.getElementById('uploadBtn').addEventListener('click', () => document.getElementById('fileInput').click());
document.getElementById('fileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = ''; // reset for re-upload
  try {
    // Read file as base64
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    // Determine save path: cwd or first registered folder
    const cwdResult = await mup.system('getCwd', {});
    const cwd = cwdResult?.content || '/tmp/';
    const savePath = (cwd.endsWith('/') ? cwd : cwd + '/') + 'notes/' + file.name;
    // Write copy via base64 → binary write
    // writeFile expects utf-8 string, so we need to use system action directly
    await mup.system('writeFileBase64', { path: savePath, content: base64 });
    // Register folder + file
    const folder = savePath.substring(0, savePath.lastIndexOf('/') + 1);
    if (!store.folderMeta[folder]) store.folderMeta[folder] = { description: '', role: '', tags: [] };
    store.docMeta[savePath] = {};
    save(); renderFileTree();
    await loadPdfFromPath(savePath);
  } catch (err) {
    // Fallback: load directly from memory without saving
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const bytes = new Uint8Array(reader.result);
        pdfDoc = await pdfjsLib.getDocument({ data: bytes }).promise;
        totalPages = pdfDoc.numPages;
        currentPath = file.name;
        currentPage = 1;
        selection = null;
        document.getElementById('pdfTitle').textContent = file.name;
        document.getElementById('pageControls').style.display = '';
        document.getElementById('pageTotal').textContent = `/ ${totalPages}`;
        document.getElementById('emptyState').style.display = 'none';
        document.getElementById('pdfContainer').style.display = '';
        await renderPage(1);
      };
      reader.readAsArrayBuffer(file);
    } catch {}
  }
});

// Sidebar resize
const resizer = document.getElementById('sidebarResizer');
let resizing = false;
resizer.addEventListener('mousedown', (e) => { e.preventDefault(); resizing = true; resizer.classList.add('active'); document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'; });
document.addEventListener('mousemove', (e) => { if (!resizing) return; document.getElementById('sidebar').style.width = Math.max(120, Math.min(400, e.clientX - document.getElementById('mainLayout').getBoundingClientRect().left)) + 'px'; });
document.addEventListener('mouseup', () => { if (!resizing) return; resizing = false; resizer.classList.remove('active'); document.body.style.cursor = ''; document.body.style.userSelect = ''; });

function renderFileTree() {
  const tree = document.getElementById('fileTree');
  const files = Object.keys(store.docMeta).sort();
  if (!files.length) {
    tree.innerHTML = '<div style="padding:12px;font-size:11px;color:var(--text-muted)">No PDFs. Ask the LLM to import a folder.</div>';
    return;
  }
  // Group by folder
  const folders = {};
  for (const f of files) {
    const dir = f.substring(0, f.lastIndexOf('/') + 1);
    if (!folders[dir]) folders[dir] = [];
    folders[dir].push(f);
  }
  let html = '';
  for (const [folder, fls] of Object.entries(folders).sort()) {
    const name = folder.replace(/\/$/, '').split('/').pop() || folder;
    html += `<div class="folder-item" data-folder="${esc(folder)}"><svg class="folder-arrow expanded" viewBox="0 0 12 12"><path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>${esc(name)}</div>`;
    html += `<div class="folder-children" data-fc="${esc(folder)}">`;
    for (const f of fls) {
      const fname = f.split('/').pop();
      const active = currentPath === f ? ' active' : '';
      html += `<div class="file-item${active}" data-path="${esc(f)}"><span class="file-name">${esc(fname)}</span><button class="file-delete" data-del="${esc(f)}" title="Remove">&times;</button></div>`;
    }
    html += '</div>';
  }
  tree.innerHTML = html;
}

document.getElementById('fileTree').addEventListener('click', (e) => {
  const del = e.target.closest('[data-del]');
  if (del) { e.stopPropagation(); confirmDelete(del.dataset.del); return; }
  const file = e.target.closest('.file-item');
  if (file?.dataset.path) { loadPdfFromPath(file.dataset.path); return; }
  const folder = e.target.closest('.folder-item');
  if (folder?.dataset.folder) {
    const ch = document.querySelector(`[data-fc="${CSS.escape(folder.dataset.folder)}"]`);
    if (ch) { ch.classList.toggle('collapsed'); folder.querySelector('.folder-arrow')?.classList.toggle('expanded'); }
  }
});

// Delete
let pendingDel = null;
function confirmDelete(p) { pendingDel = p; document.getElementById('deleteFileName').textContent = p.split('/').pop(); document.getElementById('deleteModal').style.display = 'block'; }
document.getElementById('deleteConfirm').addEventListener('click', () => {
  if (pendingDel) { delete store.docMeta[pendingDel]; if (currentPath === pendingDel) { pdfDoc = null; currentPath = null; document.getElementById('emptyState').style.display = ''; document.getElementById('pageControls').style.display = 'none'; } save(); renderFileTree(); broadcastState(); }
  pendingDel = null; document.getElementById('deleteModal').style.display = 'none';
});
document.getElementById('deleteCancel').addEventListener('click', () => { pendingDel = null; document.getElementById('deleteModal').style.display = 'none'; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && pendingDel) { pendingDel = null; document.getElementById('deleteModal').style.display = 'none'; } });

// ==== WORKSPACE SCAN ====

async function scanWorkspace() {
  try {
    const folders = Object.keys(store.folderMeta);
    if (!folders.length) return;
    await mup.system('grantFileAccess', { paths: folders });
    store.docMeta = {};
    for (const folder of folders) {
      try {
        const result = await mup.system('scanDirectory', { path: folder });
        const allFiles = JSON.parse(result?.content || '[]');
        for (const f of allFiles) {
          if (/\.pdf$/i.test(f)) store.docMeta[f] = store.docMeta[f] || {};
        }
      } catch {}
    }
    save(); renderFileTree(); broadcastState();
  } catch {}
}

// ==== MUP FUNCTIONS ====

mup.registerFunction('loadPDF', async (p) => {
  if (!p.path) return err('path required');
  await loadPdfFromPath(p.path);
  return pdfDoc ? ok(`Loaded ${p.path.split('/').pop()} (${totalPages} pages)`, { pages: totalPages }) : err('Failed to load');
});

mup.registerFunction('goToPage', async (p) => {
  if (!pdfDoc) return err('No PDF loaded');
  await renderPage(p.page);
  mup.notifyInteraction('page-changed', `Page ${currentPage}`, { page: currentPage });
  return ok(`Page ${currentPage}/${totalPages}`, { currentPage, totalPages });
});

mup.registerFunction('setSelection', async (p) => {
  if (!pdfDoc) return err('No PDF loaded');
  // Convert PDF points to canvas pixels
  selection = { x: p.x * scale, y: p.y * scale, w: p.w * scale, h: p.h * scale };
  drawSelection();
  broadcastState();
  return ok(`Selection set on page ${currentPage}`, { page: currentPage, rect: selection });
});

mup.registerFunction('clearSelection', async () => {
  selection = null;
  drawSelection();
  broadcastState();
  mup.notifyInteraction('selection-cleared', 'Selection cleared');
  return ok('Selection cleared');
});

mup.registerFunction('captureSelection', async () => {
  if (!selection || !pdfDoc) return err('No selection or no PDF loaded');
  const { x, y, w, h } = selection;
  const absX = Math.min(x, x + w), absY = Math.min(y, y + h);
  const absW = Math.abs(w), absH = Math.abs(h);
  if (absW < 1 || absH < 1) return err('Selection too small');
  const region = document.createElement('canvas');
  region.width = absW; region.height = absH;
  region.getContext('2d').drawImage(pdfCanvas, absX, absY, absW, absH, 0, 0, absW, absH);
  const base64 = region.toDataURL('image/png').split(',')[1];
  return {
    content: [
      { type: 'image', data: base64, mimeType: 'image/png' },
      { type: 'text', text: `Page ${currentPage}, ${Math.round(absW)}x${Math.round(absH)} region` },
    ],
    isError: false,
  };
});

mup.registerFunction('getPageText', async (p) => {
  if (!pdfDoc) return err('No PDF loaded');
  const pageNum = p.page || currentPage;
  const page = await pdfDoc.getPage(pageNum);
  const textContent = await page.getTextContent();
  const text = textContent.items.map(item => item.str).join(' ');
  return ok(`Page ${pageNum} text (${text.length} chars)`, { text, page: pageNum });
});

mup.registerFunction('getContext', async () => {
  return ok('context', {
    pdf: currentPath, page: currentPage, totalPages, scale,
    selection: selection ? { x: selection.x / scale, y: selection.y / scale, w: selection.w / scale, h: selection.h / scale } : null,
  });
});

mup.registerFunction('importFolder', async () => {
  await scanWorkspace();
  return ok(`Rescanned: ${Object.keys(store.docMeta).length} PDF(s)`);
});

// ==== INIT ====

mup.onReady(async ({ theme }) => {
  if (theme === 'dark') document.body.classList.add('dark');
  load(); renderFileTree(); broadcastState();
  // Auto-grant cwd access
  try {
    const cwdResult = await mup.system('getCwd', {});
    if (cwdResult?.content) {
      const cwd = cwdResult.content.endsWith('/') ? cwdResult.content : cwdResult.content + '/';
      await mup.system('grantFileAccess', { paths: [cwd] });
    }
  } catch {}
  await scanWorkspace();
  updateZoom();
});
mup.onThemeChange((theme) => document.body.classList.toggle('dark', theme === 'dark'));
