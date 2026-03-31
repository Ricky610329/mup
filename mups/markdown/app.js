// ---- Markdown MUP ----

// ---- State ----
const STORE_KEY = 'mup-kb-data';
let store = { _v: 2, folderMeta: {}, docMeta: {}, collections: {}, annotations: [], pins: [] };
let currentFile = null; // { path, content, lines }
let visibleRange = null;
let selection = null;
let recentFiles = [];
let nextAnnId = 1;
let nextCollId = 1;
let viewMode = 'split';
let dirty = false;
let renaming = false;

// ---- Helpers ----
function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function ok(text, data) { const c = [{ type: 'text', text }]; if (data !== undefined) c.push({ type: 'data', data }); return { content: c, isError: false }; }
function err(text) { return { content: [{ type: 'text', text }], isError: true }; }

// ---- Persistence ----
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch {} }
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(STORE_KEY));
    if (d?._v === 2) {
      store = d;
      nextAnnId = store.annotations.reduce((m, a) => Math.max(m, parseInt(a.id?.replace('ann_', '')) || 0), 0) + 1;
      nextCollId = Object.keys(store.collections).reduce((m, k) => Math.max(m, parseInt(k.replace('coll_', '')) || 0), 0) + 1;
    }
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
      stats: { docs: Object.keys(store.docMeta).length, folders: Object.keys(store.folderMeta).length, annotations: store.annotations.length, todos },
    });
  }, 300);
}

// ---- Unsaved Indicator ----
function updateUnsaved() {
  const el = document.getElementById('editStatus');
  el.textContent = dirty ? 'unsaved' : '';
  el.style.color = dirty ? 'var(--orange)' : '';
}

// ---- Root Path ----
function getRootPath() {
  const folders = Object.keys(store.folderMeta);
  if (folders.length) return folders[0];
  const files = Object.keys(store.docMeta);
  if (files.length) return files[0].substring(0, files[0].lastIndexOf('/') + 1);
  return null;
}

// ==== FILE TREE (nested hierarchy) ====

function renderFileTree() {
  if (renaming) return;
  const tree = document.getElementById('fileTree');
  const allFolders = Object.keys(store.folderMeta).sort();
  const allFiles = Object.keys(store.docMeta).sort();
  if (!allFolders.length && !allFiles.length) {
    tree.innerHTML = '<div style="padding:12px;font-size:11px;color:var(--text-muted)">No files yet. Click + to create.</div>';
    return;
  }
  const allPaths = [...allFolders, ...allFiles];
  const root = findCommonRoot(allPaths);
  const treeRoot = { name: root.split('/').filter(Boolean).pop() || '/', path: root, type: 'folder', children: [] };
  for (const f of allFolders) insertNode(treeRoot, root, f, 'folder');
  for (const f of allFiles) insertNode(treeRoot, root, f, 'file');
  tree.innerHTML = renderNode(treeRoot, true);
}

function findCommonRoot(paths) {
  if (!paths.length) return '/';
  const parts = paths[0].split('/');
  let common = '';
  for (let i = 0; i < parts.length; i++) {
    const prefix = parts.slice(0, i + 1).join('/') + '/';
    if (paths.every(p => p.startsWith(prefix))) common = prefix;
    else break;
  }
  return common || '/';
}

function insertNode(root, rootPath, fullPath, type) {
  let rel = fullPath.startsWith(rootPath) ? fullPath.substring(rootPath.length) : fullPath;
  if (type === 'folder') rel = rel.replace(/\/$/, '');
  const segments = rel.split('/').filter(Boolean);
  if (!segments.length) return;
  let current = root;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const isLast = i === segments.length - 1;
    if (isLast && type === 'file') {
      if (!current.children.find(c => c.path === fullPath)) current.children.push({ name: seg, path: fullPath, type: 'file', children: [] });
    } else {
      const folderPath = rootPath + segments.slice(0, i + 1).join('/') + '/';
      let folder = current.children.find(c => c.type === 'folder' && c.path === folderPath);
      if (!folder) { folder = { name: seg, path: folderPath, type: 'folder', children: [] }; current.children.push(folder); }
      current = folder;
    }
  }
}

function renderNode(node, isRoot) {
  node.children.sort((a, b) => a.type !== b.type ? (a.type === 'folder' ? -1 : 1) : a.name.localeCompare(b.name));
  if (node.type === 'file') return fileItemHtml(node.path);
  const meta = store.folderMeta[node.path] || {};
  const tip = meta.description ? ` title="${esc(meta.description)}"` : '';
  let html = `<div class="folder-item" data-folder="${esc(node.path)}"${tip}>`;
  html += `<svg class="folder-arrow expanded" viewBox="0 0 12 12"><path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;
  html += `<span class="folder-name">${esc(node.name)}</span>`;
  html += `<span class="folder-actions">`;
  html += `<button data-new-in="${esc(node.path)}" title="New file"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>`;
  html += `<button data-new-folder-in="${esc(node.path)}" title="New folder"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg></button>`;
  html += `</span></div>`;
  html += `<div class="folder-children" data-folder-children="${esc(node.path)}">`;
  for (const child of node.children) html += renderNode(child, false);
  html += '</div>';
  return html;
}

function fileItemHtml(f) {
  const name = f.split('/').pop();
  const dm = store.docMeta[f] || {};
  const dot = dm.status === 'needs-update' ? '<span class="dot dot-orange"></span>' : dm.priority === 'high' ? '<span class="dot dot-red"></span>' : '';
  const active = currentFile?.path === f ? ' active' : '';
  const isMd = /\.(md|mdx|txt|markdown)$/i.test(f);
  return `<div class="file-item${active}" data-path="${esc(f)}" draggable="true"${isMd ? '' : ' style="opacity:0.5"'}>${dot}<span class="file-name">${esc(name)}</span><button class="file-delete" data-del="${esc(f)}" title="Remove">&times;</button></div>`;
}

// ---- File Tree Events ----
const fileTreeEl = document.getElementById('fileTree');

fileTreeEl.addEventListener('click', (e) => {
  if (renaming) return;
  const del = e.target.closest('[data-del]');
  if (del) { e.stopPropagation(); confirmDelete(del.dataset.del); return; }
  const newIn = e.target.closest('[data-new-in]');
  if (newIn) { e.stopPropagation(); showInlineInput(newIn.dataset.newIn, 'file'); return; }
  const newFolder = e.target.closest('[data-new-folder-in]');
  if (newFolder) { e.stopPropagation(); showInlineInput(newFolder.dataset.newFolderIn, 'folder'); return; }
  const file = e.target.closest('.file-item');
  if (file?.dataset.path) { confirmThenOpen(file.dataset.path); return; }
  const folder = e.target.closest('.folder-item');
  if (folder?.dataset.folder) {
    const ch = document.querySelector(`[data-folder-children="${CSS.escape(folder.dataset.folder)}"]`);
    if (ch) { ch.classList.toggle('collapsed'); folder.querySelector('.folder-arrow')?.classList.toggle('expanded'); }
  }
});

// Confirm before switching if unsaved
function confirmThenOpen(filePath) {
  if (dirty && currentFile) {
    // confirm() may be blocked in sandboxed iframe — try, fallback to open anyway
    try {
      if (!confirm(`"${currentFile.path.split('/').pop()}" has unsaved changes. Discard?`)) return;
    } catch {}
    dirty = false; updateUnsaved();
  }
  openFile(filePath);
}

// ---- Rename (double-click) ----
fileTreeEl.addEventListener('dblclick', (e) => {
  const item = e.target.closest('.file-item');
  if (!item?.dataset.path) return;
  e.preventDefault(); e.stopPropagation();
  renaming = true;
  const filePath = item.dataset.path;
  const nameEl = item.querySelector('.file-name');
  if (!nameEl) { renaming = false; return; }
  const oldName = filePath.split('/').pop();
  nameEl.style.display = 'none';
  const input = document.createElement('input');
  input.type = 'text'; input.value = oldName; input.className = 'rename-input';
  nameEl.parentNode.insertBefore(input, nameEl.nextSibling);
  input.focus();
  const dotIdx = oldName.lastIndexOf('.');
  input.setSelectionRange(0, dotIdx > 0 ? dotIdx : oldName.length);

  let done = false;
  const finish = async (doRename) => {
    if (done) return;
    done = true; renaming = false;
    const newName = doRename ? input.value.trim() : null;
    if (newName && newName !== oldName) {
      const dir = filePath.substring(0, filePath.lastIndexOf('/') + 1);
      const newPath = dir + newName;
      // Rename on disk via writeFile (copy content, can't truly rename but moves metadata)
      try {
        const content = await mup.readFile(filePath);
        await mup.writeFile(newPath, content);
        // Update metadata
        const meta = store.docMeta[filePath]; delete store.docMeta[filePath]; store.docMeta[newPath] = meta || {};
        store.annotations.forEach(a => { if (a.filePath === filePath) a.filePath = newPath; });
        store.pins = store.pins.map(p => p === filePath ? newPath : p);
        if (currentFile?.path === filePath) { currentFile.path = newPath; document.getElementById('breadcrumb').textContent = newPath; }
        save(); broadcastState();
        mup.notifyInteraction('file-renamed', `Renamed ${oldName} → ${newName}`, { from: filePath, to: newPath });
      } catch (e) { console.error('Rename failed:', e); }
    }
    renderFileTree();
  };
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') finish(true); if (ev.key === 'Escape') finish(false); });
  input.addEventListener('blur', () => setTimeout(() => finish(true), 150));
});

// ---- Drag & Drop ----
let dragPath = null;
fileTreeEl.addEventListener('dragstart', (e) => { const i = e.target.closest('.file-item'); if (i) { dragPath = i.dataset.path; i.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; } });
fileTreeEl.addEventListener('dragend', () => { document.querySelectorAll('.dragging,.drag-over').forEach(el => el.classList.remove('dragging', 'drag-over')); dragPath = null; });
fileTreeEl.addEventListener('dragover', (e) => { if (!dragPath) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over')); e.target.closest('.folder-item')?.classList.add('drag-over'); });
fileTreeEl.addEventListener('dragleave', (e) => { const f = e.target.closest('.folder-item'); if (f && !f.contains(e.relatedTarget)) f.classList.remove('drag-over'); });
fileTreeEl.addEventListener('drop', async (e) => {
  e.preventDefault(); document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  if (!dragPath) return;
  const folder = e.target.closest('.folder-item');
  if (!folder) return;
  const target = folder.dataset.folder;
  const name = dragPath.split('/').pop();
  const newPath = target + (target.endsWith('/') ? '' : '/') + name;
  if (newPath === dragPath) return;
  // Move on disk
  try {
    const content = await mup.readFile(dragPath);
    await mup.writeFile(newPath, content);
    const meta = store.docMeta[dragPath]; delete store.docMeta[dragPath]; store.docMeta[newPath] = meta || {};
    store.annotations.forEach(a => { if (a.filePath === dragPath) a.filePath = newPath; });
    store.pins = store.pins.map(p => p === dragPath ? newPath : p);
    if (currentFile?.path === dragPath) currentFile.path = newPath;
    save(); renderFileTree(); broadcastState();
    mup.notifyInteraction('file-moved', `Moved ${name} → ${target.split('/').pop()}`, { from: dragPath, to: newPath });
  } catch (er) { console.error('Move failed:', er); }
  dragPath = null;
});

// ---- Inline Input (new file / new folder) ----
function showInlineInput(parentFolder, type) {
  const container = document.querySelector(`[data-folder-children="${CSS.escape(parentFolder)}"]`);
  if (!container) return;
  container.classList.remove('collapsed');
  document.querySelector(`.folder-item[data-folder="${CSS.escape(parentFolder)}"]`)?.querySelector('.folder-arrow')?.classList.add('expanded');
  container.querySelectorAll('.inline-new-input').forEach(el => el.remove());
  const w = document.createElement('div'); w.className = 'inline-new-input';
  w.innerHTML = `<input type="text" placeholder="${type === 'folder' ? 'folder name' : 'filename (.md auto)'}">`;
  container.prepend(w);
  const input = w.querySelector('input'); input.focus();
  let done = false;
  const commit = async () => {
    if (done) return; done = true;
    const name = input.value.trim(); w.remove();
    if (!name) return;
    if (type === 'folder') {
      const p = parentFolder + (parentFolder.endsWith('/') ? '' : '/') + name + '/';
      if (!store.folderMeta[p]) store.folderMeta[p] = { description: '', role: '', tags: [] };
      save(); renderFileTree(); broadcastState();
      mup.notifyInteraction('folder-created', `Created ${name}/`, { path: p });
    } else {
      await createNewDoc(name, parentFolder);
    }
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { done = true; w.remove(); } });
  input.addEventListener('blur', () => setTimeout(() => { if (!done) { done = true; w.remove(); } }, 200));
}

async function createNewDoc(name, folder) {
  const fileName = name.endsWith('.md') ? name : name + '.md';
  const filePath = folder + (folder.endsWith('/') ? '' : '/') + fileName;
  const title = fileName.replace(/\.md$/, '').replace(/[-_]/g, ' ');
  try {
    await mup.writeFile(filePath, `# ${title}\n\n`);
    if (!store.docMeta[filePath]) store.docMeta[filePath] = {};
    save(); renderFileTree();
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
    delete store.docMeta[pendingDeletePath];
    store.pins = store.pins.filter(p => p !== pendingDeletePath);
    store.annotations = store.annotations.filter(a => a.filePath !== pendingDeletePath);
    if (currentFile?.path === pendingDeletePath) { currentFile = null; dirty = false; renderContent(); }
    save(); renderFileTree(); broadcastState();
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
  const dm = store.docMeta[currentFile.path] || {};
  if (dm.status && dm.status !== 'current') parts.push(dm.status);
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
    if (!store.docMeta[path]) store.docMeta[path] = {};
    store.docMeta[path].lastViewedAt = Date.now();
    store.docMeta[path].viewCount = (store.docMeta[path].viewCount || 0) + 1;
    save(); renderContent(); autoResizeEditor(); renderFileTree(); broadcastState();
    mup.notifyInteraction('file-opened', `Opened ${path.split('/').pop()} (${currentFile.lines.length} lines)`, { path, lines: currentFile.lines.length });
  } catch (err) {
    const denied = err.message?.includes('Access denied');
    const folder = path.substring(0, path.lastIndexOf('/') + 1);
    const folderName = folder.split('/').filter(Boolean).pop() || folder;
    const v = document.getElementById('viewer');
    if (denied) {
      v.innerHTML = `<div style="padding:32px;text-align:center;color:var(--text-muted)"><div style="font-size:13px;margin-bottom:12px">This folder requires access permission</div><button id="grantAccessBtn" style="padding:6px 16px;border:1px solid var(--accent);border-radius:5px;background:transparent;color:var(--accent);cursor:pointer;font-size:12px;font-weight:500">Grant Access to ${esc(folderName)}/</button></div>`;
      document.getElementById('grantAccessBtn').addEventListener('click', async () => {
        try { await mup.system('grantFileAccess', { paths: [folder] }); await openFile(path); } catch (e) { v.innerHTML = `<div style="padding:20px;color:var(--red)">${esc(e.message)}</div>`; }
      });
    } else {
      v.innerHTML = `<div style="padding:20px;color:var(--red)">${esc(err.message)}</div>`;
    }
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

// ---- Search (LLM only) ----
function searchMetadata(query, type) {
  const q = query.toLowerCase(), r = [];
  if (type === 'all' || type === 'folders')
    for (const [p, m] of Object.entries(store.folderMeta)) if (m.description?.toLowerCase().includes(q) || (m.tags || []).some(t => t.includes(q))) r.push({ type: 'folder', path: p, match: m.description });
  if (type === 'all' || type === 'tags')
    for (const [p, m] of Object.entries(store.docMeta)) if ((m.tags || []).some(t => t.includes(q))) r.push({ type: 'tag', path: p, match: (m.tags || []).join(', ') });
  if (type === 'all' || type === 'annotations')
    for (const a of store.annotations) if (a.note?.toLowerCase().includes(q) || a.selectedText?.toLowerCase().includes(q)) r.push({ type: 'annotation', path: a.filePath, match: a.note || a.selectedText });
  if (type === 'all' || type === 'collections')
    for (const [id, c] of Object.entries(store.collections)) if (c.name?.toLowerCase().includes(q) || c.description?.toLowerCase().includes(q)) r.push({ type: 'collection', id, match: c.description || c.name });
  return r;
}

// ==== MUP FUNCTIONS ====

mup.registerFunction('describeFolders', async (p) => {
  if (!p.folders) return ok(`${Object.keys(store.folderMeta).length} folder(s)`, Object.entries(store.folderMeta).map(([k, v]) => ({ path: k, ...v })));
  for (const f of p.folders) store.folderMeta[f.path] = { description: f.description, role: f.role || '', tags: f.tags || [] };
  save(); renderFileTree(); broadcastState();
  return ok(`Described ${p.folders.length} folder(s)`);
});

mup.registerFunction('manageTags', async (p) => {
  const { subAction, path, tags } = p;
  if (subAction === 'add') {
    if (!path || !tags) return err('path+tags required');
    if (!store.docMeta[path]) store.docMeta[path] = {};
    const s = new Set(store.docMeta[path].tags || []);
    for (const t of tags) s.add(t);
    store.docMeta[path].tags = [...s];
    save(); broadcastState();
    return ok('Tags added');
  }
  if (subAction === 'remove') {
    if (!path || !tags) return err('path+tags required');
    if (store.docMeta[path]) store.docMeta[path].tags = (store.docMeta[path].tags || []).filter(t => !tags.includes(t));
    save(); broadcastState();
    return ok('Tags removed');
  }
  if (subAction === 'list') {
    const tc = {};
    for (const dm of Object.values(store.docMeta)) for (const t of (dm.tags || [])) tc[t] = (tc[t] || 0) + 1;
    return ok(`${Object.keys(tc).length} tag(s)`, tc);
  }
  if (subAction === 'search') {
    if (!tags) return err('tags required');
    const m = Object.entries(store.docMeta).filter(([, m]) => tags.some(t => (m.tags || []).includes(t))).map(([p, m]) => ({ path: p, tags: m.tags }));
    return ok(`${m.length} doc(s)`, m);
  }
  return err('Unknown subAction');
});

mup.registerFunction('manageCollections', async (p) => {
  if (p.subAction === 'create') {
    if (!p.name) return err('name required');
    const id = `coll_${nextCollId++}`;
    store.collections[id] = { name: p.name, description: p.description || '', tags: p.tags || [], paths: [], createdAt: Date.now() };
    save(); broadcastState();
    return ok(`Created ${id}`);
  }
  if (p.subAction === 'update') {
    const c = store.collections[p.id];
    if (!c) return err('Not found');
    if (p.name) c.name = p.name;
    if (p.description) c.description = p.description;
    if (p.tags) c.tags = p.tags;
    save(); broadcastState();
    return ok('Updated');
  }
  if (p.subAction === 'delete') { delete store.collections[p.id]; save(); broadcastState(); return ok('Deleted'); }
  if (p.subAction === 'list') { return ok(`${Object.keys(store.collections).length}`, Object.entries(store.collections).map(([id, c]) => ({ id, ...c }))); }
  if (p.subAction === 'addDoc') {
    const c = store.collections[p.id];
    if (!c) return err('Not found');
    if (p.path && !c.paths.includes(p.path)) c.paths.push(p.path);
    save();
    return ok('Added');
  }
  if (p.subAction === 'removeDoc') {
    const c = store.collections[p.id];
    if (!c) return err('Not found');
    if (p.path) c.paths = c.paths.filter(x => x !== p.path);
    save();
    return ok('Removed');
  }
  return err('Unknown subAction');
});

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

mup.registerFunction('setDocStatus', async (p) => {
  if (!p.path) return err('path required');
  if (!store.docMeta[p.path]) store.docMeta[p.path] = {};
  const d = store.docMeta[p.path];
  if (p.priority) d.priority = p.priority;
  if (p.status) d.status = p.status;
  if (p.notes !== undefined) d.notes = p.notes;
  save(); renderFileTree(); broadcastState();
  return ok(`${p.path.split('/').pop()}: ${[p.status, p.priority].filter(Boolean).join(' ')}`);
});

mup.registerFunction('managePins', async (p) => {
  if (p.subAction === 'pin' && p.path && !store.pins.includes(p.path)) store.pins.push(p.path);
  else if (p.subAction === 'unpin' && p.path) store.pins = store.pins.filter(x => x !== p.path);
  else if (p.subAction === 'list') return ok(`${store.pins.length} pinned`, store.pins);
  else if (p.subAction === 'reorder' && p.order) store.pins = p.order;
  save(); broadcastState();
  return ok('OK');
});

mup.registerFunction('getKBMap', async (p) => {
  const s = p.scope || 'full', d = {};
  if (s === 'full' || s === 'folders') d.folders = store.folderMeta;
  if (s === 'full' || s === 'pins') d.pins = store.pins;
  if (s === 'full' || s === 'collections') d.collections = store.collections;
  if (s === 'full' || s === 'annotations') {
    d.annotations = { total: store.annotations.length, unresolved: store.annotations.filter(a => !a.resolved).length, byType: {} };
    for (const a of store.annotations) d.annotations.byType[a.type] = (d.annotations.byType[a.type] || 0) + 1;
  }
  if (s === 'full') {
    d.docs = {};
    for (const [k, m] of Object.entries(store.docMeta)) d.docs[k] = { tags: m.tags, status: m.status, priority: m.priority };
  }
  return ok(`KB: ${Object.keys(store.folderMeta).length} folders, ${Object.keys(store.docMeta).length} docs`, d);
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
  const r = searchMetadata(p.query, p.type || 'all');
  return ok(`${r.length} result(s)`, r.slice(0, 20));
});

mup.registerFunction('loadFile', async (p) => {
  if (!p.path) return err('path required');
  await openFile(p.path);
  return currentFile ? ok(`Loaded ${p.path.split('/').pop()} (${currentFile.lines.length} lines)`) : err('Failed');
});

mup.registerFunction('getContext', async () => {
  return ok('context', {
    currentFile: currentFile?.path, lines: currentFile?.lines.length,
    visibleRange, selection, recentFiles,
    annotations: currentFile ? store.annotations.filter(a => a.filePath === currentFile.path && !a.resolved).slice(0, 10) : [],
  });
});

mup.registerFunction('importFolder', async () => {
  await scanWorkspace();
  return ok(`Rescanned workspace: ${Object.keys(store.docMeta).length} file(s)`);
});

mup.registerFunction('createDoc', async (p) => {
  if (!p.path) return err('path required');
  const t = p.path.split('/').pop().replace(/\.md$/, '').replace(/[-_]/g, ' ');
  const c = p.content || `# ${t}\n\n`;
  try { await mup.writeFile(p.path, c); } catch (e) { return err(e.message); }
  if (!store.docMeta[p.path]) store.docMeta[p.path] = {};
  if (p.tags) store.docMeta[p.path].tags = p.tags;
  const dir = p.path.substring(0, p.path.lastIndexOf('/') + 1);
  if (dir && !store.folderMeta[dir]) store.folderMeta[dir] = { description: '', role: '', tags: [] };
  save(); renderFileTree(); broadcastState();
  mup.emitEvent('doc-created', { path: p.path });
  return ok(`Created ${p.path.split('/').pop()}`);
});

mup.registerFunction('updateDoc', async (p) => {
  if (!p.path || p.content === undefined) return err('path+content required');
  try { await mup.writeFile(p.path, p.content); } catch (e) { return err(e.message); }
  if (currentFile?.path === p.path) { currentFile.content = p.content; currentFile.lines = p.content.split('\n'); dirty = false; updateUnsaved(); renderContent(); }
  broadcastState();
  return ok(`Updated ${p.path.split('/').pop()}`);
});

mup.registerFunction('appendToDoc', async (p) => {
  if (!p.path || !p.content) return err('path+content required');
  let ex; try { ex = await mup.readFile(p.path); } catch { ex = ''; }
  const nc = ex + (ex.endsWith('\n') ? '' : '\n') + p.content;
  try { await mup.writeFile(p.path, nc); } catch (e) { return err(e.message); }
  if (currentFile?.path === p.path) { currentFile.content = nc; currentFile.lines = nc.split('\n'); dirty = false; updateUnsaved(); renderContent(); }
  broadcastState();
  return ok(`Appended to ${p.path.split('/').pop()}`);
});

// ==== INIT ====

async function scanWorkspace() {
  try {
    const ws = await mup.registerWorkspace({ fileTypes: ['.md', '.mdx', '.txt', '.markdown'] });
    // Rebuild file list from workspace scan
    store.docMeta = {};
    const cwd = ws.cwd;
    if (!store.folderMeta[cwd]) store.folderMeta[cwd] = { description: '', role: '', tags: [] };
    for (const f of ws.files) {
      store.docMeta[f] = store.docMeta[f] || {};
      const dir = f.substring(0, f.lastIndexOf('/') + 1);
      if (dir !== cwd && !store.folderMeta[dir]) store.folderMeta[dir] = { description: '', role: '', tags: [] };
    }
    save(); renderFileTree(); broadcastState();
  } catch (e) { console.error('Workspace scan failed:', e); }
}

mup.onReady(async ({ theme }) => {
  if (theme === 'dark') document.body.classList.add('dark');
  load(); setViewMode('split'); renderContent(); broadcastState();
  await scanWorkspace();
  renderFileTree();
});
mup.onThemeChange((theme) => document.body.classList.toggle('dark', theme === 'dark'));
