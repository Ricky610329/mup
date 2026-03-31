// ---- Markdown MUP ----

// ---- State ----
const STORE_KEY = 'mup-kb-data';
let store = { _v: 3, docs: {}, annotations: [] };
let workspacePath = null;
let currentFile = null; // { path, content, lines }
let visibleRange = null;
let selection = null;
let recentFiles = [];
let nextAnnId = 1;
let viewMode = 'split';
let dirty = false;

// ---- Helpers ----
function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function ok(text, data) { const c = [{ type: 'text', text }]; if (data !== undefined) c.push({ type: 'data', data }); return { content: c, isError: false }; }
function err(text) { return { content: [{ type: 'text', text }], isError: true }; }

// ---- Persistence ----
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch {} }
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(STORE_KEY));
    if (d?._v === 3) {
      store = d;
      nextAnnId = store.annotations.reduce((m, a) => Math.max(m, parseInt(a.id?.replace('ann_', '')) || 0), 0) + 1;
    }
    // Reset if old version
  } catch {}
}

// ---- State Broadcasting ----
let broadcastTimer = null;
function broadcastState() {
  clearTimeout(broadcastTimer);
  broadcastTimer = setTimeout(() => {
    const todos = store.annotations.filter(a => a.type === 'todo' && !a.resolved).length;
    const parts = [];
    if (currentFile) parts.push(`Viewing "${currentFile.path.split('/').pop()}"`);
    if (dirty) parts.push('unsaved');
    if (todos) parts.push(`${todos} TODOs`);
    mup.updateState('KB: ' + (parts.length ? parts.join('. ') : 'idle') + '.', {
      currentFile: currentFile?.path || null, visibleRange, selection, recentFiles,
      stats: { docs: Object.keys(store.docs).length, annotations: store.annotations.length, todos },
    });
  }, 300);
}

// ---- Unsaved Indicator ----
function updateUnsaved() {
  const el = document.getElementById('editStatus');
  el.textContent = dirty ? 'unsaved' : '';
  el.style.color = dirty ? 'var(--orange)' : '';
}

// ==== FILE LIST (flat) ====

function renderFileList() {
  const tree = document.getElementById('fileTree');
  const allFiles = Object.keys(store.docs).sort();
  if (!allFiles.length) {
    tree.innerHTML = '<div style="padding:12px;font-size:11px;color:var(--text-muted)">No files yet. Click + to create.</div>';
    return;
  }
  let html = '';
  for (const f of allFiles) {
    html += fileItemHtml(f);
  }
  tree.innerHTML = html;
}

function fileItemHtml(f) {
  const name = f.split('/').pop();
  const active = currentFile?.path === f ? ' active' : '';
  return `<div class="file-item${active}" data-path="${esc(f)}"><span class="file-name">${esc(name)}</span><button class="file-delete" data-del="${esc(f)}" title="Remove">&times;</button></div>`;
}

// ---- File List Events ----
const fileTreeEl = document.getElementById('fileTree');

fileTreeEl.addEventListener('click', (e) => {
  const del = e.target.closest('[data-del]');
  if (del) { e.stopPropagation(); confirmDelete(del.dataset.del); return; }
  const file = e.target.closest('.file-item');
  if (file?.dataset.path) { confirmThenOpen(file.dataset.path); return; }
});

// Confirm before switching if unsaved
function confirmThenOpen(filePath) {
  if (dirty && currentFile) {
    try {
      if (!confirm(`"${currentFile.path.split('/').pop()}" has unsaved changes. Discard?`)) return;
    } catch {}
    dirty = false; updateUnsaved();
  }
  openFile(filePath);
}

// ---- Create New Doc ----
async function createNewDoc(name) {
  if (!workspacePath) return;
  const fileName = name.endsWith('.md') ? name : name + '.md';
  const filePath = workspacePath + fileName;
  const title = fileName.replace(/\.md$/, '').replace(/[-_]/g, ' ');
  try {
    await mup.writeFile(filePath, `# ${title}\n\n`);
    if (!store.docs[filePath]) store.docs[filePath] = {};
    save(); renderFileList();
    await openFile(filePath);
    setViewMode('edit');
    document.getElementById('editor').focus();
    mup.notifyInteraction('doc-created', `Created ${fileName}`, { path: filePath });
  } catch (e) {
    document.getElementById('viewer').innerHTML = `<div style="padding:20px;color:var(--red)">Failed: ${esc(e.message)}</div>`;
  }
}

// ---- Delete Confirm ----
let pendingDeletePath = null;
function confirmDelete(path) {
  pendingDeletePath = path;
  document.getElementById('deleteFileName').textContent = path.split('/').pop();
  document.getElementById('deleteModal').style.display = 'block';
}
document.getElementById('deleteConfirm').addEventListener('click', async () => {
  if (pendingDeletePath) {
    try { await mup.system('deleteFile', { path: pendingDeletePath }); } catch {}
    delete store.docs[pendingDeletePath];
    store.annotations = store.annotations.filter(a => a.filePath !== pendingDeletePath);
    if (currentFile?.path === pendingDeletePath) { currentFile = null; dirty = false; renderContent(); }
    save(); renderFileList(); broadcastState();
  }
  closeDeleteModal();
});
document.getElementById('deleteCancel').addEventListener('click', closeDeleteModal);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && pendingDeletePath) closeDeleteModal(); });
function closeDeleteModal() { pendingDeletePath = null; document.getElementById('deleteModal').style.display = 'none'; }

// ---- Sidebar ----
document.getElementById('sidebarToggleTop').addEventListener('click', () => {
  const sb = document.getElementById('sidebar');
  sb.classList.toggle('collapsed');
  if (!sb.classList.contains('collapsed') && sb.offsetWidth === 0) sb.style.width = '220px';
});

// "+" button to create new file
document.getElementById('newFileBtn').addEventListener('click', () => {
  const name = prompt('New file name:');
  if (name?.trim()) createNewDoc(name.trim());
});

// Upload button — copies file into workspace
document.getElementById('uploadBtn').addEventListener('click', () => {
  document.getElementById('fileInput').click();
});
document.getElementById('fileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file || !workspacePath) return;
  e.target.value = '';
  try {
    const content = await file.text();
    const savePath = workspacePath + file.name;
    await mup.writeFile(savePath, content);
    store.docs[savePath] = {};
    save(); renderFileList();
    await openFile(savePath);
    mup.notifyInteraction('file-uploaded', `Uploaded ${file.name}`, { path: savePath });
  } catch (err) {
    console.error('Upload failed:', err);
  }
});

// Sidebar resize
const resizer = document.getElementById('sidebarResizer');
let resizing = false;
resizer.addEventListener('mousedown', (e) => {
  e.preventDefault(); resizing = true; resizer.classList.add('active');
  document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
});
document.addEventListener('mousemove', (e) => {
  if (!resizing) return;
  const sb = document.getElementById('sidebar');
  const ml = document.getElementById('mainLayout');
  sb.style.width = Math.max(120, Math.min(500, e.clientX - ml.getBoundingClientRect().left)) + 'px';
  sb.classList.remove('collapsed');
});
document.addEventListener('mouseup', () => {
  if (!resizing) return;
  resizing = false; resizer.classList.remove('active');
  document.body.style.cursor = ''; document.body.style.userSelect = '';
});

// ==== CONTENT ====

// View mode
document.querySelector('.view-toggle').addEventListener('click', (e) => { const b = e.target.closest('.vt-btn'); if (b) setViewMode(b.dataset.mode); });

function setViewMode(mode) {
  viewMode = mode;
  document.body.className = document.body.className.replace(/\bmode-\w+/g, '').trim();
  document.body.classList.add('mode-' + mode);
  document.querySelectorAll('.vt-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  document.getElementById('saveBtn').style.display = (mode !== 'preview') && currentFile ? '' : 'none';
  if (mode !== 'edit') updatePreview();
}

function updatePreview() {
  if (!currentFile) return;
  const v = document.getElementById('viewer');
  const src = dirty ? document.getElementById('editor').value : currentFile.content;
  try { marked.setOptions({ breaks: true, gfm: true }); v.innerHTML = marked.parse(src); } catch { v.innerHTML = `<pre>${esc(src)}</pre>`; }
  v.querySelectorAll('a[href^="http"]').forEach(a => { a.target = '_blank'; a.rel = 'noopener'; });
  // Rewrite local image paths to absolute URLs via host
  if (currentFile) {
    const dir = currentFile.path.substring(0, currentFile.path.lastIndexOf('/') + 1);
    v.querySelectorAll('img').forEach(img => {
      const src = img.getAttribute('src');
      if (src) img.src = mup.resolveAssetUrl(src, dir);
    });
  }
  applyAnnotations();
}

function renderContent() {
  const toolbar = document.getElementById('contentToolbar');
  const status = document.getElementById('statusInfo');
  const wrap = document.getElementById('editorWrap');
  const v = document.getElementById('viewer');
  const toggle = document.querySelector('.view-toggle');
  const saveBtn = document.getElementById('saveBtn');

  if (!currentFile) {
    toolbar.style.display = 'none';
    wrap.style.display = 'none';
    document.getElementById('divider').style.display = 'none';
    toggle.style.display = 'none';
    saveBtn.style.display = 'none';
    v.innerHTML = '<div id="emptyState"><div class="empty-icon">Md</div><div class="empty-text">Select a file or create a new one</div></div>';
    v.style.display = '';
    status.textContent = '';
    return;
  }

  toolbar.style.display = '';
  toggle.style.display = '';
  wrap.style.display = '';
  document.getElementById('breadcrumb').textContent = currentFile.path;
  if (!dirty) document.getElementById('editor').value = currentFile.content;
  setViewMode(viewMode);
  updateLineNumbers();

  const annCount = store.annotations.filter(a => a.filePath === currentFile.path).length;
  const lines = dirty ? document.getElementById('editor').value.split('\n').length : currentFile.lines.length;
  const parts = [`${lines} lines`];
  if (annCount) parts.push(`${annCount} annotations`);
  status.textContent = parts.join(' | ');
}

function applyAnnotations() {
  if (!currentFile) return;
  const v = document.getElementById('viewer');
  for (const ann of store.annotations.filter(a => a.filePath === currentFile.path && !a.resolved && a.selectedText)) {
    try {
      const walker = document.createTreeWalker(v, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const idx = node.textContent.indexOf(ann.selectedText);
        if (idx === -1) continue;
        const range = document.createRange();
        range.setStart(node, idx); range.setEnd(node, idx + ann.selectedText.length);
        const mark = document.createElement('span');
        mark.className = 'annotation-mark'; mark.dataset.type = ann.type; mark.title = ann.note || ann.type;
        range.surroundContents(mark);
        break;
      }
    } catch {} // surroundContents can fail on cross-element ranges
  }
}

// ---- File Loading ----
async function openFile(path) {
  try {
    const content = await mup.readFile(path);
    currentFile = { path, content, lines: content.split('\n') };
    dirty = false; updateUnsaved();
    selection = null; visibleRange = null;
    recentFiles = [path, ...recentFiles.filter(p => p !== path)].slice(0, 5);
    if (!store.docs[path]) store.docs[path] = {};
    save(); renderContent(); autoResizeEditor(); renderFileList(); broadcastState();
    mup.notifyInteraction('file-opened', `Opened ${path.split('/').pop()} (${currentFile.lines.length} lines)`, { path, lines: currentFile.lines.length });
  } catch (e) {
    const v = document.getElementById('viewer');
    v.innerHTML = `<div style="padding:20px;color:var(--red)">${esc(e.message)}</div>`;
  }
}

// ---- Editor ----
const editorEl = document.getElementById('editor');
const lineNumEl = document.getElementById('lineNumbers');

// Line numbers — debounced to avoid reflow storm
let lineNumTimer = null;
function updateLineNumbers() {
  clearTimeout(lineNumTimer);
  lineNumTimer = setTimeout(updateLineNumbersNow, 50);
}
function updateLineNumbersNow() {
  const lines = editorEl.value.split('\n');
  const mirror = document.getElementById('editorMirror');
  mirror.style.width = editorEl.clientWidth + 'px';
  let html = '';
  for (let i = 0; i < lines.length; i++) {
    mirror.textContent = lines[i] || ' ';
    html += `<div style="height:${mirror.offsetHeight}px">${i + 1}</div>`;
  }
  lineNumEl.innerHTML = html;
}

new ResizeObserver(() => { if (currentFile) updateLineNumbersNow(); }).observe(document.getElementById('editorWrap'));

function autoResizeEditor() {
  editorEl.style.height = '0';
  editorEl.style.height = editorEl.scrollHeight + 'px';
}

editorEl.addEventListener('input', () => {
  dirty = true; updateUnsaved(); updateLineNumbers(); autoResizeEditor();
  if (viewMode === 'split') updatePreview();
});

editorEl.addEventListener('keydown', (e) => {
  const ctrl = e.ctrlKey || e.metaKey;
  if (e.key === 'Tab') { e.preventDefault(); insertText('  '); return; }
  if (ctrl && e.key === 's') { e.preventDefault(); saveFile(); return; }
  if (ctrl && e.key === 'b') { e.preventDefault(); wrapSelection('**', '**'); return; }
  if (ctrl && e.key === 'i') { e.preventDefault(); wrapSelection('*', '*'); return; }
  if (ctrl && e.key === 'k') { e.preventDefault(); wrapSelection('[', '](url)'); return; }
  if (ctrl && e.key === '`') { e.preventDefault(); wrapSelection('`', '`'); return; }
  if (ctrl && e.shiftKey && e.key === 'K') { e.preventDefault(); wrapSelection('\n```\n', '\n```\n'); return; }
});

function insertText(text) {
  const s = editorEl.selectionStart;
  editorEl.value = editorEl.value.substring(0, s) + text + editorEl.value.substring(editorEl.selectionEnd);
  editorEl.selectionStart = editorEl.selectionEnd = s + text.length;
  dirty = true; updateUnsaved(); updateLineNumbers();
  if (viewMode === 'split') updatePreview();
}

function wrapSelection(before, after) {
  const start = editorEl.selectionStart, end = editorEl.selectionEnd;
  const selected = editorEl.value.substring(start, end) || 'text';
  editorEl.value = editorEl.value.substring(0, start) + before + selected + after + editorEl.value.substring(end);
  editorEl.selectionStart = start + before.length;
  editorEl.selectionEnd = start + before.length + selected.length;
  dirty = true; updateUnsaved(); updateLineNumbers();
  if (viewMode === 'split') updatePreview();
  editorEl.focus();
}

document.getElementById('saveBtn').addEventListener('click', saveFile);

// Cursor position in status bar
editorEl.addEventListener('click', updateCursorPos);
editorEl.addEventListener('keyup', updateCursorPos);
function updateCursorPos() {
  if (!currentFile) return;
  const pos = editorEl.selectionStart;
  const before = editorEl.value.substring(0, pos);
  const line = (before.match(/\n/g) || []).length + 1;
  const col = pos - before.lastIndexOf('\n');
  const totalLines = editorEl.value.split('\n').length;
  document.getElementById('statusInfo').textContent = `Ln ${line}, Col ${col} | ${totalLines} lines`;
}

async function saveFile() {
  if (!currentFile) return;
  currentFile.content = editorEl.value;
  currentFile.lines = currentFile.content.split('\n');
  try {
    await mup.writeFile(currentFile.path, currentFile.content);
    dirty = false; updateUnsaved();
    const el = document.getElementById('editStatus');
    el.textContent = 'saved'; el.style.color = 'var(--green)';
    setTimeout(() => { if (!dirty) { el.textContent = ''; el.style.color = ''; } }, 2000);
    updatePreview();
    mup.notifyInteraction('file-saved', `Saved ${currentFile.path.split('/').pop()}`, { path: currentFile.path });
    broadcastState();
  } catch { document.getElementById('editStatus').textContent = 'save failed!'; }
}

// ---- Link handling ----
document.getElementById('viewer').addEventListener('click', (e) => {
  const link = e.target.closest('a');
  if (!link) return;
  const href = link.getAttribute('href');
  if (!href) return;
  if (/^https?:\/\//.test(href)) {
    e.preventDefault();
    try { window.top.open(href, '_blank'); } catch { window.open(href, '_blank'); }
    return;
  }
  e.preventDefault();
  if (currentFile && /\.(md|mdx|markdown|txt)$/i.test(href)) {
    const dir = currentFile.path.substring(0, currentFile.path.lastIndexOf('/') + 1);
    let resolved = href.startsWith('/') ? href : dir + href;
    const parts = resolved.split('/'), normalized = [];
    for (const p of parts) { if (p === '..') normalized.pop(); else if (p !== '.') normalized.push(p); }
    openFile(normalized.join('/'));
    return;
  }
  if (href.startsWith('#')) {
    const target = document.getElementById(href.substring(1));
    if (target) target.scrollIntoView({ behavior: 'smooth' });
  }
});

// ---- Annotations ----
document.getElementById('viewer').addEventListener('mouseup', () => {
  const sel = window.getSelection();
  const text = sel?.toString().trim();
  const tb = document.getElementById('annotationToolbar');
  if (!text || !currentFile || !sel.rangeCount) { tb.style.display = 'none'; selection = null; return; }
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  const left = Math.max(4, Math.min(window.innerWidth - 150, rect.left + rect.width / 2 - 70));
  const top = Math.max(4, rect.top - 34);
  tb.style.display = 'flex'; tb.style.left = left + 'px'; tb.style.top = top + 'px';
  const beforeText = currentFile.content.substring(0, currentFile.content.indexOf(text));
  const lineStart = currentFile.content.indexOf(text) === -1 ? 1 : (beforeText.match(/\n/g) || []).length + 1;
  selection = { text, lineStart, lineEnd: lineStart + (text.match(/\n/g) || []).length };
  broadcastState();
  mup.notifyInteraction('text-selected', `Selected "${text.slice(0, 60)}"`, { path: currentFile.path, text, lineStart: selection.lineStart });
});

let pendingAnnType = null;
document.getElementById('annotationToolbar').addEventListener('click', (e) => {
  const btn = e.target.closest('button'); if (!btn || !selection || !currentFile) return;
  const type = btn.dataset.type;
  if (type === 'highlight') { addAnnotation(type, ''); }
  else {
    pendingAnnType = type;
    const modal = document.getElementById('noteModal');
    const tb = document.getElementById('annotationToolbar');
    const left = Math.max(4, parseInt(tb.style.left));
    const top = Math.max(4, parseInt(tb.style.top) - 40);
    modal.style.display = 'flex'; modal.style.left = left + 'px'; modal.style.top = top + 'px';
    document.getElementById('noteInput').value = ''; document.getElementById('noteInput').focus();
  }
  document.getElementById('annotationToolbar').style.display = 'none';
});
document.getElementById('noteSave').addEventListener('click', () => { if (pendingAnnType && selection) addAnnotation(pendingAnnType, document.getElementById('noteInput').value.trim()); document.getElementById('noteModal').style.display = 'none'; pendingAnnType = null; });
document.getElementById('noteCancel').addEventListener('click', () => { document.getElementById('noteModal').style.display = 'none'; pendingAnnType = null; });

function addAnnotation(type, note) {
  if (!selection || !currentFile) return;
  const ann = { id: `ann_${nextAnnId++}`, filePath: currentFile.path, type, lineStart: selection.lineStart, lineEnd: selection.lineEnd, selectedText: selection.text, note, resolved: false, createdAt: Date.now(), updatedAt: Date.now() };
  store.annotations.push(ann); save(); updatePreview(); broadcastState();
  mup.notifyInteraction('annotation-created', `Marked :${ann.lineStart} as ${type}`, { annotation: ann });
}

// Scroll tracking
let scrollTimer = null;
document.getElementById('viewer').addEventListener('scroll', () => {
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    if (!currentFile) return;
    const v = document.getElementById('viewer');
    const ratio = v.scrollTop / Math.max(1, v.scrollHeight - v.clientHeight);
    const total = currentFile.lines.length;
    const start = Math.max(1, Math.round(ratio * total));
    visibleRange = { start, end: Math.min(total, start + Math.round((v.clientHeight / v.scrollHeight) * total)) };
    broadcastState();
  }, 500);
});

// ---- Heading Parser ----
function parseHeadings(content) {
  const lines = content.split('\n'), h = [];
  for (let i = 0; i < lines.length; i++) { const m = lines[i].match(/^(#{1,6})\s+(.+)/); if (m) h.push({ level: m[1].length, text: m[2].trim(), line: i + 1 }); }
  for (let i = 0; i < h.length; i++) h[i].endLine = (i + 1 < h.length) ? h[i + 1].line - 1 : lines.length;
  return h;
}

// ---- Search (simplified) ----
function searchMetadata(query) {
  const q = query.toLowerCase(), r = [];
  // Search file names
  for (const p of Object.keys(store.docs)) {
    const name = p.split('/').pop().toLowerCase();
    if (name.includes(q)) r.push({ type: 'file', path: p, match: name });
  }
  // Search annotations
  for (const a of store.annotations) {
    if (a.note?.toLowerCase().includes(q) || a.selectedText?.toLowerCase().includes(q))
      r.push({ type: 'annotation', path: a.filePath, match: a.note || a.selectedText });
  }
  return r;
}

// ==== MUP FUNCTIONS ====

mup.registerFunction('annotate', async (p) => {
  if (p.subAction === 'create') {
    if (!p.filePath || !p.type) return err('filePath+type required');
    const ann = { id: `ann_${nextAnnId++}`, filePath: p.filePath, type: p.type, lineStart: p.lineStart || 0, lineEnd: p.lineEnd || 0, selectedText: p.selectedText || '', note: p.note || '', resolved: false, createdAt: Date.now(), updatedAt: Date.now() };
    store.annotations.push(ann); save();
    if (currentFile?.path === ann.filePath) updatePreview();
    broadcastState();
    return ok(`Created ${ann.id}`);
  }
  if (p.subAction === 'update') {
    const a = store.annotations.find(x => x.id === p.id);
    if (!a) return err('Not found');
    if (p.note !== undefined) a.note = p.note;
    if (p.type) a.type = p.type;
    a.updatedAt = Date.now();
    save(); if (currentFile?.path === a.filePath) updatePreview(); broadcastState();
    return ok('Updated');
  }
  if (p.subAction === 'resolve') {
    const a = store.annotations.find(x => x.id === p.id);
    if (!a) return err('Not found');
    a.resolved = true; a.updatedAt = Date.now();
    save(); updatePreview(); broadcastState();
    return ok(`Resolved ${p.id}`);
  }
  if (p.subAction === 'delete') {
    const i = store.annotations.findIndex(x => x.id === p.id);
    if (i < 0) return err('Not found');
    store.annotations.splice(i, 1);
    save(); updatePreview(); broadcastState();
    return ok('Deleted');
  }
  if (p.subAction === 'list') {
    let a = store.annotations;
    if (p.filePath) a = a.filter(x => x.filePath === p.filePath);
    return ok(`${a.length} annotation(s)`, a);
  }
  return err('Unknown subAction');
});

mup.registerFunction('getOutline', async (p) => {
  if (!p.path) return err('path required');
  let c;
  if (currentFile?.path === p.path) c = currentFile.content;
  else { try { c = await mup.readFile(p.path); } catch (e) { return err(e.message); } }
  return ok(`${parseHeadings(c).length} headings`, { headings: parseHeadings(c), totalLines: c.split('\n').length, annotations: store.annotations.filter(a => a.filePath === p.path && !a.resolved) });
});

mup.registerFunction('getSection', async (p) => {
  if (!currentFile) return err('No file loaded');
  let s, e;
  if (p.heading) {
    const h = parseHeadings(currentFile.content).find(h => h.text.toLowerCase().includes(p.heading.toLowerCase().replace(/^#+\s*/, '')));
    if (!h) return err('Not found');
    s = h.line; e = h.endLine;
  } else { s = p.lineStart; e = p.lineEnd; }
  if (!s || !e) return err('Provide heading or lineStart+lineEnd');
  const sec = currentFile.lines.slice(s - 1, e).join('\n');
  const truncated = sec.length > 6000;
  return ok(`L${s}-${e}`, { content: truncated ? sec.slice(0, 6000) : sec, truncated, lines: `${s}-${e}` });
});

mup.registerFunction('search', async (p) => {
  if (!p.query) return err('query required');
  const r = searchMetadata(p.query);
  return ok(`${r.length} result(s)`, r.slice(0, 20));
});

mup.registerFunction('loadFile', async (p) => {
  if (!p.path) return err('path required');
  await openFile(p.path);
  return currentFile ? ok(`Loaded ${p.path.split('/').pop()} (${currentFile.lines.length} lines)`) : err('Failed');
});

mup.registerFunction('getContext', async () => {
  return ok('context', {
    workspacePath,
    currentFile: currentFile?.path, lines: currentFile?.lines.length,
    visibleRange, selection, recentFiles,
    annotations: currentFile ? store.annotations.filter(a => a.filePath === currentFile.path && !a.resolved).slice(0, 10) : [],
  });
});

mup.registerFunction('importFolder', async () => {
  await scanWorkspace();
  return ok(`Rescanned workspace: ${Object.keys(store.docs).length} file(s)`);
});

mup.registerFunction('createDoc', async (p) => {
  const name = p.name || (p.path ? p.path.split('/').pop() : null);
  if (!name) return err('name or path required');
  const fileName = name.endsWith('.md') ? name : name + '.md';
  const filePath = p.path || (workspacePath ? workspacePath + fileName : null);
  if (!filePath) return err('workspacePath not set');
  const t = fileName.replace(/\.md$/, '').replace(/[-_]/g, ' ');
  const c = p.content || `# ${t}\n\n`;
  try { await mup.writeFile(filePath, c); } catch (e) { return err(e.message); }
  if (!store.docs[filePath]) store.docs[filePath] = {};
  save(); renderFileList(); broadcastState();
  mup.emitEvent('doc-created', { path: filePath });
  return ok(`Created ${fileName}`);
});

mup.registerFunction('updateDoc', async (p) => {
  if (!p.path || p.content === undefined) return err('path+content required');
  try { await mup.writeFile(p.path, p.content); } catch (e) { return err(e.message); }
  if (!store.docs[p.path]) store.docs[p.path] = {};
  if (currentFile?.path === p.path) { currentFile.content = p.content; currentFile.lines = p.content.split('\n'); dirty = false; updateUnsaved(); renderContent(); }
  broadcastState();
  return ok(`Updated ${p.path.split('/').pop()}`);
});

mup.registerFunction('appendToDoc', async (p) => {
  if (!p.path || !p.content) return err('path+content required');
  let ex; try { ex = await mup.readFile(p.path); } catch { ex = ''; }
  const nc = ex + (ex.endsWith('\n') ? '' : '\n') + p.content;
  try { await mup.writeFile(p.path, nc); } catch (e) { return err(e.message); }
  if (!store.docs[p.path]) store.docs[p.path] = {};
  if (currentFile?.path === p.path) { currentFile.content = nc; currentFile.lines = nc.split('\n'); dirty = false; updateUnsaved(); renderContent(); }
  broadcastState();
  return ok(`Appended to ${p.path.split('/').pop()}`);
});

// ==== INIT ====

async function scanWorkspace() {
  try {
    const ws = await mup.registerWorkspace({ fileTypes: ['.md', '.mdx', '.txt', '.markdown'], dedicated: true });
    workspacePath = ws.workspacePath;
    // Rebuild file list from workspace scan
    store.docs = {};
    for (const f of ws.files) {
      store.docs[f] = store.docs[f] || {};
    }
    save(); renderFileList(); broadcastState();
  } catch (e) { console.error('Workspace scan failed:', e); }
}

mup.onReady(async ({ theme }) => {
  if (theme === 'dark') document.body.classList.add('dark');
  load(); setViewMode('split'); renderContent();
  await scanWorkspace();
  renderFileList(); broadcastState();
});
mup.onThemeChange((theme) => document.body.classList.toggle('dark', theme === 'dark'));
