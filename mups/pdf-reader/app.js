// ---- PDF Reader MUP ----
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
const RENDER_SCALE = 2.5;
let displayScale = 1.0;
let minScale = 0.3;
let selection = null; // { page, x, y, w, h } in canvas pixels
let selectMode = false;
let pageCanvases = []; // array of { canvas, rendered, wrapper }

// ---- Helpers ----
function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function ok(text, data) { const c = [{ type: 'text', text }]; if (data !== undefined) c.push({ type: 'data', data }); return { content: c, isError: false }; }
function err(text) { return { content: [{ type: 'text', text }], isError: true }; }

// ---- Persistence ----
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch {} }
function load() { try { const d = JSON.parse(localStorage.getItem(STORE_KEY)); if (d?._v === 1) store = d; } catch {} }

// ---- State Broadcasting ----
let broadcastTimer = null;
function broadcastState() {
  clearTimeout(broadcastTimer);
  broadcastTimer = setTimeout(() => {
    const parts = [];
    if (currentPath) parts.push(`Viewing "${currentPath.split('/').pop()}" p${currentPage}/${totalPages}`);
    if (selection) parts.push(`Selection on p${selection.page}: ${Math.round(selection.w / RENDER_SCALE)}x${Math.round(selection.h / RENDER_SCALE)}`);
    mup.updateState('PDF: ' + (parts.length ? parts.join('. ') : 'idle') + '.', {
      pdf: currentPath, page: currentPage, totalPages, displayScale, selection: selection ? { page: selection.page, x: selection.x / RENDER_SCALE, y: selection.y / RENDER_SCALE, w: selection.w / RENDER_SCALE, h: selection.h / RENDER_SCALE } : null,
    });
  }, 300);
}

// ==== MULTI-PAGE RENDERING ====

const pdfContainer = document.getElementById('pdfContainer');

async function renderAllPages() {
  if (!pdfDoc) return;
  pdfContainer.innerHTML = '';
  pageCanvases = [];

  for (let i = 1; i <= totalPages; i++) {
    const page = await pdfDoc.getPage(i);
    const viewport = page.getViewport({ scale: RENDER_SCALE });

    const wrapper = document.createElement('div');
    wrapper.className = 'page-wrapper';
    wrapper.dataset.page = i;
    wrapper.style.width = viewport.width + 'px';
    wrapper.style.height = viewport.height + 'px';

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    wrapper.appendChild(canvas);

    // Selection overlay per page
    const overlay = document.createElement('div');
    overlay.className = 'page-overlay';
    if (selectMode) overlay.classList.add('select-mode');
    wrapper.appendChild(overlay);

    pdfContainer.appendChild(wrapper);
    pageCanvases.push({ canvas, rendered: false, wrapper, overlay, viewport });
  }

  applyDisplayScale();
  observePages();
  renderVisiblePages();
}

// Lazy render — only render visible pages ±1 buffer
function renderVisiblePages() {
  const scroller = document.getElementById('pdfScroller');
  const scrollTop = scroller.scrollTop;
  const scrollBottom = scrollTop + scroller.clientHeight;

  for (let i = 0; i < pageCanvases.length; i++) {
    const pc = pageCanvases[i];
    const wrapper = pc.wrapper;
    const top = wrapper.offsetTop * displayScale;
    const bottom = top + wrapper.offsetHeight * displayScale;
    const buffer = scroller.clientHeight; // 1 viewport buffer
    const isNearby = bottom >= scrollTop - buffer && top <= scrollBottom + buffer;

    if (isNearby && !pc.rendered) {
      renderSinglePage(i + 1, pc);
    }
  }
}

async function renderSinglePage(pageNum, pc) {
  if (pc.rendered) return;
  pc.rendered = true;
  const page = await pdfDoc.getPage(pageNum);
  const ctx = pc.canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport: pc.viewport }).promise;
}

// Observe which page is most visible
let pageObserver = null;
function observePages() {
  if (pageObserver) pageObserver.disconnect();
  const visiblePages = new Map();

  pageObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const page = parseInt(entry.target.dataset.page);
      if (entry.isIntersecting) visiblePages.set(page, entry.intersectionRatio);
      else visiblePages.delete(page);
    }
    // Find page with highest visibility
    let maxRatio = 0, maxPage = currentPage;
    for (const [page, ratio] of visiblePages) {
      if (ratio > maxRatio) { maxRatio = ratio; maxPage = page; }
    }
    if (maxPage !== currentPage) {
      currentPage = maxPage;
      document.getElementById('pageInput').value = currentPage;
      broadcastState();
    }
  }, { root: document.getElementById('pdfScroller'), threshold: [0, 0.25, 0.5, 0.75, 1] });

  for (const pc of pageCanvases) pageObserver.observe(pc.wrapper);
}

function applyDisplayScale() {
  pdfContainer.style.transform = `scale(${displayScale})`;
  // Adjust scroller's scroll area
  if (pageCanvases.length > 0) {
    const lastWrapper = pageCanvases[pageCanvases.length - 1].wrapper;
    const totalHeight = (lastWrapper.offsetTop + lastWrapper.offsetHeight);
    const maxWidth = Math.max(...pageCanvases.map(pc => pc.wrapper.offsetWidth));
    pdfContainer.style.width = maxWidth + 'px';
  }
}

// Scroll listener for lazy rendering
document.getElementById('pdfScroller').addEventListener('scroll', () => renderVisiblePages());

// ==== PDF LOADING ====

async function loadPdfFromPath(filePath) {
  if (typeof pdfjsLib === 'undefined') {
    document.getElementById('emptyState').innerHTML = '<div class="empty-icon">!</div><div class="empty-text" style="color:var(--red)">PDF.js failed to load</div>';
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
    document.getElementById('pdfScroller').style.display = '';
    await renderAllPages();
    // Auto-fit width
    const contentWidth = document.getElementById('content').clientWidth - 16;
    if (pageCanvases.length > 0) {
      const pageWidth = pageCanvases[0].wrapper.offsetWidth;
      displayScale = Math.min(1.5, contentWidth / pageWidth);
      minScale = Math.min(contentWidth / pageWidth, document.getElementById('content').clientHeight / pageCanvases[0].wrapper.offsetHeight);
    }
    updateZoom();
    renderFileTree();
    mup.notifyInteraction('pdf-opened', `Opened ${filePath.split('/').pop()} (${totalPages} pages)`, { path: filePath, pages: totalPages });
  } catch (e) {
    const denied = e.message?.includes('Access denied');
    const container = document.getElementById('emptyState');
    container.style.display = '';
    document.getElementById('pdfScroller').style.display = 'none';
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

document.getElementById('prevPage').addEventListener('click', () => { if (currentPage > 1) scrollToPage(currentPage - 1); });
document.getElementById('nextPage').addEventListener('click', () => { if (currentPage < totalPages) scrollToPage(currentPage + 1); });
document.getElementById('pageInput').addEventListener('change', (e) => {
  const p = parseInt(e.target.value);
  if (p >= 1 && p <= totalPages) scrollToPage(p);
});
document.getElementById('pageInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.target.blur(); const p = parseInt(e.target.value); if (p >= 1 && p <= totalPages) scrollToPage(p); }
});

function scrollToPage(pageNum) {
  if (pageNum < 1 || pageNum > pageCanvases.length) return;
  pageCanvases[pageNum - 1].wrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ==== ZOOM ====

document.getElementById('zoomIn').addEventListener('click', () => { displayScale = Math.min(3, displayScale + 0.2); updateZoom(); });
document.getElementById('zoomOut').addEventListener('click', () => { displayScale = Math.max(minScale, displayScale - 0.2); updateZoom(); });
document.getElementById('pdfScroller').addEventListener('wheel', (e) => {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault(); e.stopPropagation();
    const delta = -e.deltaY * 0.01;
    displayScale = Math.max(minScale, Math.min(3, displayScale + delta));
    updateZoom();
  }
}, { passive: false });

function updateZoom() {
  document.getElementById('zoomLevel').textContent = `${Math.round(displayScale * 100)}%`;
  applyDisplayScale();
  renderVisiblePages();
}

// ==== SELECTION TOOL ====

document.getElementById('selectToggle').addEventListener('click', () => {
  selectMode = !selectMode;
  document.getElementById('selectToggle').classList.toggle('active', selectMode);
  document.querySelectorAll('.page-overlay').forEach(o => o.classList.toggle('select-mode', selectMode));
});

let dragging = false;
let dragStart = null;
let dragMode = null;
let dragOffset = null;
let dragPage = null;

pdfContainer.addEventListener('pointerdown', (e) => {
  if (!selectMode) return;
  const wrapper = e.target.closest('.page-wrapper');
  if (!wrapper) return;
  const pageNum = parseInt(wrapper.dataset.page);
  const rect = wrapper.getBoundingClientRect();
  const mx = (e.clientX - rect.left) / displayScale;
  const my = (e.clientY - rect.top) / displayScale;

  if (selection && selection.page === pageNum) {
    const { x, y, w, h } = selection;
    const margin = 10 / displayScale;
    if (Math.abs(mx - x) < margin && Math.abs(my - y) < margin) dragMode = 'resize-nw';
    else if (Math.abs(mx - (x + w)) < margin && Math.abs(my - y) < margin) dragMode = 'resize-ne';
    else if (Math.abs(mx - x) < margin && Math.abs(my - (y + h)) < margin) dragMode = 'resize-sw';
    else if (Math.abs(mx - (x + w)) < margin && Math.abs(my - (y + h)) < margin) dragMode = 'resize-se';
    else if (mx >= x && mx <= x + w && my >= y && my <= y + h) { dragMode = 'move'; dragOffset = { dx: mx - x, dy: my - y }; }
    else { dragMode = 'create'; selection = { page: pageNum, x: mx, y: my, w: 0, h: 0 }; }
  } else {
    dragMode = 'create';
    selection = { page: pageNum, x: mx, y: my, w: 0, h: 0 };
  }

  dragging = true;
  dragStart = { x: mx, y: my };
  dragPage = pageNum;
  e.preventDefault();
});

document.addEventListener('pointermove', (e) => {
  if (!dragging || !selection) return;
  const wrapper = pageCanvases[dragPage - 1]?.wrapper;
  if (!wrapper) return;
  const rect = wrapper.getBoundingClientRect();
  const canvasW = pageCanvases[dragPage - 1].canvas.width;
  const canvasH = pageCanvases[dragPage - 1].canvas.height;
  const mx = Math.max(0, Math.min(canvasW, (e.clientX - rect.left) / displayScale));
  const my = Math.max(0, Math.min(canvasH, (e.clientY - rect.top) / displayScale));

  if (dragMode === 'create') { selection.w = mx - dragStart.x; selection.h = my - dragStart.y; }
  else if (dragMode === 'move') { selection.x = mx - dragOffset.dx; selection.y = my - dragOffset.dy; }
  else if (dragMode === 'resize-se') { selection.w = mx - selection.x; selection.h = my - selection.y; }
  else if (dragMode === 'resize-nw') { selection.w += selection.x - mx; selection.h += selection.y - my; selection.x = mx; selection.y = my; }
  else if (dragMode === 'resize-ne') { selection.w = mx - selection.x; selection.h += selection.y - my; selection.y = my; }
  else if (dragMode === 'resize-sw') { selection.w += selection.x - mx; selection.x = mx; selection.h = my - selection.y; }
  drawSelection();
});

document.addEventListener('pointerup', () => {
  if (!dragging) return;
  dragging = false;
  if (selection) {
    if (selection.w < 0) { selection.x += selection.w; selection.w = -selection.w; }
    if (selection.h < 0) { selection.y += selection.h; selection.h = -selection.h; }
    if (selection.w < 5 && selection.h < 5) selection = null;
    drawSelection();
    if (selection) {
      broadcastState();
      mup.notifyInteraction('selection-changed', `Selection on page ${selection.page}`, { page: selection.page, rect: { x: selection.x / RENDER_SCALE, y: selection.y / RENDER_SCALE, w: selection.w / RENDER_SCALE, h: selection.h / RENDER_SCALE } });
    }
  }
});

function drawSelection() {
  // Clear all selection boxes
  document.querySelectorAll('.selection-box').forEach(el => el.remove());
  if (!selection) return;
  const pc = pageCanvases[selection.page - 1];
  if (!pc) return;
  const { x, y, w, h } = selection;
  const box = document.createElement('div');
  box.className = 'selection-box';
  box.style.left = `${Math.min(x, x + w)}px`;
  box.style.top = `${Math.min(y, y + h)}px`;
  box.style.width = `${Math.abs(w)}px`;
  box.style.height = `${Math.abs(h)}px`;
  box.innerHTML = '<div class="resize-handle nw"></div><div class="resize-handle ne"></div><div class="resize-handle sw"></div><div class="resize-handle se"></div>';
  pc.overlay.appendChild(box);
}

// ==== SIDEBAR ====

document.getElementById('sidebarToggle').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('collapsed'));

const resizer = document.getElementById('sidebarResizer');
let resizing = false;
resizer.addEventListener('mousedown', (e) => { e.preventDefault(); resizing = true; resizer.classList.add('active'); document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'; });
document.addEventListener('mousemove', (e) => { if (!resizing) return; document.getElementById('sidebar').style.width = Math.max(120, Math.min(400, e.clientX - document.getElementById('mainLayout').getBoundingClientRect().left)) + 'px'; });
document.addEventListener('mouseup', () => { if (!resizing) return; resizing = false; resizer.classList.remove('active'); document.body.style.cursor = ''; document.body.style.userSelect = ''; });

// Upload
document.getElementById('uploadBtn').addEventListener('click', () => document.getElementById('fileInput').click());
document.getElementById('fileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';
  const folders = Object.keys(store.folderMeta);
  if (folders.length > 0) {
    try {
      const base64 = await readFileAsBase64(file);
      const savePath = folders[0] + file.name;
      await mup.system('writeFileBase64', { path: savePath, content: base64 });
      store.docMeta[savePath] = {};
      save(); renderFileTree();
      await loadPdfFromPath(savePath);
      mup.notifyInteraction('pdf-uploaded', `Uploaded ${file.name}`, { path: savePath });
    } catch { await loadFromMemory(file); }
  } else { await loadFromMemory(file); }
});

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function loadFromMemory(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    const bytes = new Uint8Array(reader.result);
    pdfDoc = await pdfjsLib.getDocument({ data: bytes }).promise;
    totalPages = pdfDoc.numPages;
    currentPath = null;
    currentPage = 1;
    selection = null;
    document.getElementById('pdfTitle').textContent = file.name + ' (temp)';
    document.getElementById('pageControls').style.display = '';
    document.getElementById('pageTotal').textContent = `/ ${totalPages}`;
    document.getElementById('emptyState').style.display = 'none';
    document.getElementById('pdfScroller').style.display = '';
    await renderAllPages();
    const contentWidth = document.getElementById('content').clientWidth - 16;
    if (pageCanvases.length > 0) displayScale = Math.min(1.5, contentWidth / pageCanvases[0].wrapper.offsetWidth);
    updateZoom();
    broadcastState();
    if (!Object.keys(store.folderMeta).length) {
      document.getElementById('fileTree').innerHTML = `<div style="padding:10px;font-size:11px;color:var(--text-muted);line-height:1.5"><strong>${esc(file.name)}</strong> loaded.<br><br>Tell the LLM which folder to use for PDFs.</div>`;
    }
  };
  reader.readAsArrayBuffer(file);
}

function renderFileTree() {
  const tree = document.getElementById('fileTree');
  const files = Object.keys(store.docMeta).sort();
  if (!files.length) {
    tree.innerHTML = '<div style="padding:12px;font-size:11px;color:var(--text-muted)">No PDFs imported.</div>';
    return;
  }
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

let pendingDel = null;
function confirmDelete(p) { pendingDel = p; document.getElementById('deleteFileName').textContent = p.split('/').pop(); document.getElementById('deleteModal').style.display = 'block'; }
document.getElementById('deleteConfirm').addEventListener('click', () => {
  if (pendingDel) { delete store.docMeta[pendingDel]; if (currentPath === pendingDel) { pdfDoc = null; currentPath = null; document.getElementById('emptyState').style.display = ''; document.getElementById('pdfScroller').style.display = 'none'; document.getElementById('pageControls').style.display = 'none'; } save(); renderFileTree(); broadcastState(); }
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
        for (const f of allFiles) { if (/\.pdf$/i.test(f)) store.docMeta[f] = store.docMeta[f] || {}; }
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
  scrollToPage(p.page);
  return ok(`Page ${p.page}/${totalPages}`, { currentPage: p.page, totalPages });
});

mup.registerFunction('setSelection', async (p) => {
  if (!pdfDoc) return err('No PDF loaded');
  const page = p.page || currentPage;
  selection = { page, x: p.x * RENDER_SCALE, y: p.y * RENDER_SCALE, w: p.w * RENDER_SCALE, h: p.h * RENDER_SCALE };
  // Auto-enable select mode
  selectMode = true;
  document.getElementById('selectToggle').classList.add('active');
  document.querySelectorAll('.page-overlay').forEach(o => o.classList.add('select-mode'));
  drawSelection();
  scrollToPage(page);
  broadcastState();
  return ok(`Selection set on page ${page}`);
});

mup.registerFunction('clearSelection', async () => {
  selection = null;
  drawSelection();
  broadcastState();
  return ok('Selection cleared');
});

mup.registerFunction('captureSelection', async () => {
  if (!selection || !pdfDoc) return err('No selection or no PDF loaded');
  const pc = pageCanvases[selection.page - 1];
  if (!pc) return err('Page not found');
  // Ensure page is rendered
  if (!pc.rendered) await renderSinglePage(selection.page, pc);
  const { x, y, w, h } = selection;
  const absX = Math.min(x, x + w), absY = Math.min(y, y + h);
  const absW = Math.abs(w), absH = Math.abs(h);
  if (absW < 1 || absH < 1) return err('Selection too small');
  const region = document.createElement('canvas');
  region.width = absW; region.height = absH;
  region.getContext('2d').drawImage(pc.canvas, absX, absY, absW, absH, 0, 0, absW, absH);
  const base64 = region.toDataURL('image/png').split(',')[1];
  return { content: [{ type: 'image', data: base64, mimeType: 'image/png' }, { type: 'text', text: `Page ${selection.page}, ${Math.round(absW)}x${Math.round(absH)}` }], isError: false };
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
    pdf: currentPath, page: currentPage, totalPages, displayScale, selectMode,
    selection: selection ? { page: selection.page, x: selection.x / RENDER_SCALE, y: selection.y / RENDER_SCALE, w: selection.w / RENDER_SCALE, h: selection.h / RENDER_SCALE } : null,
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
  try {
    const cwdResult = await mup.system('getCwd', {});
    if (cwdResult?.content) {
      const cwd = cwdResult.content.endsWith('/') ? cwdResult.content : cwdResult.content + '/';
      await mup.system('grantFileAccess', { paths: [cwd] });
    }
  } catch {}
  await scanWorkspace();
});
mup.onThemeChange((theme) => document.body.classList.toggle('dark', theme === 'dark'));
