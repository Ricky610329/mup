    // ---- State ----
    let slides = [];
    let currentIndex = 0;
    let theme = 'light';
    let aspectRatio = '16:9';
    let presentationTitle = '';
    let stateTimer = null;
    const STORAGE_KEY = 'mup-slides-data';

    const RATIOS = { '16:9': '16/9', '4:3': '4/3', '1:1': '1/1', '9:16': '9/16' };
    const PORTRAIT_RATIOS = new Set(['9:16']);
    // Fixed design sizes (content always renders at this size, then scaled to fit)
    const DESIGN_SIZES = { '16:9': [960, 540], '4:3': [720, 540], '1:1': [540, 540], '9:16': [304, 540] };

    const themes = {
      light:    { bg:'#ffffff', text:'#1a1a1a', heading:'#0d0d0d', accent:'#0066cc', muted:'#666666', codeBg:'#f5f5f5' },
      dark:     { bg:'#2a2b30', text:'#e1e2e5', heading:'#ffffff', accent:'#60a5fa', muted:'#9a9ba0', codeBg:'#363740' },
      blue:     { bg:'#0f172a', text:'#e2e8f0', heading:'#ffffff', accent:'#38bdf8', muted:'#94a3b8', codeBg:'#1e293b' },
      green:    { bg:'#f0fdf4', text:'#1a3a1a', heading:'#14532d', accent:'#16a34a', muted:'#6b7280', codeBg:'#dcfce7' },
      midnight: { bg:'#0a0a1a', text:'#c8c8e0', heading:'#eeeeff', accent:'#a78bfa', muted:'#6b6b8a', codeBg:'#14142b' },
      warm:     { bg:'#fdf6ec', text:'#3d2e1c', heading:'#2a1a08', accent:'#d97706', muted:'#8b7355', codeBg:'#f5ead6' },
    };

    function esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

    function md(s) {
      if (!s) return '';
      try { return marked.parse(s); } catch { return esc(s); }
    }

    // ---- Aspect ratio ----
    function applyAspectRatio(r) {
      const cssVal = RATIOS[r] || '16/9';
      document.documentElement.style.setProperty('--slide-ratio', cssVal);
    }

    function pageOrientation() {
      return PORTRAIT_RATIOS.has(aspectRatio) ? 'portrait' : 'landscape';
    }

    // ---- Theme ----
    function applySlideTheme(t) {
      const th = themes[t] || themes.light;
      const r = document.documentElement.style;
      r.setProperty('--slide-bg', th.bg);
      r.setProperty('--slide-text', th.text);
      r.setProperty('--slide-heading', th.heading);
      r.setProperty('--slide-accent', th.accent);
      r.setProperty('--slide-muted', th.muted);
      r.setProperty('--slide-code-bg', th.codeBg);
    }

    function applyEditorTheme(t) {
      document.body.classList.toggle('editor-dark', t === 'dark');
    }

    // ---- Render slide HTML ----
    function renderSlideHTML(slide, index, total) {
      const c = slide.content || {};
      let inner = '';
      switch (slide.layout) {
        case 'title':
          inner = `<h1>${esc(c.title || '')}</h1>${c.subtitle ? `<div class="subtitle">${esc(c.subtitle)}</div>` : ''}`;
          break;
        case 'content':
          inner = `${c.title ? `<h2>${esc(c.title)}</h2>` : ''}${md(c.body || '')}`;
          break;
        case 'two-column':
          inner = `${c.title ? `<h2>${esc(c.title)}</h2>` : ''}<div class="slide-columns"><div class="slide-col">${md(c.left || '')}</div><div class="slide-col">${md(c.right || '')}</div></div>`;
          break;
        case 'image':
          inner = `${c.title ? `<h2>${esc(c.title)}</h2>` : ''}${c.imageUrl ? `<img src="${esc(c.imageUrl)}" alt="">` : ''}<div class="caption">${esc(c.caption || '')}</div>`;
          break;
        case 'embed':
          inner = `${c.title ? `<h2>${esc(c.title)}</h2>` : ''}<div class="embed-container">${c.html || ''}</div>${c.caption ? `<div class="caption">${esc(c.caption)}</div>` : ''}`;
          break;
        case 'blank':
          inner = c.html || '';
          break;
      }
      const progress = total > 1 ? ((index + 1) / total * 100) : 100;
      return `<div class="slide-inner">${inner}</div>
        <div class="slide-footer"><span>${esc(presentationTitle)}</span><span>${index + 1} / ${total}</span></div>
        <div class="slide-progress" style="width:${progress}%"></div>`;
    }

    // ---- Render UI ----
    function render() {
      applySlideTheme(theme);
      applyAspectRatio(aspectRatio);
      document.getElementById('themeSelect').value = theme;
      document.getElementById('ratioSelect').value = aspectRatio;
      document.getElementById('slideInfo').textContent = `${slides.length} slide${slides.length !== 1 ? 's' : ''}`;

      // Sidebar thumbnails
      const listEl = document.getElementById('slideList');
      listEl.innerHTML = '';
      slides.forEach((s, i) => {
        const thumb = document.createElement('div');
        thumb.className = 'slide-thumb' + (i === currentIndex ? ' active' : '');
        const previewText = (s.content?.title || s.content?.body || s.layout).slice(0, 40);
        thumb.innerHTML = `<span class="slide-thumb-num">${i + 1}</span>
          <div class="slide-thumb-preview">${esc(previewText)}</div>
          <button class="slide-thumb-delete">&times;</button>`;
        thumb.addEventListener('click', () => { currentIndex = i; render(); });
        thumb.querySelector('.slide-thumb-delete').addEventListener('click', (e) => {
          e.stopPropagation();
          slides.splice(i, 1);
          if (currentIndex >= slides.length) currentIndex = Math.max(0, slides.length - 1);
          render(); debouncedSave();
        });
        listEl.appendChild(thumb);
      });

      // Canvas
      const canvasArea = document.getElementById('canvasArea');
      const editPanel = document.getElementById('editPanel');

      if (slides.length === 0) {
        canvasArea.innerHTML = `<div class="empty-state"><span>No slides yet</span><span style="font-size:11px">Click <b>+ Slide</b> or let the agent create a presentation</span></div>`;
        editPanel.style.display = 'none';
        return;
      }
      editPanel.style.display = 'flex';

      const slide = slides[currentIndex];
      let wrapper = canvasArea.querySelector('.slide-scale-wrapper');
      let frame = canvasArea.querySelector('.slide-frame');
      if (!wrapper) {
        canvasArea.innerHTML = '';
        wrapper = document.createElement('div');
        wrapper.className = 'slide-scale-wrapper';
        frame = document.createElement('div');
        frame.className = 'slide-frame';
        wrapper.appendChild(frame);
        canvasArea.appendChild(wrapper);
      }
      const [designW, designH] = DESIGN_SIZES[aspectRatio] || DESIGN_SIZES['16:9'];
      frame.className = `slide-frame layout-${slide.layout}`;
      frame.style.width = designW + 'px';
      frame.style.height = designH + 'px';
      frame.style.background = themes[theme]?.bg || '#fff';
      frame.innerHTML = renderSlideHTML(slide, currentIndex, slides.length);

      // Scale to fit canvas area
      const areaRect = canvasArea.getBoundingClientRect();
      const pad = 32;
      const availW = areaRect.width - pad;
      const availH = areaRect.height - pad;
      const scale = Math.min(availW / designW, availH / designH, 1);
      wrapper.style.transform = `scale(${scale})`;
      wrapper.style.width = (designW * scale) + 'px';
      wrapper.style.height = (designH * scale) + 'px';
      wrapper.style.marginLeft = '';
      wrapper.style.marginTop = '';

      // Edit panel
      renderEditPanel(slide);
    }

    function renderEditPanel(slide) {
      const panel = document.getElementById('editPanel');
      const c = slide.content || {};
      let html = `<div class="edit-group"><div class="edit-label">LAYOUT</div>
        <select class="edit-input" id="editLayout">
          ${['title','content','two-column','image','embed','blank'].map(l => `<option value="${l}"${l===slide.layout?' selected':''}>${l}</option>`).join('')}
        </select></div>`;

      if (slide.layout !== 'blank') {
        html += `<div class="edit-group"><div class="edit-label">TITLE</div>
          <input class="edit-input" id="editTitle" value="${esc(c.title||'')}" placeholder="Slide title..."></div>`;
      }
      if (slide.layout === 'title') {
        html += `<div class="edit-group"><div class="edit-label">SUBTITLE</div>
          <input class="edit-input" id="editSubtitle" value="${esc(c.subtitle||'')}" placeholder="Subtitle..."></div>`;
      }
      if (slide.layout === 'content') {
        html += `<div class="edit-group"><div class="edit-label">BODY (markdown)</div>
          <textarea class="edit-textarea" id="editBody" rows="8" placeholder="Slide content...">${esc(c.body||'')}</textarea></div>`;
      }
      if (slide.layout === 'two-column') {
        html += `<div class="edit-group"><div class="edit-label">LEFT (markdown)</div>
          <textarea class="edit-textarea" id="editLeft" rows="5">${esc(c.left||'')}</textarea></div>
          <div class="edit-group"><div class="edit-label">RIGHT (markdown)</div>
          <textarea class="edit-textarea" id="editRight" rows="5">${esc(c.right||'')}</textarea></div>`;
      }
      if (slide.layout === 'image') {
        html += `<div class="edit-group"><div class="edit-label">IMAGE URL</div>
          <input class="edit-input" id="editImageUrl" value="${esc(c.imageUrl||'')}" placeholder="https://..."></div>
          <div class="edit-group"><div class="edit-label">CAPTION</div>
          <input class="edit-input" id="editCaption" value="${esc(c.caption||'')}" placeholder="Image caption..."></div>`;
      }
      if (slide.layout === 'embed') {
        html += `<div class="edit-group"><div class="edit-label">HTML / SVG</div>
          <textarea class="edit-textarea" id="editHtml" rows="8" placeholder="Paste HTML or SVG...">${esc(c.html||'')}</textarea></div>
          <div class="edit-group"><div class="edit-label">CAPTION</div>
          <input class="edit-input" id="editCaption" value="${esc(c.caption||'')}" placeholder="Caption..."></div>`;
      }
      if (slide.layout === 'blank') {
        html += `<div class="edit-group"><div class="edit-label">HTML</div>
          <textarea class="edit-textarea" id="editHtml" rows="8">${esc(c.html||'')}</textarea></div>`;
      }
      panel.innerHTML = html;

      // Bind events
      const bind = (id, field) => {
        const el = panel.querySelector('#' + id);
        if (el) el.addEventListener('input', () => {
          slide.content[field] = el.value;
          render(); debouncedSave();
        });
      };
      const layoutEl = panel.querySelector('#editLayout');
      if (layoutEl) layoutEl.addEventListener('change', () => {
        slide.layout = layoutEl.value;
        if (!slide.content) slide.content = {};
        render(); debouncedSave();
      });
      bind('editTitle', 'title');
      bind('editSubtitle', 'subtitle');
      bind('editBody', 'body');
      bind('editLeft', 'left');
      bind('editRight', 'right');
      bind('editImageUrl', 'imageUrl');
      bind('editCaption', 'caption');
      bind('editHtml', 'html');
    }

    // ---- Toolbar events ----
    document.getElementById('addSlideBtn').addEventListener('click', () => {
      const layout = document.getElementById('layoutSelect').value;
      slides.push({ layout, content: {} });
      currentIndex = slides.length - 1;
      render(); debouncedSave();
    });

    document.getElementById('themeSelect').addEventListener('change', (e) => {
      theme = e.target.value;
      render(); debouncedSave();
    });

    document.getElementById('ratioSelect').addEventListener('change', (e) => {
      aspectRatio = e.target.value;
      render(); debouncedSave();
    });

    document.getElementById('presentBtn').addEventListener('click', startPresentation);
    document.getElementById('pdfBtn').addEventListener('click', exportPDF);
    document.getElementById('htmlBtn').addEventListener('click', downloadHTML);
    document.getElementById('saveBtn').addEventListener('click', () => {
      const entry = librarySave();
      if (entry) {
        const btn = document.getElementById('saveBtn');
        const orig = btn.innerHTML;
        btn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Saved!';
        setTimeout(() => { btn.innerHTML = orig; }, 1500);
      }
    });

    // ---- Presentation mode ----
    function startPresentation() {
      if (slides.length === 0) return;
      const win = window.open('', '_blank');
      if (!win) return;
      const th = themes[theme] || themes.light;
      const ratioCSS = RATIOS[aspectRatio] || '16/9';
      const isPortrait = PORTRAIT_RATIOS.has(aspectRatio);
      const slidesHtml = slides.map((s, i) =>
        `<div class="slide layout-${s.layout}" style="background:${th.bg};">
          ${renderSlideHTML(s, i, slides.length)}
        </div>`
      ).join('');
      win.document.write(buildPresentationHTML(slidesHtml, th, ratioCSS, isPortrait));
      win.document.close();
    }

    function buildPresentationHTML(slidesHtml, th, ratioCSS, isPortrait) {
      // For portrait ratios, center the slide in the viewport
      const slideSize = isPortrait
        ? `width:auto;height:100vh;aspect-ratio:${ratioCSS};max-width:100vw;margin:0 auto;`
        : `width:100vw;height:100vh;`;
      return `<!DOCTYPE html><html><head><meta charset="UTF-8">
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
        <style>
          *{margin:0;padding:0;box-sizing:border-box}
          body{background:#000;overflow:hidden;font-family:'Inter',sans-serif;display:flex;align-items:center;justify-content:center;height:100vh}
          .slide{${slideSize}display:none;flex-direction:column;position:relative;overflow:hidden;color:${th.text}}
          .slide.active{display:flex}
          .slide-inner{flex:1;padding:6vh 6vw;display:flex;flex-direction:column;justify-content:center;overflow:hidden}
          .slide-inner h1{font-size:4vw;font-weight:700;color:${th.heading};margin-bottom:1.5vh;line-height:1.2}
          .slide-inner h2{font-size:2.8vw;font-weight:600;color:${th.heading};margin-bottom:2vh;border-bottom:3px solid ${th.accent};padding-bottom:1vh}
          .slide-inner h3{font-size:2vw;font-weight:600;margin-bottom:1vh}
          .slide-inner p{font-size:1.8vw;line-height:1.6;margin-bottom:1vh}
          .slide-inner ul,.slide-inner ol{font-size:1.8vw;line-height:1.7;padding-left:1.5em;margin-bottom:1vh}
          .slide-inner li{margin-bottom:0.5vh}
          .slide-inner code{background:${th.codeBg};padding:2px 6px;border-radius:3px;font-size:1.5vw;font-family:Consolas,monospace}
          .slide-inner pre{background:${th.codeBg};padding:2vh 2vw;border-radius:8px;overflow-x:auto;margin:1vh 0;font-size:1.4vw}
          .slide-inner pre code{background:none;padding:0}
          .slide-inner a{color:${th.accent}}
          .subtitle{font-size:2.2vw;font-weight:300;color:${th.muted};margin-top:0.5vh}
          .layout-title .slide-inner{justify-content:center;align-items:center;text-align:center}
          .layout-title h1{font-size:5vw;margin-bottom:2vh}
          .layout-title .subtitle{font-size:2.5vw}
          .slide-columns{display:flex;gap:4vw;flex:1}.slide-col{flex:1;overflow:hidden}
          .layout-image img{max-width:80%;max-height:55vh;object-fit:contain;border-radius:8px;margin:1vh auto;display:block}
          .caption{font-size:1.3vw;color:${th.muted};text-align:center;margin-top:1vh}
          .embed-container{flex:1;display:flex;align-items:center;justify-content:center;overflow:hidden;min-height:0}
          .embed-container>svg{max-width:100%;max-height:100%;height:auto}
          .embed-container>img{max-width:100%;max-height:100%;object-fit:contain}
          .slide-footer{padding:1vh 6vw;display:flex;justify-content:space-between;font-size:1.2vw;color:${th.muted};flex-shrink:0}
          .slide-progress{position:absolute;bottom:0;left:0;height:4px;background:${th.accent};transition:width 0.3s}
        </style></head><body>
        ${slidesHtml}
        <script>
          let idx=0;const ss=document.querySelectorAll('.slide');
          function show(i){ss.forEach((s,j)=>s.classList.toggle('active',j===i));}
          show(0);
          document.addEventListener('keydown',e=>{
            if(e.key==='ArrowRight'||e.key===' '){idx=Math.min(idx+1,ss.length-1);show(idx);}
            else if(e.key==='ArrowLeft'){idx=Math.max(idx-1,0);show(idx);}
            else if(e.key==='Escape')window.close();
          });
          document.addEventListener('click',()=>{idx=Math.min(idx+1,ss.length-1);show(idx);});
        <\/script></body></html>`;
    }

    // ---- Export PDF (print) ----
    function exportPDF() {
      if (slides.length === 0) return;
      const th = themes[theme] || themes.light;
      const orient = pageOrientation();
      const printWin = window.open('', '_blank');
      if (!printWin) return;
      const slidesHtml = slides.map((s, i) =>
        `<div class="print-slide" style="background:${th.bg};color:${th.text};">
          <div class="slide-inner" style="flex:1;padding:6vh 6vw;display:flex;flex-direction:column;justify-content:center;">${renderSlideHTML(s, i, slides.length).replace(/<div class="slide-footer">.*?<\/div>/s, '').replace(/<div class="slide-progress".*?<\/div>/s, '')}</div>
          <div style="padding:1vh 6vw;font-size:10px;color:${th.muted};display:flex;justify-content:space-between;"><span>${esc(presentationTitle)}</span><span>${i+1} / ${slides.length}</span></div>
        </div>`
      ).join('');
      printWin.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
        <style>
          @page{size:${orient};margin:0}*{margin:0;padding:0;box-sizing:border-box}
          body{font-family:'Inter',sans-serif}
          .print-slide{width:100vw;height:100vh;page-break-after:always;display:flex;flex-direction:column;overflow:hidden;position:relative}
          .print-slide:last-child{page-break-after:auto}
          .slide-inner h1{font-size:36pt;font-weight:700;color:${th.heading};margin-bottom:12px}
          .slide-inner h2{font-size:24pt;font-weight:600;color:${th.heading};margin-bottom:16px;border-bottom:2px solid ${th.accent};padding-bottom:8px}
          .slide-inner p{font-size:16pt;line-height:1.6;margin-bottom:8px}
          .slide-inner ul,.slide-inner ol{font-size:16pt;line-height:1.7;padding-left:1.5em}
          .slide-inner li{margin-bottom:4px}
          .slide-inner code{background:${th.codeBg};padding:2px 5px;border-radius:3px;font-size:13pt}
          .slide-inner pre{background:${th.codeBg};padding:12px;border-radius:6px;font-size:12pt}
          .subtitle{font-size:18pt;font-weight:300;color:${th.muted}}
          .layout-title .slide-inner{justify-content:center;align-items:center;text-align:center}
          .slide-columns{display:flex;gap:32px;flex:1}.slide-col{flex:1}
          .caption{font-size:11pt;color:${th.muted};text-align:center}
          .embed-container{flex:1;display:flex;align-items:center;justify-content:center;overflow:hidden}
          .embed-container>svg{max-width:100%;max-height:100%;height:auto}
          img{max-width:80%;max-height:50vh;object-fit:contain;margin:8px auto;display:block;border-radius:6px}
        </style></head><body>${slidesHtml}</body></html>`);
      printWin.document.close();
      setTimeout(() => { printWin.print(); }, 500);
    }

    // ---- Export HTML download ----
    function downloadHTML() {
      if (slides.length === 0) return;
      const th = themes[theme] || themes.light;
      const ratioCSS = RATIOS[aspectRatio] || '16/9';
      const isPortrait = PORTRAIT_RATIOS.has(aspectRatio);
      const slidesHtml = slides.map((s, i) =>
        `<div class="slide layout-${s.layout}" style="background:${th.bg};">
          ${renderSlideHTML(s, i, slides.length)}
        </div>`
      ).join('');
      const html = buildPresentationHTML(slidesHtml, th, ratioCSS, isPortrait);
      const blob = new Blob([html], { type: 'text/html' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${presentationTitle || 'presentation'}.html`;
      a.click();
      URL.revokeObjectURL(a.href);
    }

    // ---- Keyboard nav ----
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        if (currentIndex < slides.length - 1) { currentIndex++; render(); }
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        if (currentIndex > 0) { currentIndex--; render(); }
      }
    });

    // ---- State ----
    function debouncedSave() { clearTimeout(stateTimer); stateTimer = setTimeout(save, 500); }
    function save() {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ _v: 2, slides, theme, aspectRatio, presentationTitle, currentIndex })); } catch {}
      const summary = slides.length === 0
        ? 'Slides: empty'
        : `Slides: "${presentationTitle || 'Untitled'}" — ${slides.length} slide(s), ${aspectRatio}, theme: ${theme}`;
      mup.updateState(summary);
    }
    function loadState() {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const d = JSON.parse(stored);
          if (d._v === 2) return d;
          // Migrate from v1
          if (d._v === 1) return { ...d, _v: 2, aspectRatio: '16:9' };
        }
      } catch {}
      return null;
    }

    // ---- Library ----
    const LIBRARY_KEY = 'mup-slides-library';
    const MAX_LIBRARY = 30;

    function loadLibrary() {
      try { return JSON.parse(localStorage.getItem(LIBRARY_KEY) || '[]'); } catch { return []; }
    }
    function saveLibrary(lib) {
      try { localStorage.setItem(LIBRARY_KEY, JSON.stringify(lib)); } catch {}
    }

    function librarySave(nameOverride) {
      if (slides.length === 0) return null;
      const lib = loadLibrary();
      const entry = {
        id: String(Date.now()),
        name: nameOverride || presentationTitle || 'Untitled',
        date: new Date().toISOString(),
        slideCount: slides.length,
        theme, aspectRatio,
        slides: JSON.parse(JSON.stringify(slides)),
        presentationTitle: presentationTitle
      };
      lib.unshift(entry);
      if (lib.length > MAX_LIBRARY) lib.length = MAX_LIBRARY;
      saveLibrary(lib);
      return entry;
    }

    function libraryLoad(id) {
      const lib = loadLibrary();
      return lib.find(e => e.id === id) || null;
    }

    function libraryDelete(id) {
      const lib = loadLibrary();
      const idx = lib.findIndex(e => e.id === id);
      if (idx === -1) return false;
      lib.splice(idx, 1);
      saveLibrary(lib);
      return true;
    }

    function renderLibraryPanel() {
      const list = document.getElementById('libraryList');
      const lib = loadLibrary();
      if (lib.length === 0) {
        list.innerHTML = '<div class="library-empty">No saved presentations</div>';
        return;
      }
      list.innerHTML = '';
      lib.forEach((entry) => {
        const item = document.createElement('div');
        item.className = 'library-item';
        const date = new Date(entry.date);
        const dateStr = date.toLocaleString([], { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
        item.innerHTML = `
          <div class="library-item-info">
            <div class="library-item-title">${esc(entry.name)}</div>
            <div class="library-item-meta">${dateStr} · ${entry.slideCount} slides · ${entry.theme} · ${entry.aspectRatio}</div>
          </div>
          <button class="library-item-delete" title="Delete">&times;</button>
        `;
        item.querySelector('.library-item-info').addEventListener('click', () => {
          slides = JSON.parse(JSON.stringify(entry.slides));
          theme = entry.theme || 'light';
          aspectRatio = entry.aspectRatio || '16:9';
          presentationTitle = entry.presentationTitle || entry.name;
          currentIndex = 0;
          render(); save();
          document.getElementById('themeSelect').value = theme;
          document.getElementById('ratioSelect').value = aspectRatio;
          document.getElementById('libraryPanel').classList.remove('open');
        });
        item.querySelector('.library-item-delete').addEventListener('click', (e) => {
          e.stopPropagation();
          libraryDelete(entry.id);
          renderLibraryPanel();
        });
        list.appendChild(item);
      });
    }

    // Wire up library UI
    document.getElementById('libraryBtn').addEventListener('click', () => {
      const panel = document.getElementById('libraryPanel');
      panel.classList.toggle('open');
      if (panel.classList.contains('open')) renderLibraryPanel();
    });
    document.getElementById('libraryCloseBtn').addEventListener('click', () => {
      document.getElementById('libraryPanel').classList.remove('open');
    });
    document.getElementById('librarySaveBtn').addEventListener('click', () => {
      const entry = librarySave();
      if (entry) renderLibraryPanel();
    });

    // ---- MUP functions ----
    mup.registerFunction('createPresentation', ({ title, subtitle, theme: t, aspectRatio: ar }) => {
      presentationTitle = title;
      if (t) theme = t;
      if (ar) aspectRatio = ar;
      slides = [{ layout: 'title', content: { title, subtitle: subtitle || '' } }];
      currentIndex = 0;
      render(); save();
      return { content: [{ type: 'text', text: `Created presentation "${title}" with title slide. Theme: ${theme}, ratio: ${aspectRatio}.` }], isError: false };
    });

    mup.registerFunction('addSlide', ({ layout, content }) => {
      slides.push({ layout, content: content || {} });
      currentIndex = slides.length - 1;
      render(); save();
      return { content: [{ type: 'text', text: `Added ${layout} slide (index ${currentIndex}). Total: ${slides.length}.` }], isError: false };
    });

    mup.registerFunction('updateSlide', ({ index, layout, content }) => {
      if (index < 0 || index >= slides.length) return { content: [{ type: 'text', text: `Index ${index} out of range (0-${slides.length - 1}).` }], isError: true };
      if (layout) slides[index].layout = layout;
      if (content) Object.assign(slides[index].content, content);
      currentIndex = index;
      render(); save();
      return { content: [{ type: 'text', text: `Updated slide ${index}.` }], isError: false };
    });

    mup.registerFunction('removeSlide', ({ index }) => {
      if (index < 0 || index >= slides.length) return { content: [{ type: 'text', text: `Index ${index} out of range.` }], isError: true };
      slides.splice(index, 1);
      if (currentIndex >= slides.length) currentIndex = Math.max(0, slides.length - 1);
      render(); save();
      return { content: [{ type: 'text', text: `Removed slide ${index}. ${slides.length} remaining.` }], isError: false };
    });

    mup.registerFunction('getSlides', () => {
      if (slides.length === 0) return { content: [{ type: 'text', text: 'No slides.' }], isError: false };
      const lines = slides.map((s, i) => `[${i}] ${s.layout}: ${s.content?.title || s.content?.body?.slice(0,50) || '(empty)'}`);
      return { content: [{ type: 'text', text: `"${presentationTitle}" (${theme} theme, ${aspectRatio}, ${slides.length} slides):\n${lines.join('\n')}` }], isError: false };
    });

    mup.registerFunction('setTheme', ({ theme: t }) => {
      theme = t;
      render(); save();
      return { content: [{ type: 'text', text: `Theme set to "${t}".` }], isError: false };
    });

    mup.registerFunction('setAspectRatio', ({ aspectRatio: ar }) => {
      if (!RATIOS[ar]) return { content: [{ type: 'text', text: `Unknown ratio "${ar}". Use: ${Object.keys(RATIOS).join(', ')}.` }], isError: true };
      aspectRatio = ar;
      render(); save();
      return { content: [{ type: 'text', text: `Aspect ratio set to ${ar}.` }], isError: false };
    });

    mup.registerFunction('embedContent', ({ html, title, caption }) => {
      slides.push({ layout: 'embed', content: { html: html || '', title: title || '', caption: caption || '' } });
      currentIndex = slides.length - 1;
      render(); save();
      return { content: [{ type: 'text', text: `Added embed slide (index ${currentIndex}). Total: ${slides.length}.` }], isError: false };
    });

    mup.registerFunction('exportHTML', () => {
      if (slides.length === 0) return { content: [{ type: 'text', text: 'No slides to export.' }], isError: true };
      downloadHTML();
      return { content: [{ type: 'text', text: `Exported "${presentationTitle || 'presentation'}.html" (${slides.length} slides).` }], isError: false };
    });

    mup.registerFunction('saveToLibrary', ({ name }) => {
      if (slides.length === 0) return { content: [{ type: 'text', text: 'No slides to save.' }], isError: true };
      const entry = librarySave(name);
      return { content: [{ type: 'text', text: `Saved "${entry.name}" to library (${entry.slideCount} slides). ID: ${entry.id}` }], isError: false };
    });

    mup.registerFunction('listLibrary', () => {
      const lib = loadLibrary();
      if (lib.length === 0) return { content: [{ type: 'text', text: 'Library is empty.' }], isError: false };
      const lines = lib.map(e => {
        const date = new Date(e.date).toLocaleString([], { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
        return `[${e.id}] "${e.name}" — ${e.slideCount} slides, ${e.theme}, ${e.aspectRatio} (${date})`;
      });
      return { content: [{ type: 'text', text: `${lib.length} saved presentation(s):\n${lines.join('\n')}` }], isError: false };
    });

    mup.registerFunction('loadFromLibrary', ({ id }) => {
      const entry = libraryLoad(id);
      if (!entry) return { content: [{ type: 'text', text: `Presentation "${id}" not found in library.` }], isError: true };
      slides = JSON.parse(JSON.stringify(entry.slides));
      theme = entry.theme || 'light';
      aspectRatio = entry.aspectRatio || '16:9';
      presentationTitle = entry.presentationTitle || entry.name;
      currentIndex = 0;
      render(); save();
      document.getElementById('themeSelect').value = theme;
      document.getElementById('ratioSelect').value = aspectRatio;
      return { content: [{ type: 'text', text: `Loaded "${entry.name}" (${entry.slideCount} slides).` }], isError: false };
    });

    mup.registerFunction('deleteFromLibrary', ({ id }) => {
      const ok = libraryDelete(id);
      if (!ok) return { content: [{ type: 'text', text: `Presentation "${id}" not found.` }], isError: true };
      return { content: [{ type: 'text', text: `Deleted presentation ${id} from library.` }], isError: false };
    });

    // ---- Slide Preview (Screenshot) ----
    mup.registerFunction('getSlidePreview', async ({ index }) => {
      const idx = index ?? currentIndex;
      if (idx < 0 || idx >= slides.length) {
        return { content: [{ type: 'text', text: `Slide index ${idx} out of range (0-${slides.length - 1}).` }], isError: true };
      }

      const slide = slides[idx];
      const th = themes[theme] || themes.light;
      const [designW, designH] = DESIGN_SIZES[aspectRatio] || DESIGN_SIZES['16:9'];

      // Create offscreen container at design size (same as live render)
      const container = document.createElement('div');
      container.style.cssText = `position:fixed;left:-9999px;top:-9999px;width:${designW}px;height:${designH}px;overflow:hidden;z-index:-1;`;
      document.body.appendChild(container);

      const frame = document.createElement('div');
      frame.className = `slide-frame layout-${slide.layout}`;
      frame.style.cssText = `width:${designW}px;height:${designH}px;background:${th.bg};
        --slide-bg:${th.bg};--slide-text:${th.text};--slide-heading:${th.heading};
        --slide-accent:${th.accent};--slide-muted:${th.muted};--slide-code-bg:${th.codeBg};
        border-radius:0;box-shadow:none;`;
      frame.innerHTML = renderSlideHTML(slide, idx, slides.length);
      container.appendChild(frame);

      try {
        await new Promise(r => setTimeout(r, 200));

        const canvas = await html2canvas(frame, {
          width: designW, height: designH, scale: 1,
          useCORS: true, backgroundColor: th.bg,
        });

        const dataUrl = canvas.toDataURL('image/png');
        const base64 = dataUrl.split(',')[1];

        return {
          content: [
            { type: 'image', data: base64, mimeType: 'image/png' },
            { type: 'text', text: `Preview of slide ${idx + 1}/${slides.length} "${slide.content?.title || slide.layout}" (${designW}×${designH})` }
          ],
          isError: false
        };
      } catch (err) {
        return { content: [{ type: 'text', text: `Screenshot failed: ${err.message}` }], isError: true };
      } finally {
        document.body.removeChild(container);
      }
    });

    // ---- Init ----
    mup.onThemeChange(applyEditorTheme);
    mup.onReady((params) => {
      if (params?.theme) applyEditorTheme(params.theme);
      const state = loadState();
      if (state) {
        slides = state.slides || [];
        theme = state.theme || 'light';
        aspectRatio = state.aspectRatio || '16:9';
        presentationTitle = state.presentationTitle || '';
        currentIndex = state.currentIndex || 0;
        if (currentIndex >= slides.length) currentIndex = 0;
      }
      render(); save();
    });

    // Re-scale slides when panel is resized
    new ResizeObserver(() => { if (slides.length > 0) render(); })
      .observe(document.getElementById('canvasArea'));
