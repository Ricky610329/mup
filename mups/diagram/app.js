(() => {
  'use strict';

  let nodes = [];
  let edges = [];
  let currentGroups = [];
  let nodeMap = new Map(); // id -> node, for O(1) lookup
  let currentLayout = 'tree';
  let defaultCurve = 'straight';
  const markerCache = new Map();
  let renderedNodeEls = new Map(); // id -> outer <g> DOM element (for diff rendering)
  let previousEdgeCount = 0;

  let vbX = 0, vbY = 0, vbW = 800, vbH = 600;
  let isPanning = false, panStartX = 0, panStartY = 0, panVbX = 0, panVbY = 0;

  const svg = document.getElementById('svgRoot');
  const nodesGroup = document.getElementById('nodesGroup');
  const edgesGroup = document.getElementById('edgesGroup');
  const groupsGroup = document.getElementById('groupsGroup');
  const emptyState = document.getElementById('emptyState');
  const infoSpan = document.getElementById('diagramInfo');

  const NODE_W = 140;
  const NODE_H = 50;
  const CIRCLE_R = 30;
  const DIAMOND_SIZE = 40;
  const DEFAULT_COLOR = '#3b82f6';
  const PADDING = 60;

  function svgEl(tag, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (attrs) Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
  }

  function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function getArrowMarker(color, direction) {
    const key = `${color || 'default'}-${direction || 'forward'}`;
    if (markerCache.has(key)) return `url(#${markerCache.get(key)})`;
    const id = 'arrow-' + key.replace(/[^a-z0-9]/gi, '_');
    const marker = svgEl('marker', {
      id, markerWidth: 10, markerHeight: 7,
      refX: direction === 'backward' ? 1 : 9, refY: 3.5,
      orient: 'auto', markerUnits: 'strokeWidth'
    });
    const poly = svgEl('polygon', {
      points: direction === 'backward' ? '10 0, 0 3.5, 10 7' : '0 0, 10 3.5, 0 7',
      fill: color || 'var(--edge-color)'
    });
    marker.appendChild(poly);
    document.querySelector('#svgRoot defs').appendChild(marker);
    markerCache.set(key, id);
    return `url(#${id})`;
  }

  function clearMarkerCache() {
    const defs = document.querySelector('#svgRoot defs');
    markerCache.forEach(id => {
      const el = defs.querySelector('#' + id);
      if (el) defs.removeChild(el);
    });
    markerCache.clear();
  }

  function getNodeById(id) {
    return nodeMap.get(id);
  }

  function rebuildNodeMap() {
    nodeMap = new Map(nodes.map(n => [n.id, n]));
  }

  function updateInfo() {
    infoSpan.textContent = `${nodes.length} node${nodes.length !== 1 ? 's' : ''}, ${edges.length} edge${edges.length !== 1 ? 's' : ''}`;
    emptyState.style.display = nodes.length === 0 ? '' : 'none';
  }

  function emitUpdate() {
    if (typeof mup !== 'undefined' && mup.emitEvent) {
      mup.emitEvent('diagram-updated', { nodeCount: nodes.length, edgeCount: edges.length });
    }
  }

  function updateMupState() {
    if (typeof mup !== 'undefined' && mup.updateState) {
      const summary = nodes.length === 0
        ? 'Empty diagram'
        : `${nodes.length} nodes, ${edges.length} edges (${currentLayout} layout)`;
      mup.updateState(summary, { nodes: nodes.length, edges: edges.length, layout: currentLayout });
    }
  }

  // Shared dagre graph builder -- uses compound graph when groups exist
  function buildDagreGraph(rankdir) {
    const hasGroups = currentGroups.length > 0 && nodes.some(n => n.group);
    const g = new dagre.graphlib.Graph({ compound: hasGroups });
    g.setGraph({ rankdir, nodesep: 60, ranksep: 80, edgesep: 30 });
    g.setDefaultEdgeLabel(() => ({}));
    if (hasGroups) {
      currentGroups.forEach(grp => {
        g.setNode(grp.id, { label: grp.label, clusterLabelPos: 'top', style: 'fill: none', paddingTop: 30, paddingBottom: 20, paddingLeft: 20, paddingRight: 20 });
      });
    }
    nodes.forEach(n => {
      const dims = getNodeDimensions(n);
      g.setNode(n.id, { label: n.label, width: dims.w, height: dims.h });
      if (hasGroups && n.group && g.hasNode(n.group)) {
        g.setParent(n.id, n.group);
      }
    });
    edges.forEach(e => {
      // Only add edges where both endpoints are nodes (not group edges)
      if (!e._isGroupEdge) g.setEdge(e.from, e.to);
    });
    dagre.layout(g);
    return g;
  }

  function layoutDagre(rankdir) {
    if (nodes.length === 0) return;
    const g = buildDagreGraph(rankdir);

    // Read node positions and edge waypoints in a single pass
    g.nodes().forEach(id => {
      const pos = g.node(id);
      const node = getNodeById(id);
      if (node && pos) { node.x = pos.x; node.y = pos.y; }
    });
    // Read group bounding boxes from dagre compound layout
    currentGroups.forEach(grp => {
      const gNode = g.node(grp.id);
      if (gNode) {
        grp._x = gNode.x; grp._y = gNode.y;
        grp._w = gNode.width; grp._h = gNode.height;
      }
    });
    edges.forEach(e => {
      if (e._isGroupEdge) {
        e._points = null; // Group edges use fallback path calculation
      } else {
        const dagreEdge = g.edge(e.from, e.to);
        e._points = (dagreEdge && dagreEdge.points) ? dagreEdge.points : null;
      }
    });
  }

  function getNodeDimensions(n) {
    switch (n.shape) {
      case 'circle':  return { w: CIRCLE_R * 2 + 20, h: CIRCLE_R * 2 + 20 };
      case 'diamond': return { w: DIAMOND_SIZE * 2 + 30, h: DIAMOND_SIZE * 2 + 30 };
      case 'pill':    return { w: NODE_W + 20, h: NODE_H };
      default:        return { w: NODE_W, h: NODE_H };
    }
  }

  // ---- Layout: Force-directed ----
  function layoutForce() {
    if (nodes.length === 0) return;

    // Initialize random positions
    nodes.forEach(n => {
      if (n.x === undefined) n.x = Math.random() * 400 + 100;
      if (n.y === undefined) n.y = Math.random() * 300 + 100;
    });

    const iterations = 120;
    const repulsion = 8000;
    const attraction = 0.005;
    const damping = 0.9;

    const vx = new Map();
    const vy = new Map();
    nodes.forEach(n => { vx.set(n.id, 0); vy.set(n.id, 0); });

    for (let iter = 0; iter < iterations; iter++) {
      const temp = 1 - iter / iterations;

      // Repulsion between all pairs
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = repulsion / (dist * dist);
          const fx = (dx / dist) * force * temp;
          const fy = (dy / dist) * force * temp;
          vx.set(a.id, vx.get(a.id) - fx);
          vy.set(a.id, vy.get(a.id) - fy);
          vx.set(b.id, vx.get(b.id) + fx);
          vy.set(b.id, vy.get(b.id) + fy);
        }
      }

      // Attraction along edges
      edges.forEach(e => {
        const a = getNodeById(e.from);
        const b = getNodeById(e.to);
        if (!a || !b) return;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = dist * attraction * temp;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        vx.set(a.id, vx.get(a.id) + fx);
        vy.set(a.id, vy.get(a.id) + fy);
        vx.set(b.id, vx.get(b.id) - fx);
        vy.set(b.id, vy.get(b.id) - fy);
      });

      // Apply velocities
      nodes.forEach(n => {
        n.x += vx.get(n.id) * damping;
        n.y += vy.get(n.id) * damping;
        vx.set(n.id, vx.get(n.id) * damping);
        vy.set(n.id, vy.get(n.id) * damping);
      });
    }
  }

  // ---- Run layout ----
  function runLayout(layoutType) {
    currentLayout = layoutType || currentLayout;
    switch (currentLayout) {
      case 'horizontal': layoutDagre('LR'); break;
      case 'vertical':
      case 'tree':       layoutDagre('TB'); break;
      case 'force':      layoutForce(); break;
      default:           layoutDagre('TB'); break;
    }
  }

  // Resolve an ID to a node or a virtual group node (for edge endpoints)
  function resolveEndpoint(id) {
    const node = getNodeById(id);
    if (node) return node;
    const group = currentGroups.find(g => g.id === id);
    if (group && group._x !== undefined) {
      return { x: group._x, y: group._y, shape: 'rect', _isGroup: true, _w: group._w, _h: group._h };
    }
    return null;
  }

  function buildEdgePath(edge) {
    const fromNode = resolveEndpoint(edge.from);
    const toNode = resolveEndpoint(edge.to);
    if (!fromNode || !toNode) return '';

    if (edge._points && edge._points.length > 1) {
      return pointsToPath(edge._points, edge.curve);
    }

    // Fallback for force layout or group edges: bezier between node centers
    const dx = toNode.x - fromNode.x;
    const dy = toNode.y - fromNode.y;
    const angle = Math.atan2(dy, dx);
    const fromDims = fromNode._isGroup ? { w: fromNode._w, h: fromNode._h } : getNodeDimensions(fromNode);
    const toDims = toNode._isGroup ? { w: toNode._w, h: toNode._h } : getNodeDimensions(toNode);
    const fromR = Math.max(fromDims.w, fromDims.h) / 2;
    const toR = Math.max(toDims.w, toDims.h) / 2;

    const x1 = fromNode.x + Math.cos(angle) * fromR * 0.6;
    const y1 = fromNode.y + Math.sin(angle) * fromR * 0.6;
    const x2 = toNode.x - Math.cos(angle) * toR * 0.6;
    const y2 = toNode.y - Math.sin(angle) * toR * 0.6;

    const useBezier = (edge.curve || defaultCurve) === 'bezier';
    if (!useBezier) {
      return `M ${x1} ${y1} L ${x2} ${y2}`;
    }

    const cx1 = x1 + (x2 - x1) * 0.4;
    const cy1 = y1;
    const cx2 = x1 + (x2 - x1) * 0.6;
    const cy2 = y2;

    return `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;
  }

  function pointsToPath(points, curve) {
    if (points.length < 2) return '';
    const useBezier = (curve || defaultCurve) === 'bezier';

    if (!useBezier || points.length === 2) {
      let d = `M ${points[0].x} ${points[0].y}`;
      for (let i = 1; i < points.length; i++) {
        d += ` L ${points[i].x} ${points[i].y}`;
      }
      return d;
    }

    // Smooth bezier through dagre waypoints
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const mx = (prev.x + curr.x) / 2;
      const my = (prev.y + curr.y) / 2;
      if (i === 1) {
        d += ` Q ${prev.x} ${prev.y} ${mx} ${my}`;
      } else if (i === points.length - 1) {
        d += ` Q ${curr.x} ${curr.y} ${curr.x} ${curr.y}`;
      } else {
        d += ` T ${mx} ${my}`;
      }
    }
    return d;
  }

  // ---- Group rendering ----
  function renderGroups(groups, animate) {
    groupsGroup.innerHTML = '';
    if (!groups || groups.length === 0) return;

    groups.forEach(group => {
      const memberNodes = nodes.filter(n => n.group === group.id);
      if (memberNodes.length === 0) return;

      let bx, by, bw, bh;
      if (group._w && group._h) {
        // Use dagre compound layout bounding box
        bx = group._x - group._w / 2;
        by = group._y - group._h / 2;
        bw = group._w;
        bh = group._h;
      } else {
        // Fallback: manual calculation for force layout
        const PAD = 30;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        memberNodes.forEach(n => {
          const dims = getNodeDimensions(n);
          minX = Math.min(minX, n.x - dims.w / 2);
          minY = Math.min(minY, n.y - dims.h / 2);
          maxX = Math.max(maxX, n.x + dims.w / 2);
          maxY = Math.max(maxY, n.y + dims.h / 2);
        });
        bx = minX - PAD; by = minY - PAD;
        bw = (maxX - minX) + PAD * 2; bh = (maxY - minY) + PAD * 2;
      }

      const color = group.color || '#888';
      const g = svgEl('g', { class: 'group-box' });

      const rect = svgEl('rect', {
        x: bx, y: by, width: bw, height: bh,
        rx: 12,
        fill: hexToRgba(color, 0.06),
        stroke: hexToRgba(color, 0.25),
        'stroke-width': 1.5
      });
      g.appendChild(rect);

      const label = svgEl('text', {
        x: bx + 10, y: by + 16,
        class: 'group-label'
      });
      label.style.fill = hexToRgba(color, 0.6);
      label.textContent = group.label;
      g.appendChild(label);

      groupsGroup.appendChild(g);
    });
  }

  // ---- Build node shapes & label at origin (0,0) ----
  function buildNodeContent(node) {
    const frag = document.createDocumentFragment();
    const color = node.color || DEFAULT_COLOR;
    const fillColor = hexToRgba(color, 0.15);
    const strokeColor = color;
    const dims = getNodeDimensions(node);
    let shape;

    switch (node.shape) {
      case 'circle':
        shape = svgEl('circle', {
          cx: 0, cy: 0, r: CIRCLE_R,
          fill: fillColor, stroke: strokeColor, 'stroke-width': '2'
        });
        break;
      case 'diamond': {
        const s = DIAMOND_SIZE;
        const pts = [
          `0,${-s}`, `${s},0`, `0,${s}`, `${-s},0`
        ].join(' ');
        shape = svgEl('polygon', {
          points: pts,
          fill: fillColor, stroke: strokeColor, 'stroke-width': '2'
        });
        break;
      }
      case 'pill':
        shape = svgEl('rect', {
          x: -dims.w / 2, y: -dims.h / 2,
          width: dims.w, height: dims.h,
          rx: 25,
          fill: fillColor, stroke: strokeColor, 'stroke-width': '2'
        });
        break;
      default: // rect
        shape = svgEl('rect', {
          x: -dims.w / 2, y: -dims.h / 2,
          width: dims.w, height: dims.h,
          rx: 8,
          fill: fillColor, stroke: strokeColor, 'stroke-width': '2'
        });
    }
    frag.appendChild(shape);

    // Label -- wrap long text
    const maxChars = node.shape === 'circle' ? 8 : 16;
    const label = node.label || '';
    if (label.length > maxChars) {
      const lines = wrapText(label, maxChars);
      const lineHeight = 16;
      const startY = -((lines.length - 1) * lineHeight) / 2;
      lines.forEach((line, li) => {
        const text = svgEl('text', { x: 0, y: startY + li * lineHeight });
        text.textContent = line;
        frag.appendChild(text);
      });
    } else {
      const text = svgEl('text', { x: 0, y: 0 });
      text.textContent = label;
      frag.appendChild(text);
    }

    return frag;
  }

  // ---- Rendering (diff-based for nodes, rebuild for edges) ----
  function render(animate, newNodeIds) {
    // Edges: always rebuild (paths change with layout recalculation)
    edgesGroup.innerHTML = '';
    clearMarkerCache();

    if (nodes.length === 0) {
      nodesGroup.innerHTML = '';
      groupsGroup.innerHTML = '';
      renderedNodeEls.clear();
      previousEdgeCount = 0;
      updateInfo();
      return;
    }

    // Render groups (behind everything)
    renderGroups(currentGroups, animate);

    // Render edges — only animate genuinely new ones
    edges.forEach((edge, i) => {
      const isNewEdge = i >= previousEdgeCount;
      const shouldAnimate = animate && isNewEdge;
      const g = svgEl('g', { class: 'edge' + (shouldAnimate ? ' edge-enter' : '') });
      const pathD = buildEdgePath(edge);
      if (!pathD) return;

      const path = svgEl('path', { d: pathD });
      let classes = [];
      if (edge.style === 'dashed') classes.push('dashed');
      if (edge.style === 'dotted') classes.push('dotted');
      if (edge.animated) classes.push('animated');
      if (classes.length) path.setAttribute('class', classes.join(' '));

      // Custom edge color
      if (edge.color) {
        path.style.stroke = edge.color;
      }

      // Arrow direction
      const dir = edge.direction || 'forward';
      if (dir === 'forward' || dir === 'both') {
        path.setAttribute('marker-end', getArrowMarker(edge.color, 'forward'));
      }
      if (dir === 'backward' || dir === 'both') {
        path.setAttribute('marker-start', getArrowMarker(edge.color, 'backward'));
      }

      // Set edge length for draw-in animation (only new edges)
      if (shouldAnimate) {
        const len = estimatePathLength(pathD);
        g.style.setProperty('--edge-length', len);
        const relIdx = i - previousEdgeCount;
        path.style.animationDelay = `${0.15 + relIdx * 0.05}s`;
      }

      g.appendChild(path);

      // Edge label
      if (edge.label) {
        const mid = getPathMidpoint(edge);
        const bgRect = svgEl('rect', {
          class: 'edge-label-bg',
          x: mid.x - edge.label.length * 3.3 - 4,
          y: mid.y - 8,
          width: edge.label.length * 6.6 + 8,
          height: 16,
          rx: 3
        });
        const text = svgEl('text', { x: mid.x, y: mid.y });
        text.textContent = edge.label;
        g.appendChild(bgRect);
        g.appendChild(text);
      }

      edgesGroup.appendChild(g);
    });
    previousEdgeCount = edges.length;

    // ---- Diff-based node rendering ----
    const currentIds = new Set(nodes.map(n => n.id));

    // Remove nodes that no longer exist
    for (const [id, el] of renderedNodeEls) {
      if (!currentIds.has(id)) {
        el.remove();
        renderedNodeEls.delete(id);
      }
    }

    // Add new nodes / update existing node positions
    nodes.forEach((node, i) => {
      const existing = renderedNodeEls.get(node.id);
      if (existing) {
        // Existing node: smoothly update position via CSS transition (no re-animation)
        existing.style.transform = `translate(${node.x}px, ${node.y}px)`;
        existing.classList.toggle('highlight', !!node.highlight);
      } else {
        // New node: create element, optionally with entry animation
        const shouldAnimate = animate && (!newNodeIds || newNodeIds.has(node.id));
        const g = svgEl('g', {
          class: 'node' + (node.highlight ? ' highlight' : ''),
          'data-id': node.id
        });
        g.style.transform = `translate(${node.x}px, ${node.y}px)`;

        // Inner group holds shapes & text; entry animation goes here
        const inner = svgEl('g', {});
        if (shouldAnimate) {
          inner.classList.add('node-enter');
          inner.style.animationDelay = `${i * 0.06}s`;
        }
        inner.appendChild(buildNodeContent(node));
        g.appendChild(inner);

        nodesGroup.appendChild(g);
        renderedNodeEls.set(node.id, g);
      }
    });

    updateInfo();
    if (animate) fitViewInternal();
  }

  function wrapText(text, maxChars) {
    const words = text.split(/\s+/);
    const lines = [];
    let current = '';
    words.forEach(word => {
      if (current && (current + ' ' + word).length > maxChars) {
        lines.push(current);
        current = word;
      } else {
        current = current ? current + ' ' + word : word;
      }
    });
    if (current) lines.push(current);
    return lines.length === 0 ? [text] : lines;
  }

  function getPathMidpoint(edge) {
    const from = resolveEndpoint(edge.from);
    const to = resolveEndpoint(edge.to);
    if (!from || !to) return { x: 0, y: 0 };

    if (edge._points && edge._points.length > 0) {
      const mid = edge._points[Math.floor(edge._points.length / 2)];
      return { x: mid.x, y: mid.y };
    }
    return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  }

  function estimatePathLength(d) {
    // Rough estimate based on path commands
    const nums = d.match(/-?[\d.]+/g);
    if (!nums || nums.length < 4) return 100;
    let len = 0;
    for (let i = 2; i < nums.length - 1; i += 2) {
      const dx = parseFloat(nums[i]) - parseFloat(nums[i - 2]);
      const dy = parseFloat(nums[i + 1]) - parseFloat(nums[i - 1]);
      len += Math.sqrt(dx * dx + dy * dy);
    }
    return Math.max(len, 50);
  }

  // ---- ViewBox / Pan / Zoom ----
  function applyViewBox() {
    svg.setAttribute('viewBox', `${vbX} ${vbY} ${vbW} ${vbH}`);
  }

  function fitViewInternal() {
    if (nodes.length === 0) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach(n => {
      const dims = getNodeDimensions(n);
      minX = Math.min(minX, n.x - dims.w / 2);
      minY = Math.min(minY, n.y - dims.h / 2);
      maxX = Math.max(maxX, n.x + dims.w / 2);
      maxY = Math.max(maxY, n.y + dims.h / 2);
    });

    const contentW = maxX - minX + PADDING * 2;
    const contentH = maxY - minY + PADDING * 2;

    vbX = minX - PADDING;
    vbY = minY - PADDING;
    vbW = contentW;
    vbH = contentH;

    applyViewBox();
  }

  // Mouse wheel zoom
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = svg.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left) / rect.width;
    const mouseY = (e.clientY - rect.top) / rect.height;

    const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9;
    const newW = vbW * zoomFactor;
    const newH = vbH * zoomFactor;

    vbX += (vbW - newW) * mouseX;
    vbY += (vbH - newH) * mouseY;
    vbW = newW;
    vbH = newH;

    applyViewBox();
  }, { passive: false });

  // ---- Pan interaction ----
  svg.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    isPanning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panVbX = vbX;
    panVbY = vbY;
    svg.style.cursor = 'grabbing';
  });

  window.addEventListener('mousemove', (e) => {
    if (!isPanning) return;
    const rect = svg.getBoundingClientRect();
    const scaleX = vbW / rect.width;
    const scaleY = vbH / rect.height;
    vbX = panVbX - (e.clientX - panStartX) * scaleX;
    vbY = panVbY - (e.clientY - panStartY) * scaleY;
    applyViewBox();
  });

  window.addEventListener('mouseup', () => {
    isPanning = false;
    svg.style.cursor = '';
  });

  // ---- Toolbar buttons ----
  document.getElementById('fitBtn').addEventListener('click', () => fitViewInternal());
  document.getElementById('resetBtn').addEventListener('click', () => {
    vbX = 0; vbY = 0; vbW = 800; vbH = 600;
    applyViewBox();
  });
  document.getElementById('clearBtn').addEventListener('click', () => {
    nodes = []; edges = []; currentGroups = []; nodeMap.clear();
    defaultCurve = 'bezier';
    clearMarkerCache();
    renderedNodeEls.clear();
    previousEdgeCount = 0;
    render(false);
    updateMupState();
    emitUpdate();
  });

  // ---- Layout buttons ----
  document.querySelectorAll('.layout-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.layout-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const layoutType = btn.dataset.layout;
      runLayout(layoutType);
      render(false); // no animation — CSS transition handles smooth repositioning
      fitViewInternal();
      updateMupState();
    });
  });

  // ---- MUP Functions ----
  function ok(text) {
    return { content: [{ type: 'text', text }], isError: false };
  }

  function err(text) {
    return { content: [{ type: 'text', text }], isError: true };
  }

  mup.registerFunction('setDiagram', ({ nodes: newNodes, edges: newEdges, groups, layout, curve }) => {
    if (!Array.isArray(newNodes)) return err('nodes must be an array');
    if (!Array.isArray(newEdges)) return err('edges must be an array');

    if (curve) defaultCurve = curve;

    // Full replacement — clear tracking
    renderedNodeEls.clear();
    previousEdgeCount = 0;
    nodesGroup.innerHTML = '';

    nodes = newNodes.map(n => ({
      id: n.id,
      label: n.label,
      shape: n.shape || 'rect',
      color: n.color || DEFAULT_COLOR,
      group: n.group || null,
      highlight: false,
      x: undefined,
      y: undefined
    }));
    rebuildNodeMap();

    currentGroups = Array.isArray(groups) ? groups : [];

    edges = newEdges.map(e => {
      const fromIsNode = !!getNodeById(e.from);
      const toIsNode = !!getNodeById(e.to);
      const fromIsGroup = !fromIsNode && currentGroups.some(g => g.id === e.from);
      const toIsGroup = !toIsNode && currentGroups.some(g => g.id === e.to);
      return {
        from: e.from,
        to: e.to,
        label: e.label || '',
        style: e.style || 'solid',
        animated: e.animated || false,
        curve: e.curve || null,
        color: e.color || null,
        direction: e.direction || 'forward',
        _points: null,
        _isGroupEdge: fromIsGroup || toIsGroup
      };
    });

    runLayout(layout || 'tree');
    render(true); // all nodes are new — animate everything
    updateMupState();
    emitUpdate();
    return ok(`Diagram set: ${nodes.length} nodes, ${edges.length} edges (${currentLayout} layout)`);
  });

  mup.registerFunction('addNode', ({ id, label, shape, color, group }) => {
    if (!id || !label) return err('id and label are required');
    if (getNodeById(id)) return err(`Node "${id}" already exists`);

    const node = { id, label, shape: shape || 'rect', color: color || DEFAULT_COLOR, group: group || null, highlight: false, x: undefined, y: undefined };
    nodes.push(node);
    nodeMap.set(id, node);

    runLayout();
    render(true, new Set([id])); // only animate the new node
    updateMupState();
    emitUpdate();
    return ok(`Node "${id}" added (${nodes.length} total)`);
  });

  mup.registerFunction('addEdge', ({ from, to, label, style, animated, curve, color, direction }) => {
    if (!from || !to) return err('from and to are required');
    const fromIsNode = !!getNodeById(from);
    const toIsNode = !!getNodeById(to);
    const fromIsGroup = !fromIsNode && currentGroups.some(g => g.id === from);
    const toIsGroup = !toIsNode && currentGroups.some(g => g.id === to);
    if (!fromIsNode && !fromIsGroup) return err(`Source "${from}" not found (not a node or group)`);
    if (!toIsNode && !toIsGroup) return err(`Target "${to}" not found (not a node or group)`);

    edges.push({
      from, to,
      label: label || '',
      style: style || 'solid',
      animated: animated || false,
      curve: curve || null,
      color: color || null,
      direction: direction || 'forward',
      _points: null,
      _isGroupEdge: fromIsGroup || toIsGroup
    });

    runLayout();
    render(true, new Set()); // no new nodes — only the new edge animates
    updateMupState();
    emitUpdate();
    return ok(`Edge ${from} -> ${to} added (${edges.length} total)`);
  });

  mup.registerFunction('updateNode', ({ id, label, color, highlight }) => {
    const node = getNodeById(id);
    if (!node) return err(`Node "${id}" not found`);

    if (label !== undefined) node.label = label;
    if (color !== undefined) node.color = color;
    if (highlight !== undefined) node.highlight = highlight;

    // Direct DOM update — no full re-render needed
    const el = renderedNodeEls.get(id);
    if (el) {
      el.classList.toggle('highlight', !!node.highlight);
      const inner = el.firstChild;
      if (inner) {
        inner.innerHTML = '';
        inner.appendChild(buildNodeContent(node));
      }
    } else {
      render(false);
    }

    updateMupState();
    emitUpdate();
    const changes = [];
    if (label !== undefined) changes.push(`label="${label}"`);
    if (color !== undefined) changes.push(`color=${color}`);
    if (highlight !== undefined) changes.push(`highlight=${highlight}`);
    return ok(`Node "${id}" updated: ${changes.join(', ')}`);
  });

  mup.registerFunction('removeNode', ({ id }) => {
    const idx = nodes.findIndex(n => n.id === id);
    if (idx === -1) return err(`Node "${id}" not found`);

    nodes.splice(idx, 1);
    nodeMap.delete(id);
    edges = edges.filter(e => e.from !== id && e.to !== id);
    previousEdgeCount = edges.length;

    if (nodes.length > 0) runLayout();
    render(false);
    updateMupState();
    emitUpdate();
    return ok(`Node "${id}" removed (${nodes.length} remaining)`);
  });

  mup.registerFunction('clear', () => {
    nodes = [];
    edges = [];
    currentGroups = [];
    nodeMap.clear();
    defaultCurve = 'bezier';
    clearMarkerCache();
    renderedNodeEls.clear();
    previousEdgeCount = 0;
    render(false);
    updateMupState();
    emitUpdate();
    return ok('Diagram cleared');
  });

  mup.registerFunction('fitView', () => {
    if (nodes.length === 0) return ok('No nodes to fit');
    fitViewInternal();
    return ok('View fitted to diagram bounds');
  });

  mup.registerFunction('exportSVG', () => {
    if (nodes.length === 0) return err('No diagram to export');
    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(svg);
    return { content: [{ type: 'text', text: svgStr }], isError: false };
  });

  mup.registerFunction('exportPNG', () => {
    if (nodes.length === 0) return err('No diagram to export');
    return new Promise((resolve) => {
      const serializer = new XMLSerializer();
      // Inline styles for standalone rendering
      const svgClone = svg.cloneNode(true);
      const styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style');
      const computedBg = getComputedStyle(document.body).getPropertyValue('--bg').trim() || '#f5f5f5';
      const computedEdge = getComputedStyle(document.body).getPropertyValue('--edge-color').trim() || '#999';
      const computedText = getComputedStyle(document.body).getPropertyValue('--text').trim() || '#333';
      const computedLabel = getComputedStyle(document.body).getPropertyValue('--label-color').trim() || '#666';
      styleEl.textContent = `
        .edge path { fill: none; stroke: ${computedEdge}; stroke-width: 1.5; }
        .node text { fill: ${computedText}; font-size: 13px; font-family: sans-serif; dominant-baseline: central; text-anchor: middle; }
        .edge text { fill: ${computedLabel}; font-size: 11px; font-family: sans-serif; dominant-baseline: central; text-anchor: middle; }
        .edge-label-bg { fill: ${computedBg}; opacity: 0.85; }
        .group-label { font-size: 11px; font-weight: 600; font-family: sans-serif; }
      `;
      svgClone.insertBefore(styleEl, svgClone.firstChild);
      const svgStr = serializer.serializeToString(svgClone);
      const blob = new Blob([svgStr], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const vb = svg.getAttribute('viewBox');
        const parts = vb ? vb.split(/\s+/).map(Number) : [0, 0, 800, 600];
        canvas.width = Math.max(parts[2], 100);
        canvas.height = Math.max(parts[3], 100);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = computedBg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/png');
        URL.revokeObjectURL(url);
        const base64 = dataUrl.split(',')[1];
        resolve({ content: [{ type: 'image', data: base64, mimeType: 'image/png' }], isError: false });
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(err('Failed to render PNG'));
      };
      img.src = url;
    });
  });

  // ---- Theme ----
  function applyTheme(theme) {
    document.body.classList.toggle('dark', theme === 'dark');
  }

  mup.onThemeChange(applyTheme);

  mup.onReady((params) => {
    if (params?.theme) applyTheme(params.theme);
    applyViewBox();
    updateInfo();
    updateMupState();
  });
})();
