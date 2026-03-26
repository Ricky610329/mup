// ---- Manager Card ----
let managerWidget = null;
const browserMupCache = new Map();

const FILE_ICON = '<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" opacity="0.3"><path d="M3 1a1 1 0 00-1 1v12a1 1 0 001 1h8l4-4V2a1 1 0 00-1-1H3zm6 0v4h4"/></svg>';
const FOLDER_ICON = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 4v8a1 1 0 001 1h10a1 1 0 001-1V6a1 1 0 00-1-1H8L6.5 3H3a1 1 0 00-1 1z"/></svg>';
const BACK_ICON = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 2L4 8l6 6"/></svg>';

let folderTree = [];
let navStack = [];

const SKIP_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

async function scanDirectoryHandle(dirHandle) {
  const folders = [];
  const files = [];
  for await (const [name, handle] of dirHandle) {
    if (SKIP_FILES.has(name)) continue;
    if (handle.kind === 'directory' && !name.startsWith('.')) {
      const children = await scanDirectoryHandle(handle);
      folders.push({ type: 'folder', name, children });
    } else if (handle.kind === 'file') {
      const ext = name.includes('.') ? '.' + name.split('.').pop().toLowerCase() : '';
      if (ext === '.html') {
        try {
          const file = await handle.getFile();
          const html = await file.text();
          const match = html.match(/<script\s+type=["']application\/mup-manifest["']\s*>([\s\S]*?)<\/script>/);
          if (match) {
            const raw = JSON.parse(match[1].trim());
            const id = raw.id || 'mup-' + name.replace('.html', '');
            browserMupCache.set(id, { html, name, manifest: raw });
            const isActive = catalog.some(c => c.id === id && c.active);
            files.push({ type: 'file', id, name: raw.name || name, description: raw.description || '', active: isActive, isMup: true, ext });
            continue;
          }
        } catch {}
      }
      files.push({ type: 'file', name, isMup: false, ext });
    }
  }
  folders.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));
  return [...folders, ...files];
}

function getCurrentViewItems() {
  if (folderTree.length > 0) {
    if (navStack.length === 0) return folderTree;
    return navStack[navStack.length - 1].children;
  }
  return catalog.map(c => ({ type: 'file', id: c.id, name: c.name, description: c.description || '', active: c.active }));
}

function renderCurrentView() {
  const items = getCurrentViewItems();
  let html = '';

  if (items.length === 0 && navStack.length === 0) {
    return `<div class="manager-empty">
      <svg class="manager-empty-icon" width="36" height="36" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1"><path d="M2 4v8a1 1 0 001 1h10a1 1 0 001-1V6a1 1 0 00-1-1H8L6.5 3H3a1 1 0 00-1 1z"/></svg>
      <span>Enter a MUPs folder path above<br>and click <b>Load</b> to get started</span>
      <button class="manager-empty-btn" id="emptyOpenFolderBtn">${FOLDER_ICON} Select Folder</button>
    </div>`;
  }

  if (navStack.length > 0) {
    html += `<div class="manager-file is-folder" data-action="back">${BACK_ICON}<span class="manager-file-name">..</span></div>`;
  }

  for (const item of items) {
    if (item.type === 'folder') {
      html += `<div class="manager-file is-folder" data-folder="${escapeHtml(item.name)}">${FOLDER_ICON}<span class="manager-file-name">${escapeHtml(item.name)}</span></div>`;
    } else if (item.isMup === false) {
      html += `<div class="manager-file non-mup" title="${escapeHtml(item.name)}">${FILE_ICON}<span class="manager-file-name">${escapeHtml(item.name)}</span></div>`;
    } else {
      const catEntry = catalog.find(c => c.id === item.id);
      const isActive = item.active || (catEntry && catEntry.active);
      const multi = catEntry?.multiInstance || item.multiInstance || false;
      const cls = isActive ? 'manager-file active' : 'manager-file';
      const multiAttr = multi ? ' data-multi="true"' : '';
      const multiLabel = isActive && multi ? ' <span style="font-size:9px;color:var(--text-tertiary);">+</span>' : '';
      html += `<div class="${cls}" data-id="${item.id}"${multiAttr} title="${escapeHtml(item.description || item.name)}">${FILE_ICON}<span class="manager-file-name">${escapeHtml(item.name)}${multiLabel}</span></div>`;
    }
  }
  return html;
}

function renderBreadcrumb() {
  if (navStack.length === 0) return '';
  let html = '<div class="manager-breadcrumb"><span data-nav-to="-1">MUPs</span>';
  for (let i = 0; i < navStack.length; i++) {
    html += `<span class="bc-sep">/</span>`;
    if (i < navStack.length - 1) {
      html += `<span data-nav-to="${i}">${escapeHtml(navStack[i].name)}</span>`;
    } else {
      html += `<span class="bc-current">${escapeHtml(navStack[i].name)}</span>`;
    }
  }
  html += '</div>';
  return html;
}

function renderManagerCard() {
  if (!grid) return;

  const listHtml = renderCurrentView();
  const breadcrumb = renderBreadcrumb();

  if (!managerWidget) {
    const mgrEl = document.createElement('div');
    mgrEl.classList.add('grid-stack-item');
    mgrEl.setAttribute('gs-w', '1');
    mgrEl.setAttribute('gs-h', '1');
    mgrEl.setAttribute('gs-x', '0');
    mgrEl.setAttribute('gs-y', '0');
    mgrEl.setAttribute('gs-id', '__manager__');
    mgrEl.innerHTML = `
      <div class="grid-stack-item-content">
        <div class="mup-card-header" style="cursor:grab;">
          <span class="mup-name">MUPs</span>
        </div>
        <div class="mups-path-bar" id="mupsPathBar">
          <input type="text" id="mupsPathInput" placeholder="Enter MUPs folder path..." spellcheck="false">
          <button id="mupsPathLoadBtn">Load</button>
        </div>
        <div id="managerBreadcrumb">${breadcrumb}</div>
        <div class="manager-list" id="managerList">${listHtml}</div>
      </div>`;
    managerWidget = grid.makeWidget(mgrEl);
    applyPendingLayout('__manager__', managerWidget);
  } else {
    const listEl = managerWidget.querySelector('#managerList');
    if (listEl) listEl.innerHTML = listHtml;
    const bcEl = managerWidget.querySelector('#managerBreadcrumb');
    if (bcEl) bcEl.innerHTML = breadcrumb;
  }

  bindManagerEvents();
}

function bindManagerEvents() {
  if (!managerWidget) return;

  const pathInput = managerWidget.querySelector('#mupsPathInput');
  const pathLoadBtn = managerWidget.querySelector('#mupsPathLoadBtn');
  if (pathInput && pathLoadBtn) {
    const submitPath = () => {
      const p = pathInput.value.trim();
      if (p && ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'set-mups-path', path: p }));
    };
    pathLoadBtn.onclick = submitPath;
    pathInput.onkeydown = (e) => { if (e.key === 'Enter') submitPath(); };
  }

  const emptyBtn = managerWidget.querySelector('#emptyOpenFolderBtn');
  if (emptyBtn) {
    emptyBtn.onclick = () => {
      const input = managerWidget.querySelector('#mupsPathInput');
      if (input) input.focus();
    };
  }

  managerWidget.querySelectorAll('[data-nav-to]').forEach(el => {
    el.onclick = () => {
      const target = parseInt(el.dataset.navTo);
      if (target === -1) {
        navStack = [];
      } else {
        navStack = navStack.slice(0, target + 1);
      }
      renderManagerCard();
    };
  });

  managerWidget.querySelectorAll('.manager-file.is-folder').forEach(el => {
    el.onclick = () => {
      if (el.dataset.action === 'back') {
        navStack.pop();
        renderManagerCard();
        return;
      }
      const folderName = el.dataset.folder;
      const items = getCurrentViewItems();
      const folder = items.find(i => i.type === 'folder' && i.name === folderName);
      if (folder && folder.children) {
        navStack.push(folder);
        renderManagerCard();
      }
    };
  });

  managerWidget.querySelectorAll('.manager-file:not(.is-folder)').forEach(el => {
    el.ondblclick = () => {
      const id = el.dataset.id;
      if (!id) return;
      const isActive = el.classList.contains('active');
      const multi = el.dataset.multi === 'true';

      if (isActive && !multi) return;

      if (isActive && multi && ws && ws.readyState === WebSocket.OPEN) {
        const name = prompt('Name this panel:', '');
        if (name === null) return;
        ws.send(JSON.stringify({ type: "new-instance", mupId: id, customName: name || undefined }));
        return;
      }

      const cached = browserMupCache.get(id);
      if (cached && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "register-and-activate", mupId: id, html: cached.html, fileName: cached.name }));
      } else if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "activate-mup", mupId: id }));
      }
    };
  });
}
