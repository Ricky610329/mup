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

    // ---- Theme variable resolver (for present/export where CSS vars don't work in SVG) ----
    function resolveThemeVars(html, th) {
      return html
        .replace(/var\(--slide-bg\)/g, th.bg)
        .replace(/var\(--slide-text\)/g, th.text)
        .replace(/var\(--slide-heading\)/g, th.heading)
        .replace(/var\(--slide-accent\)/g, th.accent)
        .replace(/var\(--slide-muted\)/g, th.muted)
        .replace(/var\(--slide-code-bg\)/g, th.codeBg);
    }

    // ---- Chart Engine ----
    function niceNum(value, round) {
      const exp = Math.floor(Math.log10(Math.abs(value) || 1));
      const frac = value / Math.pow(10, exp);
      let nice;
      if (round) {
        nice = frac < 1.5 ? 1 : frac < 3 ? 2 : frac < 7 ? 5 : 10;
      } else {
        nice = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
      }
      return nice * Math.pow(10, exp);
    }

    function niceScale(dMin, dMax, ticks) {
      const range = niceNum(dMax - dMin || 1, false);
      const step = niceNum(range / (ticks - 1), true);
      const nMin = Math.floor(dMin / step) * step;
      const nMax = Math.ceil(dMax / step) * step;
      return { min: nMin, max: nMax, step };
    }

    function chartPalette(th) {
      return [th.accent, '#10b981', '#ec4899', '#f59e0b', '#8b5cf6', '#06b6d4', '#ef4444', '#14b8a6'];
    }

    function generateChart(type, data, options, th) {
      const opts = options || {};
      const palette = chartPalette(th);
      if (type === 'line') return generateLineChart(data, opts, th, palette);
      if (type === 'bar') return generateBarChart(data, opts, th, palette);
      if (type === 'pie') return generatePieChart(data, opts, th, palette);
      return `<svg viewBox="0 0 800 400"><text x="400" y="200" text-anchor="middle" fill="${th.muted}">Unknown chart type: ${type}</text></svg>`;
    }

    function renderLegend(datasets, palette, opts, th, W, padL, padR, padT, padB, H, isLine) {
      if (opts.showLegend === false || datasets.length <= 1) return '';
      let svg = '';
      const pos = opts.legendPosition || 'top';
      if (pos === 'bottom') {
        const totalW = datasets.reduce((s, ds) => s + ds.label.length * 7 + 30, 0);
        let lx = (W - totalW) / 2;
        datasets.forEach((ds, di) => {
          const color = palette[di % palette.length];
          const y = H - 12;
          if (isLine) {
            const dashed = ds.style === 'dashed';
            svg += `<line x1="${lx}" y1="${y}" x2="${lx + 20}" y2="${y}" stroke="${color}" stroke-width="2.5"${dashed ? ' stroke-dasharray="6,3"' : ''}/>`;
          } else {
            svg += `<rect x="${lx}" y="${y - 6}" width="12" height="12" rx="2" fill="${color}" opacity="0.85"/>`;
          }
          svg += `<text x="${lx + (isLine ? 26 : 18)}" y="${y + 4}" fill="${th.text}" font-size="11">${ds.label}</text>`;
          lx += ds.label.length * 7 + 36;
        });
      } else if (pos === 'right') {
        const lx = W - padR - 100;
        datasets.forEach((ds, di) => {
          const y = padT + 10 + di * 20;
          const color = palette[di % palette.length];
          if (isLine) {
            const dashed = ds.style === 'dashed';
            svg += `<line x1="${lx}" y1="${y}" x2="${lx + 16}" y2="${y}" stroke="${color}" stroke-width="2.5"${dashed ? ' stroke-dasharray="6,3"' : ''}/>`;
          } else {
            svg += `<rect x="${lx}" y="${y - 6}" width="12" height="12" rx="2" fill="${color}" opacity="0.85"/>`;
          }
          svg += `<text x="${lx + (isLine ? 22 : 18)}" y="${y + 4}" fill="${th.text}" font-size="10">${ds.label}</text>`;
        });
      } else { // top (default)
        let lx = padL + 10;
        datasets.forEach((ds, di) => {
          const y = padT - 10;
          const color = palette[di % palette.length];
          if (isLine) {
            const dashed = ds.style === 'dashed';
            svg += `<line x1="${lx}" y1="${y}" x2="${lx + 20}" y2="${y}" stroke="${color}" stroke-width="2.5"${dashed ? ' stroke-dasharray="6,3"' : ''}/>`;
          } else {
            svg += `<rect x="${lx}" y="${y - 6}" width="12" height="12" rx="2" fill="${color}" opacity="0.85"/>`;
          }
          svg += `<text x="${lx + (isLine ? 26 : 18)}" y="${y + 4}" fill="${th.text}" font-size="11">${ds.label}</text>`;
          lx += ds.label.length * 7 + 36;
        });
      }
      return svg;
    }

    function renderAnnotations(annotations, th) {
      if (!annotations || !annotations.length) return '';
      let svg = '';
      annotations.forEach(a => {
        const color = a.color || th.accent;
        svg += `<text x="${a.x}" y="${a.y}" text-anchor="${a.anchor || 'start'}" fill="${color}" font-size="${a.fontSize || 11}" font-weight="${a.bold ? '600' : '400'}">${a.text}</text>`;
        if (a.lineToX !== undefined && a.lineToY !== undefined) {
          svg += `<line x1="${a.x}" y1="${a.y + 2}" x2="${a.lineToX}" y2="${a.lineToY}" stroke="${color}" stroke-width="1" opacity="0.6"/>`;
        }
      });
      return svg;
    }

    function generateLineChart(data, opts, th, palette) {
      const W = 800, H = 400, padL = 70, padR = 30, padT = 40, padB = 60;
      const labels = data.labels || [];
      const datasets = data.datasets || [];
      const allVals = datasets.flatMap(d => d.values);
      const dataMin = Math.min(...allVals);
      const dataMax = Math.max(...allVals);
      const nice = niceScale(
        opts.yMin ?? dataMin,
        opts.yMax ?? dataMax,
        6
      );
      const yMin = opts.yMin ?? nice.min;
      const yMax = opts.yMax ?? nice.max;
      const yStep = nice.step;
      const yRange = yMax - yMin || 1;
      const chartW = W - padL - padR;
      const chartH = H - padT - padB;
      const suffix = opts.ySuffix || '';
      const toX = (i) => padL + (labels.length > 1 ? i / (labels.length - 1) : 0.5) * chartW;
      const toY = (v) => padT + chartH - ((v - yMin) / yRange) * chartH;

      let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;font-family:system-ui,sans-serif">`;
      // Grid lines with nice ticks
      for (let v = yMin; v <= yMax + yStep * 0.01; v += yStep) {
        const y = toY(v);
        svg += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="${th.muted}" stroke-width="0.5" opacity="0.3"/>`;
        svg += `<text x="${padL - 8}" y="${y + 4}" text-anchor="end" fill="${th.muted}" font-size="11">${Math.round(v)}${suffix}</text>`;
      }
      // X axis labels
      labels.forEach((label, i) => {
        svg += `<text x="${toX(i)}" y="${H - padB + 20}" text-anchor="middle" fill="${th.muted}" font-size="11">${label}</text>`;
      });
      // Lines + dots
      datasets.forEach((ds, di) => {
        const color = palette[di % palette.length];
        const dashed = ds.style === 'dashed' ? ' stroke-dasharray="8,4"' : '';
        const points = ds.values.map((v, i) => `${toX(i)},${toY(v)}`);
        svg += `<polyline points="${points.join(' ')}" fill="none" stroke="${color}" stroke-width="2.5"${dashed}/>`;
        ds.values.forEach((v, i) => {
          svg += `<circle cx="${toX(i)}" cy="${toY(v)}" r="4" fill="${color}" stroke="${th.bg}" stroke-width="2"/>`;
          if (opts.showValues) {
            svg += `<text x="${toX(i)}" y="${toY(v) - 10}" text-anchor="middle" fill="${color}" font-size="11" font-weight="600">${v}${suffix}</text>`;
          }
        });
      });
      svg += renderLegend(datasets, palette, opts, th, W, padL, padR, padT, padB, H, true);
      svg += renderAnnotations(opts.annotations, th);
      svg += '</svg>';
      return svg;
    }

    function generateBarChart(data, opts, th, palette) {
      const W = 800, H = 400, padL = 70, padR = 30, padT = 30, padB = 60;
      const labels = data.labels || [];
      const datasets = data.datasets || [];
      const stacked = opts.stacked || false;
      const allVals = stacked
        ? labels.map((_, i) => datasets.reduce((sum, ds) => sum + (ds.values[i] || 0), 0))
        : datasets.flatMap(d => d.values);
      const dataMax = Math.max(...allVals, 0);
      const nice = niceScale(opts.yMin ?? 0, opts.yMax ?? dataMax, 6);
      const yMin = opts.yMin ?? nice.min;
      const yMax = opts.yMax ?? nice.max;
      const yStep = nice.step;
      const yRange = yMax - yMin || 1;
      const chartW = W - padL - padR;
      const chartH = H - padT - padB;
      const suffix = opts.ySuffix || '';
      const toY = (v) => padT + chartH - ((v - yMin) / yRange) * chartH;
      const groupW = chartW / labels.length;
      const gap = groupW * 0.2;
      const barGroupW = groupW - gap;

      let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;font-family:system-ui,sans-serif">`;
      // Grid with nice ticks
      for (let v = yMin; v <= yMax + yStep * 0.01; v += yStep) {
        const y = toY(v);
        svg += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="${th.muted}" stroke-width="0.5" opacity="0.3"/>`;
        svg += `<text x="${padL - 8}" y="${y + 4}" text-anchor="end" fill="${th.muted}" font-size="11">${Math.round(v)}${suffix}</text>`;
      }
      // Bars
      labels.forEach((label, gi) => {
        const groupX = padL + gi * groupW + gap / 2;
        if (stacked) {
          let cumY = 0;
          datasets.forEach((ds, di) => {
            const v = ds.values[gi] || 0;
            const color = palette[di % palette.length];
            const barH = (v / yRange) * chartH;
            const y = toY(yMin + cumY + v);
            svg += `<rect x="${groupX}" y="${y}" width="${barGroupW}" height="${barH}" rx="3" fill="${color}" opacity="0.85"/>`;
            cumY += v;
          });
        } else {
          const barW = barGroupW / datasets.length;
          datasets.forEach((ds, di) => {
            const v = ds.values[gi] || 0;
            const color = palette[di % palette.length];
            const x = groupX + di * barW;
            const barH = ((v - yMin) / yRange) * chartH;
            const y = toY(v);
            svg += `<rect x="${x}" y="${y}" width="${barW - 2}" height="${barH}" rx="3" fill="${color}" opacity="0.85"/>`;
            if (opts.showValues) {
              svg += `<text x="${x + barW / 2 - 1}" y="${y - 5}" text-anchor="middle" fill="${color}" font-size="10" font-weight="600">${v}${suffix}</text>`;
            }
          });
        }
        svg += `<text x="${groupX + barGroupW / 2}" y="${H - padB + 20}" text-anchor="middle" fill="${th.muted}" font-size="11">${label}</text>`;
      });
      svg += renderLegend(datasets, palette, opts, th, W, padL, padR, padT, padB, H, false);
      svg += renderAnnotations(opts.annotations, th);
      svg += '</svg>';
      return svg;
    }

    function generatePieChart(data, opts, th, palette) {
      const W = 800, H = 400;
      const cx = W / 2, cy = H / 2;
      const R = 140;
      const innerR = opts.donut ? R * 0.55 : 0;
      const labels = data.labels || [];
      const ds = (data.datasets && data.datasets[0]) || { values: [] };
      const values = ds.values || [];
      const total = values.reduce((a, b) => a + b, 0) || 1;

      let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;font-family:system-ui,sans-serif">`;
      let startAngle = -Math.PI / 2;
      values.forEach((v, i) => {
        const sliceAngle = (v / total) * Math.PI * 2;
        const endAngle = startAngle + sliceAngle;
        const midAngle = startAngle + sliceAngle / 2;
        const color = palette[i % palette.length];
        const largeArc = sliceAngle > Math.PI ? 1 : 0;
        // Outer arc
        const x1 = cx + R * Math.cos(startAngle), y1 = cy + R * Math.sin(startAngle);
        const x2 = cx + R * Math.cos(endAngle), y2 = cy + R * Math.sin(endAngle);
        let d;
        if (innerR > 0) {
          const ix1 = cx + innerR * Math.cos(endAngle), iy1 = cy + innerR * Math.sin(endAngle);
          const ix2 = cx + innerR * Math.cos(startAngle), iy2 = cy + innerR * Math.sin(startAngle);
          d = `M${x1},${y1} A${R},${R} 0 ${largeArc},1 ${x2},${y2} L${ix1},${iy1} A${innerR},${innerR} 0 ${largeArc},0 ${ix2},${iy2} Z`;
        } else {
          d = `M${cx},${cy} L${x1},${y1} A${R},${R} 0 ${largeArc},1 ${x2},${y2} Z`;
        }
        svg += `<path d="${d}" fill="${color}" opacity="0.85" stroke="${th.bg}" stroke-width="2"/>`;
        // Label
        const labelR = R + 24;
        const lx = cx + labelR * Math.cos(midAngle);
        const ly = cy + labelR * Math.sin(midAngle);
        const anchor = lx > cx ? 'start' : lx < cx ? 'end' : 'middle';
        const pct = Math.round(v / total * 100);
        svg += `<text x="${lx}" y="${ly - 2}" text-anchor="${anchor}" fill="${th.text}" font-size="12" font-weight="600">${labels[i] || ''}</text>`;
        svg += `<text x="${lx}" y="${ly + 13}" text-anchor="${anchor}" fill="${th.muted}" font-size="11">${pct}%</text>`;
        startAngle = endAngle;
      });
      // Donut center
      if (opts.donut && ds.label) {
        svg += `<text x="${cx}" y="${cy + 5}" text-anchor="middle" fill="${th.heading}" font-size="16" font-weight="700">${ds.label}</text>`;
      }
      svg += '</svg>';
      return svg;
    }

    function generateTable(headers, rows, th, body, bodyPosition) {
      const borderColor = th.codeBg;
      const accentColor = th.accent;
      const hasBody = body && body.trim();
      const pos = bodyPosition || 'side';
      const isSide = pos === 'side' && hasBody;
      const wrapper = isSide
        ? `<div style="font-family:system-ui,sans-serif;padding:12px 24px;display:flex;gap:32px;align-items:flex-start">`
        : `<div style="font-family:system-ui,sans-serif;padding:12px 24px">`;
      let html = wrapper;
      if (hasBody) {
        const bodyStyle = isSide
          ? `flex:1;min-width:0;color:${th.text};font-size:15px;line-height:1.7`
          : `color:${th.text};font-size:15px;line-height:1.7;margin-bottom:16px`;
        html += `<div style="${bodyStyle}">${md(body)}</div>`;
      }
      const tableWidth = isSide ? 'flex:1.2;min-width:0' : 'width:100%';
      html += `<div style="${tableWidth}"><table style="width:100%;border-collapse:separate;border-spacing:0;font-size:15px">`;
      // Header
      html += '<thead><tr>';
      headers.forEach((h, i) => {
        const isFirst = i === 0;
        const border = i === 1 ? `border-bottom:2px solid ${accentColor}` : `border-bottom:2px solid ${th.muted}`;
        const color = i === 1 ? accentColor : th.muted;
        const weight = i === 1 ? '700' : '600';
        const align = isFirst ? 'text-align:left' : 'text-align:center';
        const pad = hasBody ? '7px 12px' : '11px 16px';
        html += `<th style="${align};padding:${pad};${border};color:${color};font-weight:${weight};font-size:${i === 1 ? '15px' : '14px'}">${h}</th>`;
      });
      html += '</tr></thead><tbody>';
      // Rows
      rows.forEach((row, ri) => {
        html += '<tr>';
        row.forEach((cell, ci) => {
          const isLast = ri === rows.length - 1;
          const border = isLast ? '' : `border-bottom:1px solid ${borderColor}`;
          const isFirst = ci === 0;
          const cellPad = hasBody ? '7px 12px' : '11px 16px';
          let cellStyle = `padding:${cellPad};${border};`;
          if (isFirst) {
            cellStyle += `font-weight:600;color:${th.text};text-align:left;`;
          } else {
            cellStyle += 'text-align:center;font-size:17px;';
          }
          // Auto-color ✔/✘
          let content = cell;
          if (cell === '✔' || cell === '✓') content = `<span style="color:#16a34a">${cell}</span>`;
          else if (cell === '✘' || cell === '✗' || cell === '×') content = `<span style="color:#dc2626">${cell}</span>`;
          else if (!isFirst) cellStyle += `color:${th.text};font-size:14px;`;
          html += `<td style="${cellStyle}">${content}</td>`;
        });
        html += '</tr>';
      });
      html += '</tbody></table></div></div>';
      return html;
    }

    function rerenderCharts() {
      const th = themes[theme] || themes.light;
      slides.forEach(s => {
        if (s._chart) {
          s.content.html = generateChart(s._chart.type, s._chart.data, s._chart.options, th);
        }
        if (s._table) {
          s.content.html = generateTable(s._table.headers, s._table.rows, th, s._table.body, s._table.bodyPosition);
        }
      });
    }

    function resolveImg(url) {
      if (!url) return '';
      return mup.resolveAssetUrl ? mup.resolveAssetUrl(url) : url;
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
          inner = `${c.title ? `<h2>${esc(c.title)}</h2>` : ''}${c.imageUrl ? `<img src="${esc(resolveImg(c.imageUrl))}" alt="">` : ''}<div class="caption">${esc(c.caption || '')}</div>`;
          break;
        case 'section':
          inner = `<div class="section-divider"><div class="section-line"></div><h1>${esc(c.title || '')}</h1>${c.subtitle ? `<div class="subtitle">${marked.parseInline(c.subtitle)}</div>` : ''}</div>`;
          break;
        case 'embed':
          inner = `${c.title ? `<h2>${esc(c.title)}</h2>` : ''}<div class="embed-container">${c.html || ''}</div>${c.caption ? `<div class="caption">${esc(c.caption)}</div>` : ''}`;
          break;
        case 'image-text': {
          const pos = c.imagePosition || 'left';
          const isVert = pos === 'top' || pos === 'bottom';
          const imgFirst = pos === 'left' || pos === 'top';
          const imgHtml = c.imageUrl ? `<div class="it-image"><img src="${esc(resolveImg(c.imageUrl))}" alt=""></div>` : '';
          const textHtml = `<div class="it-text">${c.title ? `<h2>${esc(c.title)}</h2>` : ''}${marked.parse(c.body || '')}</div>`;
          inner = `<div class="image-text-layout ${isVert ? 'vertical' : 'horizontal'}">${imgFirst ? imgHtml + textHtml : textHtml + imgHtml}</div>`;
          break;
        }
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
    function renderThumbnails() {
      const listEl = document.getElementById('slideList');
      listEl.innerHTML = '';
      const [designW, designH] = DESIGN_SIZES[aspectRatio] || DESIGN_SIZES['16:9'];
      const th = themes[theme] || themes.light;
      slides.forEach((s, i) => {
        const thumb = document.createElement('div');
        thumb.className = 'slide-thumb' + (i === currentIndex ? ' active' : '');
        const slideHtml = renderSlideHTML(s, i, slides.length);
        thumb.innerHTML = `<span class="slide-thumb-num">${i + 1}</span>
          <div class="slide-thumb-preview"><div class="slide-thumb-inner layout-${s.layout}" style="width:${designW}px;height:${designH}px;background:${th.bg};">${slideHtml}</div></div>
          <button class="slide-thumb-delete">&times;</button>`;
        requestAnimationFrame(() => {
          const preview = thumb.querySelector('.slide-thumb-preview');
          const inner = thumb.querySelector('.slide-thumb-inner');
          if (preview && inner) {
            const scale = preview.offsetWidth / designW;
            inner.style.transform = `scale(${scale})`;
          }
        });
        thumb.addEventListener('click', () => { currentIndex = i; render(); });
        thumb.querySelector('.slide-thumb-delete').addEventListener('click', (e) => {
          e.stopPropagation();
          slides.splice(i, 1);
          if (currentIndex >= slides.length) currentIndex = Math.max(0, slides.length - 1);
          render(); debouncedSave();
        });
        listEl.appendChild(thumb);
      });
    }

    function renderCanvas() {
      const canvasArea = document.getElementById('canvasArea');
      const slide = slides[currentIndex];
      const [designW, designH] = DESIGN_SIZES[aspectRatio] || DESIGN_SIZES['16:9'];
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
      frame.className = `slide-frame layout-${slide.layout}`;
      frame.style.width = designW + 'px';
      frame.style.height = designH + 'px';
      frame.style.background = themes[theme]?.bg || '#fff';
      frame.innerHTML = renderSlideHTML(slide, currentIndex, slides.length);

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
    }

    function render() {
      applySlideTheme(theme);
      applyAspectRatio(aspectRatio);
      document.getElementById('themeSelect').value = theme;
      document.getElementById('ratioSelect').value = aspectRatio;
      document.getElementById('slideInfo').textContent = `${slides.length} slide${slides.length !== 1 ? 's' : ''}`;
      renderThumbnails();
      const canvasArea = document.getElementById('canvasArea');
      const editPanel = document.getElementById('editPanel');
      if (slides.length === 0) {
        canvasArea.innerHTML = `<div class="empty-state"><span>No slides yet</span><span style="font-size:11px">Click <b>+ Slide</b> or let the agent create a presentation</span></div>`;
        editPanel.style.display = 'none';
        return;
      }
      editPanel.style.display = 'flex';
      renderCanvas();
      renderEditPanel(slides[currentIndex]);
    }

    function renderEditPanel(slide) {
      const panel = document.getElementById('editPanel');
      const c = slide.content || {};
      let html = `<div class="edit-group"><div class="edit-label">LAYOUT</div>
        <select class="edit-input" id="editLayout">
          ${['title','section','content','two-column','image','image-text','embed','blank'].map(l => `<option value="${l}"${l===slide.layout?' selected':''}>${l}</option>`).join('')}
        </select></div>`;

      if (slide.layout !== 'blank') {
        html += `<div class="edit-group"><div class="edit-label">TITLE</div>
          <input class="edit-input" id="editTitle" value="${esc(c.title||'')}" placeholder="Slide title..."></div>`;
      }
      if (slide.layout === 'title' || slide.layout === 'section') {
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
      if (slide.layout === 'image-text') {
        html += `<div class="edit-group"><div class="edit-label">IMAGE URL</div>
          <input class="edit-input" id="editImageUrl" value="${esc(c.imageUrl||'')}" placeholder="https://..."></div>
          <div class="edit-group"><div class="edit-label">BODY (markdown)</div>
          <textarea class="edit-textarea" id="editBody" rows="8" placeholder="Text content...">${esc(c.body||'')}</textarea></div>
          <div class="edit-group"><div class="edit-label">IMAGE POSITION</div>
          <select class="edit-input" id="editImagePosition">
            ${['left','right','top','bottom'].map(p => `<option value="${p}"${p===(c.imagePosition||'left')?' selected':''}>${p}</option>`).join('')}
          </select></div>`;
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
          renderCanvas(); renderThumbnails(); debouncedSave();
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
      const imgPosEl = panel.querySelector('#editImagePosition');
      if (imgPosEl) imgPosEl.addEventListener('change', () => {
        slide.content.imagePosition = imgPosEl.value;
        renderCanvas(); renderThumbnails(); debouncedSave();
      });
    }

    // ---- Confirm dialog ----
    let confirmCallback = null;
    function showConfirm(title, msg, onOk) {
      document.getElementById('confirmTitle').textContent = title;
      document.getElementById('confirmMsg').textContent = msg;
      confirmCallback = onOk;
      document.getElementById('confirmOverlay').classList.add('open');
    }
    function hideConfirm() {
      document.getElementById('confirmOverlay').classList.remove('open');
      confirmCallback = null;
    }
    document.getElementById('confirmOk').addEventListener('click', () => {
      const cb = confirmCallback;
      hideConfirm();
      if (cb) cb();
    });
    document.getElementById('confirmCancel').addEventListener('click', hideConfirm);
    document.getElementById('confirmOverlay').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) hideConfirm();
    });

    // ---- New presentation ----
    function newPresentation() {
      slides = [];
      currentIndex = 0;
      presentationTitle = '';
      theme = 'light';
      aspectRatio = '16:9';
      render(); save();
    }
    document.getElementById('newBtn').addEventListener('click', () => {
      if (slides.length === 0) return;
      showConfirm(
        'New Presentation',
        'Current slides will be discarded. Make sure to save first if needed.',
        newPresentation
      );
    });

    // ---- Toolbar events ----
    document.getElementById('addSlideBtn').addEventListener('click', () => {
      const layout = document.getElementById('layoutSelect').value;
      slides.push({ layout, content: {} });
      currentIndex = slides.length - 1;
      render(); debouncedSave();
    });

    document.getElementById('themeSelect').addEventListener('change', (e) => {
      theme = e.target.value;
      rerenderCharts();
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
      const slidesHtml = slides.map((s, i) => {
        const html = resolveThemeVars(renderSlideHTML(s, i, slides.length), th);
        return `<div class="slide layout-${s.layout}" style="background:${th.bg};">${html}</div>`;
      }).join('');
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
          :root{--slide-bg:${th.bg};--slide-text:${th.text};--slide-heading:${th.heading};--slide-accent:${th.accent};--slide-muted:${th.muted};--slide-code-bg:${th.codeBg}}
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
      const slidesHtml = slides.map((s, i) => {
        const slideContent = resolveThemeVars(
          renderSlideHTML(s, i, slides.length)
            .replace(/<div class="slide-footer">.*?<\/div>/s, '')
            .replace(/<div class="slide-progress".*?<\/div>/s, ''),
          th
        );
        return `<div class="print-slide" style="background:${th.bg};color:${th.text};">
          <div class="slide-inner" style="flex:1;padding:6vh 6vw;display:flex;flex-direction:column;justify-content:center;">${slideContent}</div>
          <div style="padding:1vh 6vw;font-size:10px;color:${th.muted};display:flex;justify-content:space-between;"><span>${esc(presentationTitle)}</span><span>${i+1} / ${slides.length}</span></div>
        </div>`;
      }
      ).join('');
      printWin.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
        <style>
          :root{--slide-bg:${th.bg};--slide-text:${th.text};--slide-heading:${th.heading};--slide-accent:${th.accent};--slide-muted:${th.muted};--slide-code-bg:${th.codeBg}}
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
      const slidesHtml = slides.map((s, i) => {
        const html = resolveThemeVars(renderSlideHTML(s, i, slides.length), th);
        return `<div class="slide layout-${s.layout}" style="background:${th.bg};">${html}</div>`;
      }).join('');
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

    mup.registerFunction('moveSlide', ({ from, to }) => {
      if (from < 0 || from >= slides.length) return { content: [{ type: 'text', text: `Source index ${from} out of range (0-${slides.length - 1}).` }], isError: true };
      if (to < 0 || to >= slides.length) return { content: [{ type: 'text', text: `Target index ${to} out of range (0-${slides.length - 1}).` }], isError: true };
      const [slide] = slides.splice(from, 1);
      slides.splice(to, 0, slide);
      currentIndex = to;
      render(); save();
      return { content: [{ type: 'text', text: `Moved slide ${from} → ${to}. Current order: ${slides.length} slides.` }], isError: false };
    });

    mup.registerFunction('getSlides', () => {
      if (slides.length === 0) return { content: [{ type: 'text', text: 'No slides.' }], isError: false };
      const lines = slides.map((s, i) => `[${i}] ${s.layout}: ${s.content?.title || s.content?.body?.slice(0,50) || '(empty)'}`);
      return { content: [{ type: 'text', text: `"${presentationTitle}" (${theme} theme, ${aspectRatio}, ${slides.length} slides):\n${lines.join('\n')}` }], isError: false };
    });

    mup.registerFunction('setTheme', ({ theme: t }) => {
      theme = t;
      rerenderCharts();
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

    mup.registerFunction('addTable', ({ title, caption, headers, rows, body, bodyPosition }) => {
      if (!headers || !rows) return { content: [{ type: 'text', text: 'Missing headers or rows.' }], isError: true };
      const th = themes[theme] || themes.light;
      const bp = bodyPosition || 'side';
      const html = generateTable(headers, rows, th, body, bp);
      slides.push({ layout: 'embed', content: { title: title || '', html, caption: caption || '' }, _table: { headers, rows, body, bodyPosition: bp } });
      currentIndex = slides.length - 1;
      render(); save();
      return { content: [{ type: 'text', text: `Added table slide (index ${currentIndex}). Total: ${slides.length}.` }], isError: false };
    });

    mup.registerFunction('addChart', ({ type, title, caption, data, options }) => {
      if (!data || !data.labels || !data.datasets) return { content: [{ type: 'text', text: 'Missing data.labels or data.datasets.' }], isError: true };
      const th = themes[theme] || themes.light;
      const chartData = { type, data, options: options || {} };
      const html = generateChart(type, data, options, th);
      slides.push({ layout: 'embed', content: { title: title || '', html, caption: caption || '' }, _chart: chartData });
      currentIndex = slides.length - 1;
      render(); save();
      return { content: [{ type: 'text', text: `Added ${type} chart (index ${currentIndex}). Total: ${slides.length}.` }], isError: false };
    });

    mup.registerFunction('updateChart', ({ index, data, options, title, caption }) => {
      if (index < 0 || index >= slides.length) return { content: [{ type: 'text', text: `Index ${index} out of range.` }], isError: true };
      const slide = slides[index];
      if (!slide._chart) return { content: [{ type: 'text', text: `Slide ${index} is not a chart. Use updateSlide() instead.` }], isError: true };
      if (data) {
        if (data.labels) slide._chart.data.labels = data.labels;
        if (data.datasets) slide._chart.data.datasets = data.datasets;
      }
      if (options) Object.assign(slide._chart.options, options);
      if (title !== undefined) slide.content.title = title;
      if (caption !== undefined) slide.content.caption = caption;
      const th = themes[theme] || themes.light;
      slide.content.html = generateChart(slide._chart.type, slide._chart.data, slide._chart.options, th);
      currentIndex = index;
      render(); save();
      return { content: [{ type: 'text', text: `Updated ${slide._chart.type} chart at index ${index}.` }], isError: false };
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
      if (typeof html2canvas === 'undefined') {
        return { content: [{ type: 'text', text: 'html2canvas library not loaded.' }], isError: true };
      }
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

    // ---- Reading Mode ----
    let readingMode = false;
    let readingIndex = 0;

    function enterReading(startIndex) {
      if (slides.length === 0) return false;
      readingMode = true;
      readingIndex = Math.max(0, Math.min(startIndex ?? currentIndex, slides.length - 1));
      document.getElementById('readingOverlay').classList.add('open');
      renderReadingSlide();
      return true;
    }

    function exitReading() {
      readingMode = false;
      document.getElementById('readingOverlay').classList.remove('open');
      // Sync editor to the slide we were viewing
      currentIndex = readingIndex;
      render();
    }

    function renderReadingSlide() {
      const area = document.getElementById('readingSlideArea');
      const slide = slides[readingIndex];
      if (!slide) return;

      const [designW, designH] = DESIGN_SIZES[aspectRatio] || DESIGN_SIZES['16:9'];
      const th = themes[theme] || themes.light;

      area.innerHTML = '';
      const frame = document.createElement('div');
      frame.className = `slide-frame layout-${slide.layout}`;
      frame.style.width = designW + 'px';
      frame.style.height = designH + 'px';
      frame.style.background = th.bg;
      frame.style.cssText += `--slide-bg:${th.bg};--slide-text:${th.text};--slide-heading:${th.heading};--slide-accent:${th.accent};--slide-muted:${th.muted};--slide-code-bg:${th.codeBg};`;
      frame.innerHTML = renderSlideHTML(slide, readingIndex, slides.length);
      area.appendChild(frame);

      // Scale to fit the reading area while maintaining aspect ratio
      requestAnimationFrame(() => {
        const rect = area.getBoundingClientRect();
        const scale = Math.min(rect.width / designW, rect.height / designH);
        frame.style.transform = `scale(${scale})`;
        frame.style.width = designW + 'px';
        frame.style.height = designH + 'px';
        frame.style.transformOrigin = 'center center';
      });

      // Update counter and progress
      document.getElementById('readingCounter').textContent = `${readingIndex + 1} / ${slides.length}`;
      const progress = slides.length > 1 ? (readingIndex / (slides.length - 1) * 100) : 100;
      document.getElementById('readingProgress').style.width = progress + '%';
    }

    function readingNext() {
      if (readingIndex < slides.length - 1) { readingIndex++; renderReadingSlide(); }
    }
    function readingPrev() {
      if (readingIndex > 0) { readingIndex--; renderReadingSlide(); }
    }

    // Reading mode button & nav
    document.getElementById('readingBtn').addEventListener('click', () => enterReading());
    document.getElementById('readingExitBtn').addEventListener('click', exitReading);
    document.getElementById('readingNextBtn').addEventListener('click', readingNext);
    document.getElementById('readingPrevBtn').addEventListener('click', readingPrev);

    // Reading mode keyboard
    document.addEventListener('keydown', (e) => {
      if (!readingMode) return;
      if (e.key === 'Escape') { e.preventDefault(); exitReading(); }
      else if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); readingNext(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); readingPrev(); }
      else if (e.key === 'Home') { e.preventDefault(); readingIndex = 0; renderReadingSlide(); }
      else if (e.key === 'End') { e.preventDefault(); readingIndex = slides.length - 1; renderReadingSlide(); }
    });

    // Re-scale reading slide on resize
    new ResizeObserver(() => {
      if (readingMode) renderReadingSlide();
    }).observe(document.getElementById('readingSlideArea'));

    // Register reading mode functions
    mup.registerFunction('enterReadingMode', ({ index }) => {
      if (slides.length === 0) return { content: [{ type: 'text', text: 'No slides.' }], isError: true };
      enterReading(index);
      const slide = slides[readingIndex];
      return { content: [{ type: 'text', text: `Reading mode: slide ${readingIndex + 1}/${slides.length} — ${slide.content?.title || slide.layout}` }] };
    });

    mup.registerFunction('exitReadingMode', () => {
      if (!readingMode) return { content: [{ type: 'text', text: 'Not in reading mode.' }] };
      exitReading();
      return { content: [{ type: 'text', text: 'Exited reading mode.' }] };
    });

    mup.registerFunction('readingNext', () => {
      if (!readingMode) return { content: [{ type: 'text', text: 'Not in reading mode. Call enterReadingMode first.' }], isError: true };
      readingNext();
      const slide = slides[readingIndex];
      return { content: [{ type: 'text', text: `Slide ${readingIndex + 1}/${slides.length}: ${slide.content?.title || slide.layout}` }] };
    });

    mup.registerFunction('readingPrev', () => {
      if (!readingMode) return { content: [{ type: 'text', text: 'Not in reading mode. Call enterReadingMode first.' }], isError: true };
      readingPrev();
      const slide = slides[readingIndex];
      return { content: [{ type: 'text', text: `Slide ${readingIndex + 1}/${slides.length}: ${slide.content?.title || slide.layout}` }] };
    });

    mup.registerFunction('readingGoTo', ({ index }) => {
      if (!readingMode) return { content: [{ type: 'text', text: 'Not in reading mode. Call enterReadingMode first.' }], isError: true };
      if (index < 0 || index >= slides.length) return { content: [{ type: 'text', text: `Index out of range (0-${slides.length - 1}).` }], isError: true };
      readingIndex = index;
      renderReadingSlide();
      const slide = slides[readingIndex];
      return { content: [{ type: 'text', text: `Slide ${readingIndex + 1}/${slides.length}: ${slide.content?.title || slide.layout}` }] };
    });

    // ---- Init ----
    mup.onThemeChange(applyEditorTheme);
    mup.onReady(async (params) => {
      if (params?.theme) applyEditorTheme(params.theme);
      try { await mup.registerWorkspace(); } catch {}
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
    let resizing = false;
    new ResizeObserver(() => {
      if (resizing || slides.length === 0) return;
      resizing = true;
      requestAnimationFrame(() => { render(); resizing = false; });
    }).observe(document.getElementById('canvasArea'));
