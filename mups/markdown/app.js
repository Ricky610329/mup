// ---- Knowledge Base MUP ----

// ---- State ----
const STORE_KEY = 'mup-kb-data';
let store = { _v: 1, folderMeta: {}, docMeta: {}, collections: {}, annotations: [], pins: [] };
let currentFile = null; // { path, content, lines }
let visibleRange = null;
let selection = null;
let recentFiles = [];
let nextAnnId = 1;
let nextCollId = 1;
let viewMode = 'split';
let dirty = false;
let renaming = false;

function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// ---- Persistence ----
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch {} }
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(STORE_KEY));
    if (d?._v === 1) {
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
    if (currentFile) parts.push(`Viewing "${currentFile.path.split('/').pop()}"${visibleRange ? ` (L${visibleRange.start}-${visibleRange.end})` : ''}`);
    if (selection) parts.push(`Selected: "${selection.text.slice(0, 50)}"`);
    if (todos) parts.push(`${todos} TODOs`);
    if (dirty) parts.push('unsaved');
    mup.updateState('KB: ' + (parts.length ? parts.join('. ') : 'idle') + '.', {
      currentFile: currentFile?.path || null, visibleRange, selection, recentFiles,
      stats: { docs: Object.keys(store.docMeta).length, folders: Object.keys(store.folderMeta).length, annotations: store.annotations.length, todos },
    });
  }, 300);
}

// ---- Unsaved Indicator ----
function updateUnsaved() {
  document.getElementById('editStatus').textContent = dirty ? 'unsaved' : '';
  document.getElementById('editStatus').style.color = dirty ? '' : '';
}

// ---- Root Path ----
function getRootPath() {
  const folders = Object.keys(store.folderMeta);
  if (folders.length) return folders[0];
  const files = Object.keys(store.docMeta);
  if (files.length) return files[0].substring(0, files[0].lastIndexOf('/') + 1);
  return null;
}

// ==== FILE TREE ====

function renderFileTree() {
  if (renaming) return;
  const tree = document.getElementById('fileTree');
  const allFolders = Object.keys(store.folderMeta).sort();
  const allFiles = Object.keys(store.docMeta).sort();

  if (!allFolders.length && !allFiles.length) {
    tree.innerHTML = '<div style="padding:12px;font-size:11px;color:var(--text-muted)">No files yet. Click + to create.</div>';
    return;
  }

  const folderFiles = {};
  for (const f of allFolders) folderFiles[f] = [];
  const orphans = [];
  for (const fp of allFiles) {
    const dir = fp.substring(0, fp.lastIndexOf('/') + 1);
    if (folderFiles[dir]) folderFiles[dir].push(fp);
    else orphans.push(fp);
  }

  let html = '';
  for (const [folder, files] of Object.entries(folderFiles)) {
    const name = folder.replace(/\/$/, '').split('/').pop() || folder;
    const meta = store.folderMeta[folder] || {};
    const tip = meta.description ? ` title="${esc(meta.description)}"` : '';
    html += `<div class="folder-item" data-folder="${esc(folder)}"${tip}>`;
    html += `<svg class="folder-arrow expanded" viewBox="0 0 12 12"><path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;
    html += `<span class="folder-name">${esc(name)}</span>`;
    html += `<span class="folder-actions">`;
    html += `<button data-new-in="${esc(folder)}" title="New file"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>`;
    html += `<button data-new-folder-in="${esc(folder)}" title="New folder"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg></button>`;
    html += `</span></div>`;
    html += `<div class="folder-children" data-folder-children="${esc(folder)}">`;
    for (const f of files) html += fileItemHtml(f);
    html += '</div>';
  }
  for (const f of orphans) html += fileItemHtml(f);
  tree.innerHTML = html;
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
  if (file?.dataset.path) { openFile(file.dataset.path); return; }
  const folder = e.target.closest('.folder-item');
  if (folder?.dataset.folder) {
    const ch = document.querySelector(`[data-folder-children="${CSS.escape(folder.dataset.folder)}"]`);
    if (ch) { ch.classList.toggle('collapsed'); folder.querySelector('.folder-arrow')?.classList.toggle('expanded'); }
  }
});

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
  const finish = (doRename) => {
    if (done) return;
    done = true; renaming = false;
    const newName = doRename ? input.value.trim() : null;
    if (newName && newName !== oldName) {
      const dir = filePath.substring(0, filePath.lastIndexOf('/') + 1);
      const newPath = dir + newName;
      const meta = store.docMeta[filePath]; delete store.docMeta[filePath]; store.docMeta[newPath] = meta || {};
      store.annotations.forEach(a => { if (a.filePath === filePath) a.filePath = newPath; });
      store.pins = store.pins.map(p => p === filePath ? newPath : p);
      if (currentFile?.path === filePath) { currentFile.path = newPath; document.getElementById('breadcrumb').textContent = newPath; }
      save(); broadcastState();
      mup.notifyInteraction('file-renamed', `Renamed ${oldName} → ${newName}`, { from: filePath, to: newPath });
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
fileTreeEl.addEventListener('drop', (e) => {
  e.preventDefault(); document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  if (!dragPath) return;
  const folder = e.target.closest('.folder-item');
  if (!folder) return;
  const target = folder.dataset.folder;
  const name = dragPath.split('/').pop();
  const newPath = target + (target.endsWith('/') ? '' : '/') + name;
  if (newPath === dragPath) return;
  const meta = store.docMeta[dragPath]; delete store.docMeta[dragPath]; store.docMeta[newPath] = meta || {};
  store.annotations.forEach(a => { if (a.filePath === dragPath) a.filePath = newPath; });
  store.pins = store.pins.map(p => p === dragPath ? newPath : p);
  if (currentFile?.path === dragPath) currentFile.path = newPath;
  save(); renderFileTree(); broadcastState();
  mup.notifyInteraction('file-moved', `Moved ${name} → ${target.split('/').pop()}`, { from: dragPath, to: newPath });
  dragPath = null;
});

// ---- Inline Input (new file / new folder) ----
function showInlineInput(parentFolder, type) {
  const container = document.querySelector(`[data-folder-children="${CSS.escape(parentFolder)}"]`);
  if (!container) return;
  container.classList.remove('collapsed');
  const fi = document.querySelector(`.folder-item[data-folder="${CSS.escape(parentFolder)}"]`);
  fi?.querySelector('.folder-arrow')?.classList.add('expanded');
  insertInlineInput(container, type, parentFolder);
}

function insertInlineInput(container, type, folder) {
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
      const p = folder + (folder.endsWith('/') ? '' : '/') + name + '/';
      if (!store.folderMeta[p]) store.folderMeta[p] = { description: '', role: '', tags: [] };
      save(); renderFileTree(); broadcastState();
      mup.notifyInteraction('folder-created', `Created ${name}/`, { path: p });
    } else {
      await createNewDoc(name, folder);
    }
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { done = true; w.remove(); } });
  input.addEventListener('blur', () => setTimeout(() => { if (!done) { done = true; w.remove(); } }, 200));
}

// Root-level new file / folder — always at top level of tree
document.getElementById('rootNewFile').addEventListener('click', () => {
  const root = getRootPath();
  if (root) {
    // Insert at top of #fileTree, create file in root folder
    insertInlineInputAtRoot('file', root);
  } else {
    insertInlineInputAtRoot('file', null);
  }
});
document.getElementById('rootNewFolder').addEventListener('click', () => {
  const root = getRootPath();
  insertInlineInputAtRoot('folder', root);
});

function insertInlineInputAtRoot(type, baseFolder) {
  const tree = document.getElementById('fileTree');
  tree.querySelectorAll('.inline-new-input').forEach(el => el.remove());
  const w = document.createElement('div'); w.className = 'inline-new-input';
  w.innerHTML = `<input type="text" placeholder="${type === 'folder' ? 'folder name' : 'filename (.md auto)'}">`;
  tree.prepend(w);
  const input = w.querySelector('input'); input.focus();
  let done = false;
  const commit = async () => {
    if (done) return; done = true;
    const name = input.value.trim(); w.remove();
    if (!name) return;

    if (type === 'folder') {
      // Determine parent: use baseFolder's parent, or baseFolder itself as sibling level
      let parent;
      if (baseFolder) {
        // Create sibling folder: same parent as existing root folder
        parent = baseFolder;
      } else {
        parent = '/tmp/kb/';
        if (!store.folderMeta[parent]) store.folderMeta[parent] = { description: '', role: '', tags: [] };
      }
      const newFolder = parent + (parent.endsWith('/') ? '' : '/') + name + '/';
      if (!store.folderMeta[newFolder]) store.folderMeta[newFolder] = { description: '', role: '', tags: [] };
      save(); renderFileTree(); broadcastState();
      mup.notifyInteraction('folder-created', `Created ${name}/`, { path: newFolder });
    } else {
      const folder = baseFolder || '/tmp/kb/';
      if (!baseFolder) {
        if (!store.folderMeta[folder]) store.folderMeta[folder] = { description: '', role: '', tags: [] };
      }
      await createNewDoc(name, folder);
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
  } catch (err) {
    document.getElementById('viewer').innerHTML = `<div style="padding:20px;color:var(--red)">Failed: ${esc(err.message)}</div>`;
  }
}

// ---- Delete Confirm ----
let pendingDeletePath = null;
function confirmDelete(path) {
  pendingDeletePath = path;
  document.getElementById('deleteFileName').textContent = path.split('/').pop();
  document.getElementById('deleteModal').style.display = 'block';
}
document.getElementById('deleteConfirm').addEventListener('click', () => {
  if (pendingDeletePath) {
    delete store.docMeta[pendingDeletePath];
    store.pins = store.pins.filter(p => p !== pendingDeletePath);
    store.annotations = store.annotations.filter(a => a.filePath !== pendingDeletePath);
    if (currentFile?.path === pendingDeletePath) { currentFile = null; dirty = false; renderContent(); }
    save(); renderFileTree(); broadcastState();
  }
  pendingDeletePath = null; document.getElementById('deleteModal').style.display = 'none';
});
document.getElementById('deleteCancel').addEventListener('click', () => { pendingDeletePath = null; document.getElementById('deleteModal').style.display = 'none'; });

// ---- Sidebar Toggle ----
document.getElementById('sidebarToggleTop').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('collapsed'));

// ==== CONTENT ====

// ---- View Mode ----
document.querySelector('.view-toggle').addEventListener('click', (e) => { const b = e.target.closest('.vt-btn'); if (b) setViewMode(b.dataset.mode); });

function setViewMode(mode) {
  viewMode = mode;
  document.body.className = document.body.className.replace(/\bmode-\w+/g, '').trim();
  document.body.classList.add('mode-' + mode);
  document.querySelectorAll('.vt-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  document.getElementById('saveBtn').style.display = (mode !== 'preview') && currentFile ? '' : 'none';
  updatePreview();
}

function updatePreview() {
  if (!currentFile) return;
  const v = document.getElementById('viewer');
  const src = dirty ? document.getElementById('editor').value : currentFile.content;
  try { marked.setOptions({ breaks: true, gfm: true }); v.innerHTML = marked.parse(src); } catch { v.innerHTML = `<pre>${esc(src)}</pre>`; }
  applyAnnotations();
}

function renderContent() {
  const toolbar = document.getElementById('contentToolbar');
  const status = document.getElementById('statusInfo');
  const ed = document.getElementById('editor');
  const v = document.getElementById('viewer');
  if (!currentFile) {
    toolbar.style.display = 'none';
    ed.style.display = 'none';
    document.getElementById('divider').style.display = 'none';
    v.innerHTML = '<div id="emptyState"><div class="empty-icon">Md</div><div class="empty-text">Select a file or create a new one</div></div>';
    v.style.display = '';
    status.textContent = ''; return;
  }
  // Restore editor/divider visibility based on view mode
  ed.style.display = '';
  document.getElementById('divider').style.display = '';
  setViewMode(viewMode); // re-apply mode CSS
  toolbar.style.display = '';
  document.getElementById('breadcrumb').textContent = currentFile.path;
  if (!dirty) ed.value = currentFile.content;
  updatePreview();
  const dm = store.docMeta[currentFile.path] || {};
  const anns = store.annotations.filter(a => a.filePath === currentFile.path).length;
  const parts = [`${currentFile.lines.length} lines`];
  if (anns) parts.push(`${anns} annotations`);
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
    recentFiles = [path, ...recentFiles.filter(p => p !== path)].slice(0, 5);
    if (!store.docMeta[path]) store.docMeta[path] = {};
    store.docMeta[path].lastViewedAt = Date.now();
    store.docMeta[path].viewCount = (store.docMeta[path].viewCount || 0) + 1;
    save(); renderContent(); renderFileTree(); broadcastState();
    mup.notifyInteraction('file-opened', `Opened ${path.split('/').pop()} (${currentFile.lines.length} lines)`, { path, lines: currentFile.lines.length });
  } catch (err) {
    const denied = err.message?.includes('Access denied');
    const folder = path.substring(0, path.lastIndexOf('/') + 1);
    const folderName = folder.split('/').filter(Boolean).pop() || folder;
    const v = document.getElementById('viewer');
    if (denied) {
      v.innerHTML = `<div style="padding:32px;text-align:center;color:var(--text-muted)"><div style="font-size:13px;margin-bottom:12px">This folder requires access permission</div><button id="grantAccessBtn" style="padding:6px 16px;border:1px solid var(--accent);border-radius:5px;background:transparent;color:var(--accent);cursor:pointer;font-size:12px;font-weight:500">Grant Access to ${esc(folderName)}/</button></div>`;
      document.getElementById('grantAccessBtn').addEventListener('click', async () => {
        try {
          await mup.system('grantFileAccess', { paths: [folder] });
          await openFile(path);
        } catch (e) { v.innerHTML = `<div style="padding:20px;color:var(--red)">${esc(e.message)}</div>`; }
      });
    } else {
      v.innerHTML = `<div style="padding:20px;color:var(--red)">${esc(err.message)}</div>`;
    }
  }
}

// ---- Editor ----
const editorEl = document.getElementById('editor');
editorEl.addEventListener('input', () => { dirty = true; updateUnsaved(); if (viewMode === 'split') updatePreview(); });
editorEl.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const s = editorEl.selectionStart;
    editorEl.value = editorEl.value.substring(0, s) + '  ' + editorEl.value.substring(editorEl.selectionEnd);
    editorEl.selectionStart = editorEl.selectionEnd = s + 2;
    dirty = true; updateUnsaved();
    if (viewMode === 'split') updatePreview();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveFile(); }
});
document.getElementById('saveBtn').addEventListener('click', saveFile);

async function saveFile() {
  if (!currentFile) return;
  currentFile.content = editorEl.value;
  currentFile.lines = currentFile.content.split('\n');
  try {
    await mup.writeFile(currentFile.path, currentFile.content);
    dirty = false; updateUnsaved();
    document.getElementById('editStatus').textContent = 'saved';
    document.getElementById('editStatus').style.color = 'var(--green)';
    setTimeout(() => { if (!dirty) { document.getElementById('editStatus').textContent = ''; document.getElementById('editStatus').style.color = ''; } }, 2000);
    updatePreview();
    mup.notifyInteraction('file-saved', `Saved ${currentFile.path.split('/').pop()}`, { path: currentFile.path });
    broadcastState();
  } catch { document.getElementById('editStatus').textContent = 'save failed!'; }
}

// ---- Annotations ----
document.getElementById('viewer').addEventListener('mouseup', () => {
  const sel = window.getSelection();
  const text = sel?.toString().trim();
  const tb = document.getElementById('annotationToolbar');
  if (!text || !currentFile || !sel.rangeCount) { tb.style.display = 'none'; selection = null; broadcastState(); return; }
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  tb.style.display = 'flex'; tb.style.left = `${rect.left + rect.width / 2 - 70}px`; tb.style.top = `${rect.top - 34}px`;
  // Find line number by searching for the exact selected range context
  const beforeText = currentFile.content.substring(0, currentFile.content.indexOf(text));
  const lineStart = beforeText === '' && currentFile.content.indexOf(text) === -1 ? 1 : (beforeText.match(/\n/g) || []).length + 1;
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
    modal.style.display = 'flex'; modal.style.left = tb.style.left; modal.style.top = `${parseInt(tb.style.top) - 40}px`;
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
  mup.notifyInteraction('annotation-created', `Marked ${currentFile.path.split('/').pop()}:${ann.lineStart} as ${type}`, { annotation: ann });
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
  if (type === 'all' || type === 'folders') for (const [p, m] of Object.entries(store.folderMeta)) if (m.description?.toLowerCase().includes(q) || (m.tags || []).some(t => t.includes(q))) r.push({ type: 'folder', path: p, match: m.description });
  if (type === 'all' || type === 'tags') for (const [p, m] of Object.entries(store.docMeta)) if ((m.tags || []).some(t => t.includes(q))) r.push({ type: 'tag', path: p, match: (m.tags || []).join(', ') });
  if (type === 'all' || type === 'annotations') for (const a of store.annotations) if (a.note?.toLowerCase().includes(q) || a.selectedText?.toLowerCase().includes(q)) r.push({ type: 'annotation', path: a.filePath, match: a.note || a.selectedText });
  if (type === 'all' || type === 'collections') for (const [id, c] of Object.entries(store.collections)) if (c.name?.toLowerCase().includes(q) || c.description?.toLowerCase().includes(q)) r.push({ type: 'collection', id, match: c.description || c.name });
  return r;
}

// ==== MUP FUNCTIONS (LLM interface) ====

mup.registerFunction('describeFolders', async (p) => {
  if (!p.folders) return { content: [{ type: 'text', text: `${Object.keys(store.folderMeta).length} folder(s)` }, { type: 'data', data: Object.entries(store.folderMeta).map(([k, v]) => ({ path: k, ...v })) }], isError: false };
  for (const f of p.folders) store.folderMeta[f.path] = { description: f.description, role: f.role || '', tags: f.tags || [] };
  save(); renderFileTree(); broadcastState();
  return { content: [{ type: 'text', text: `Described ${p.folders.length} folder(s)` }], isError: false };
});

mup.registerFunction('manageTags', async (p) => {
  const { subAction, path, tags } = p;
  if (subAction === 'add') { if (!path || !tags) return { content: [{ type: 'text', text: 'path+tags required' }], isError: true }; if (!store.docMeta[path]) store.docMeta[path] = {}; const s = new Set(store.docMeta[path].tags || []); for (const t of tags) s.add(t); store.docMeta[path].tags = [...s]; save(); broadcastState(); return { content: [{ type: 'text', text: 'Tags added' }], isError: false }; }
  if (subAction === 'remove') { if (!path || !tags) return { content: [{ type: 'text', text: 'path+tags required' }], isError: true }; if (store.docMeta[path]) store.docMeta[path].tags = (store.docMeta[path].tags || []).filter(t => !tags.includes(t)); save(); broadcastState(); return { content: [{ type: 'text', text: 'Tags removed' }], isError: false }; }
  if (subAction === 'list') { const tc = {}; for (const dm of Object.values(store.docMeta)) for (const t of (dm.tags || [])) tc[t] = (tc[t] || 0) + 1; return { content: [{ type: 'data', data: tc }], isError: false }; }
  if (subAction === 'search') { if (!tags) return { content: [{ type: 'text', text: 'tags required' }], isError: true }; const m = Object.entries(store.docMeta).filter(([, m]) => tags.some(t => (m.tags || []).includes(t))).map(([p, m]) => ({ path: p, tags: m.tags })); return { content: [{ type: 'data', data: m }], isError: false }; }
  return { content: [{ type: 'text', text: 'Unknown subAction' }], isError: true };
});

mup.registerFunction('manageCollections', async (p) => {
  if (p.subAction === 'create') { if (!p.name) return { content: [{ type: 'text', text: 'name required' }], isError: true }; const id = `coll_${nextCollId++}`; store.collections[id] = { name: p.name, description: p.description || '', tags: p.tags || [], paths: [], createdAt: Date.now() }; save(); broadcastState(); return { content: [{ type: 'text', text: `Created ${id}` }], isError: false }; }
  if (p.subAction === 'update') { const c = store.collections[p.id]; if (!c) return { content: [{ type: 'text', text: 'Not found' }], isError: true }; if (p.name) c.name = p.name; if (p.description) c.description = p.description; if (p.tags) c.tags = p.tags; save(); broadcastState(); return { content: [{ type: 'text', text: 'Updated' }], isError: false }; }
  if (p.subAction === 'delete') { delete store.collections[p.id]; save(); broadcastState(); return { content: [{ type: 'text', text: 'Deleted' }], isError: false }; }
  if (p.subAction === 'list') { return { content: [{ type: 'data', data: Object.entries(store.collections).map(([id, c]) => ({ id, ...c })) }], isError: false }; }
  if (p.subAction === 'addDoc') { const c = store.collections[p.id]; if (c && !c.paths.includes(p.path)) c.paths.push(p.path); save(); return { content: [{ type: 'text', text: 'Added' }], isError: false }; }
  if (p.subAction === 'removeDoc') { const c = store.collections[p.id]; if (c) c.paths = c.paths.filter(x => x !== p.path); save(); return { content: [{ type: 'text', text: 'Removed' }], isError: false }; }
  return { content: [{ type: 'text', text: 'Unknown subAction' }], isError: true };
});

mup.registerFunction('annotate', async (p) => {
  if (p.subAction === 'create') { if (!p.filePath || !p.type) return { content: [{ type: 'text', text: 'filePath+type required' }], isError: true }; const ann = { id: `ann_${nextAnnId++}`, filePath: p.filePath, type: p.type, lineStart: p.lineStart || 0, lineEnd: p.lineEnd || 0, selectedText: p.selectedText || '', note: p.note || '', resolved: false, createdAt: Date.now(), updatedAt: Date.now() }; store.annotations.push(ann); save(); if (currentFile?.path === ann.filePath) updatePreview(); broadcastState(); return { content: [{ type: 'text', text: `Created ${ann.id}` }], isError: false }; }
  if (p.subAction === 'update') { const a = store.annotations.find(x => x.id === p.id); if (!a) return { content: [{ type: 'text', text: 'Not found' }], isError: true }; if (p.note !== undefined) a.note = p.note; if (p.type) a.type = p.type; a.updatedAt = Date.now(); save(); if (currentFile?.path === a.filePath) updatePreview(); broadcastState(); return { content: [{ type: 'text', text: 'Updated' }], isError: false }; }
  if (p.subAction === 'resolve') { const a = store.annotations.find(x => x.id === p.id); if (!a) return { content: [{ type: 'text', text: 'Not found' }], isError: true }; a.resolved = true; a.updatedAt = Date.now(); save(); updatePreview(); broadcastState(); return { content: [{ type: 'text', text: `Resolved ${p.id}` }], isError: false }; }
  if (p.subAction === 'delete') { const i = store.annotations.findIndex(x => x.id === p.id); if (i < 0) return { content: [{ type: 'text', text: 'Not found' }], isError: true }; store.annotations.splice(i, 1); save(); updatePreview(); broadcastState(); return { content: [{ type: 'text', text: 'Deleted' }], isError: false }; }
  if (p.subAction === 'list') { let a = store.annotations; if (p.filePath) a = a.filter(x => x.filePath === p.filePath); return { content: [{ type: 'data', data: a }], isError: false }; }
  return { content: [{ type: 'text', text: 'Unknown subAction' }], isError: true };
});

mup.registerFunction('setDocStatus', async (p) => { if (!p.path) return { content: [{ type: 'text', text: 'path required' }], isError: true }; if (!store.docMeta[p.path]) store.docMeta[p.path] = {}; const d = store.docMeta[p.path]; if (p.priority) d.priority = p.priority; if (p.status) d.status = p.status; if (p.notes !== undefined) d.notes = p.notes; save(); renderFileTree(); broadcastState(); return { content: [{ type: 'text', text: `${p.path.split('/').pop()}: ${[p.status, p.priority].filter(Boolean).join(' ')}` }], isError: false }; });
mup.registerFunction('managePins', async (p) => { if (p.subAction === 'pin' && p.path && !store.pins.includes(p.path)) store.pins.push(p.path); else if (p.subAction === 'unpin') store.pins = store.pins.filter(x => x !== p.path); else if (p.subAction === 'list') return { content: [{ type: 'data', data: store.pins }], isError: false }; else if (p.subAction === 'reorder' && p.order) store.pins = p.order; save(); broadcastState(); return { content: [{ type: 'text', text: 'OK' }], isError: false }; });
mup.registerFunction('getKBMap', async (p) => { const s = p.scope || 'full', d = {}; if (s === 'full' || s === 'folders') d.folders = store.folderMeta; if (s === 'full' || s === 'pins') d.pins = store.pins; if (s === 'full' || s === 'collections') d.collections = store.collections; if (s === 'full' || s === 'annotations') { d.annotations = { total: store.annotations.length, unresolved: store.annotations.filter(a => !a.resolved).length, byType: {} }; for (const a of store.annotations) d.annotations.byType[a.type] = (d.annotations.byType[a.type] || 0) + 1; } if (s === 'full') { d.docs = {}; for (const [k, m] of Object.entries(store.docMeta)) d.docs[k] = { tags: m.tags, status: m.status, priority: m.priority }; } return { content: [{ type: 'text', text: `KB: ${Object.keys(store.folderMeta).length} folders, ${Object.keys(store.docMeta).length} docs` }, { type: 'data', data: d }], isError: false }; });
mup.registerFunction('getOutline', async (p) => { if (!p.path) return { content: [{ type: 'text', text: 'path required' }], isError: true }; let c; if (currentFile?.path === p.path) c = currentFile.content; else { try { c = await mup.readFile(p.path); } catch (e) { return { content: [{ type: 'text', text: e.message }], isError: true }; } } return { content: [{ type: 'data', data: { headings: parseHeadings(c), totalLines: c.split('\n').length, annotations: store.annotations.filter(a => a.filePath === p.path && !a.resolved) } }], isError: false }; });
mup.registerFunction('getSection', async (p) => { if (!currentFile) return { content: [{ type: 'text', text: 'No file loaded' }], isError: true }; let s, e; if (p.heading) { const h = parseHeadings(currentFile.content).find(h => h.text.toLowerCase().includes(p.heading.toLowerCase().replace(/^#+\s*/, ''))); if (!h) return { content: [{ type: 'text', text: 'Not found' }], isError: true }; s = h.line; e = h.endLine; } else { s = p.lineStart; e = p.lineEnd; } if (!s || !e) return { content: [{ type: 'text', text: 'Provide heading or lineStart+lineEnd' }], isError: true }; const sec = currentFile.lines.slice(s - 1, e).join('\n'); const t = sec.length > 6000; return { content: [{ type: 'data', data: { content: t ? sec.slice(0, 6000) : sec, truncated: t, lines: `${s}-${e}` } }], isError: false }; });
mup.registerFunction('search', async (p) => { if (!p.query) return { content: [{ type: 'text', text: 'query required' }], isError: true }; const r = searchMetadata(p.query, p.type || 'all'); return { content: [{ type: 'text', text: `${r.length} result(s)` }, { type: 'data', data: r.slice(0, 20) }], isError: false }; });
mup.registerFunction('loadFile', async (p) => { if (!p.path) return { content: [{ type: 'text', text: 'path required' }], isError: true }; await openFile(p.path); return currentFile ? { content: [{ type: 'text', text: `Loaded ${p.path.split('/').pop()} (${currentFile.lines.length} lines)` }], isError: false } : { content: [{ type: 'text', text: 'Failed' }], isError: true }; });
mup.registerFunction('getContext', async () => ({ content: [{ type: 'data', data: { currentFile: currentFile?.path, lines: currentFile?.lines.length, visibleRange, selection, recentFiles, annotations: currentFile ? store.annotations.filter(a => a.filePath === currentFile.path && !a.resolved).slice(0, 10) : [] } }], isError: false }));
mup.registerFunction('importFolder', async (p) => { if (!p.path) return { content: [{ type: 'text', text: 'path required' }], isError: true }; const fp = p.path.endsWith('/') ? p.path : p.path + '/'; if (!store.folderMeta[fp]) store.folderMeta[fp] = { description: '', role: '', tags: [] }; for (const f of (p.files || [])) if (!store.docMeta[f]) store.docMeta[f] = {}; save(); renderFileTree(); broadcastState(); return { content: [{ type: 'text', text: `Imported ${fp}: ${(p.files || []).length} file(s)` }], isError: false }; });
mup.registerFunction('createDoc', async (p) => { if (!p.path) return { content: [{ type: 'text', text: 'path required' }], isError: true }; const t = p.path.split('/').pop().replace(/\.md$/, '').replace(/[-_]/g, ' '); const c = p.content || `# ${t}\n\n`; try { await mup.writeFile(p.path, c); } catch (e) { return { content: [{ type: 'text', text: e.message }], isError: true }; } if (!store.docMeta[p.path]) store.docMeta[p.path] = {}; if (p.tags) store.docMeta[p.path].tags = p.tags; const dir = p.path.substring(0, p.path.lastIndexOf('/') + 1); if (dir && !store.folderMeta[dir]) store.folderMeta[dir] = { description: '', role: '', tags: [] }; save(); renderFileTree(); broadcastState(); mup.emitEvent('doc-created', { path: p.path }); return { content: [{ type: 'text', text: `Created ${p.path.split('/').pop()}` }], isError: false }; });
mup.registerFunction('updateDoc', async (p) => { if (!p.path || p.content === undefined) return { content: [{ type: 'text', text: 'path+content required' }], isError: true }; try { await mup.writeFile(p.path, p.content); } catch (e) { return { content: [{ type: 'text', text: e.message }], isError: true }; } if (currentFile?.path === p.path) { currentFile.content = p.content; currentFile.lines = p.content.split('\n'); dirty = false; updateUnsaved(); renderContent(); } broadcastState(); return { content: [{ type: 'text', text: `Updated ${p.path.split('/').pop()}` }], isError: false }; });
mup.registerFunction('appendToDoc', async (p) => { if (!p.path || !p.content) return { content: [{ type: 'text', text: 'path+content required' }], isError: true }; let ex; try { ex = await mup.readFile(p.path); } catch { ex = ''; } const nc = ex + (ex.endsWith('\n') ? '' : '\n') + p.content; try { await mup.writeFile(p.path, nc); } catch (e) { return { content: [{ type: 'text', text: e.message }], isError: true }; } if (currentFile?.path === p.path) { currentFile.content = nc; currentFile.lines = nc.split('\n'); dirty = false; updateUnsaved(); renderContent(); } broadcastState(); return { content: [{ type: 'text', text: `Appended to ${p.path.split('/').pop()}` }], isError: false }; });

// ==== INIT ====
mup.onReady(({ theme }) => {
  if (theme === 'dark') document.body.classList.add('dark');
  load(); setViewMode('split'); renderFileTree(); renderContent(); broadcastState();
});
mup.onThemeChange((theme) => document.body.classList.toggle('dark', theme === 'dark'));
