(() => {
  'use strict';

  let nodes = [];
  let edges = [];
  let nodeMap = new Map(); // id -> node, for O(1) lookup
  let currentLayout = 'tree';
  let selectedShape = 'rect';
  let selectedColor = '#3b82f6';

  let vbX = 0, vbY = 0, vbW = 800, vbH = 600;
  let isPanning = false, panStartX = 0, panStartY = 0, panVbX = 0, panVbY = 0;

  // Interaction state
  let selectedNodeId = null;
  let nodeCounter = 0;
  let draggingNodeId = null;
  let isDraggingNode = false;
  let dragStartSvg = null;
  let dragNodeStartPos = null;
  const DRAG_THRESHOLD = 3;

  const svg = document.getElementById('svgRoot');
  const nodesGroup = document.getElementById('nodesGroup');
  const edgesGroup = document.getElementById('edgesGroup');
  const emptyState = document.getElementById('emptyState');
  const infoSpan = document.getElementById('diagramInfo');
  const labelEditor = document.getElementById('labelEditor');
  const labelInput = document.getElementById('labelInput');

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

  // ---- Coordinate helpers ----
  function screenToSvg(clientX, clientY) {
    const rect = svg.getBoundingClientRect();
    return {
      x: vbX + (clientX - rect.left) / rect.width * vbW,
      y: vbY + (clientY - rect.top) / rect.height * vbH
    };
  }

  function nextNodeId() {
    nodeCounter++;
    while (getNodeById('node-' + nodeCounter)) nodeCounter++;
    return 'node-' + nodeCounter;
  }

  // ---- Selection ----
  function selectNode(id) {
    selectedNodeId = id;
    nodesGroup.querySelectorAll('.node').forEach(g => {
      g.classList.toggle('selected', g.getAttribute('data-id') === id);
    });
  }

  function deselectAll() {
    selectedNodeId = null;
    nodesGroup.querySelectorAll('.node.selected').forEach(g => g.classList.remove('selected'));
  }

  // ---- Find node group from click target ----
  function findNodeGroup(el) {
    while (el && el !== svg) {
      if (el.classList && el.classList.contains('node')) return el;
      el = el.parentElement;
    }
    return null;
  }

  // Shared dagre graph builder -- single source of truth for dagre setup
  function buildDagreGraph(rankdir) {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir, nodesep: 60, ranksep: 80, edgesep: 30 });
    g.setDefaultEdgeLabel(() => ({}));
    nodes.forEach(n => {
      const dims = getNodeDimensions(n);
      g.setNode(n.id, { label: n.label, width: dims.w, height: dims.h });
    });
    edges.forEach(e => g.setEdge(e.from, e.to));
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
    edges.forEach(e => {
      const dagreEdge = g.edge(e.from, e.to);
      e._points = (dagreEdge && dagreEdge.points) ? dagreEdge.points : null;
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

  function buildEdgePath(edge) {
    const fromNode = getNodeById(edge.from);
    const toNode = getNodeById(edge.to);
    if (!fromNode || !toNode) return '';

    if (edge._points && edge._points.length > 1) {
      return pointsToPath(edge._points);
    }

    // Fallback for force layout: bezier between node centers
    const dx = toNode.x - fromNode.x;
    const dy = toNode.y - fromNode.y;
    const angle = Math.atan2(dy, dx);
    const fromDims = getNodeDimensions(fromNode);
    const toDims = getNodeDimensions(toNode);
    const fromR = Math.max(fromDims.w, fromDims.h) / 2;
    const toR = Math.max(toDims.w, toDims.h) / 2;

    const x1 = fromNode.x + Math.cos(angle) * fromR * 0.6;
    const y1 = fromNode.y + Math.sin(angle) * fromR * 0.6;
    const x2 = toNode.x - Math.cos(angle) * toR * 0.6;
    const y2 = toNode.y - Math.sin(angle) * toR * 0.6;

    const cx1 = x1 + (x2 - x1) * 0.4;
    const cy1 = y1;
    const cx2 = x1 + (x2 - x1) * 0.6;
    const cy2 = y2;

    return `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;
  }

  function pointsToPath(points) {
    if (points.length < 2) return '';
    if (points.length === 2) {
      return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
    }
    // Polyline through dagre waypoints with smooth segments
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      d += ` L ${points[i].x} ${points[i].y}`;
    }
    return d;
  }

  // ---- Rendering ----
  function render(animate) {
    nodesGroup.innerHTML = '';
    edgesGroup.innerHTML = '';

    if (nodes.length === 0) {
      updateInfo();
      return;
    }

    // Render edges (behind nodes)
    edges.forEach((edge, i) => {
      const g = svgEl('g', { class: 'edge' + (animate ? ' edge-enter' : '') });
      const pathD = buildEdgePath(edge);
      if (!pathD) return;

      const path = svgEl('path', { d: pathD });
      let classes = [];
      if (edge.style === 'dashed') classes.push('dashed');
      if (edge.style === 'dotted') classes.push('dotted');
      if (edge.animated) classes.push('animated');
      if (classes.length) path.setAttribute('class', classes.join(' '));

      // Set edge length for draw-in animation
      if (animate) {
        const len = estimatePathLength(pathD);
        g.style.setProperty('--edge-length', len);
        path.style.animationDelay = `${0.15 + i * 0.05}s`;
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

    // Render nodes
    nodes.forEach((node, i) => {
      const isSelected = node.id === selectedNodeId;
      const g = svgEl('g', {
        class: 'node' + (node.highlight ? ' highlight' : '') + (isSelected ? ' selected' : '') + (animate ? ' node-enter' : ''),
        'data-id': node.id
      });
      if (animate) {
        g.style.animationDelay = `${i * 0.06}s`;
        g.style.transformOrigin = `${node.x}px ${node.y}px`;
      }

      const color = node.color || DEFAULT_COLOR;
      const fillColor = hexToRgba(color, 0.15);
      const strokeColor = color;

      const dims = getNodeDimensions(node);
      let shape;

      switch (node.shape) {
        case 'circle':
          shape = svgEl('circle', {
            cx: node.x, cy: node.y, r: CIRCLE_R,
            fill: fillColor, stroke: strokeColor, 'stroke-width': '2'
          });
          break;
        case 'diamond': {
          const s = DIAMOND_SIZE;
          const pts = [
            `${node.x},${node.y - s}`,
            `${node.x + s},${node.y}`,
            `${node.x},${node.y + s}`,
            `${node.x - s},${node.y}`
          ].join(' ');
          shape = svgEl('polygon', {
            points: pts,
            fill: fillColor, stroke: strokeColor, 'stroke-width': '2'
          });
          break;
        }
        case 'pill':
          shape = svgEl('rect', {
            x: node.x - dims.w / 2, y: node.y - dims.h / 2,
            width: dims.w, height: dims.h,
            rx: 25,
            fill: fillColor, stroke: strokeColor, 'stroke-width': '2'
          });
          break;
        default: // rect
          shape = svgEl('rect', {
            x: node.x - dims.w / 2, y: node.y - dims.h / 2,
            width: dims.w, height: dims.h,
            rx: 8,
            fill: fillColor, stroke: strokeColor, 'stroke-width': '2'
          });
      }

      g.appendChild(shape);

      // Label -- wrap long text
      const maxChars = node.shape === 'circle' ? 8 : 16;
      const label = node.label || '';
      if (label.length > maxChars) {
        const lines = wrapText(label, maxChars);
        const lineHeight = 16;
        const startY = node.y - ((lines.length - 1) * lineHeight) / 2;
        lines.forEach((line, li) => {
          const text = svgEl('text', { x: node.x, y: startY + li * lineHeight });
          text.textContent = line;
          g.appendChild(text);
        });
      } else {
        const text = svgEl('text', { x: node.x, y: node.y });
        text.textContent = label;
        g.appendChild(text);
      }

      nodesGroup.appendChild(g);
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
    const from = getNodeById(edge.from);
    const to = getNodeById(edge.to);
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

  // ---- Unified mouse interaction ----
  svg.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const nodeGroup = findNodeGroup(e.target);

    if (nodeGroup) {
      // Start potential node drag
      draggingNodeId = nodeGroup.getAttribute('data-id');
      isDraggingNode = false;
      dragStartSvg = screenToSvg(e.clientX, e.clientY);
      const node = getNodeById(draggingNodeId);
      if (node) dragNodeStartPos = { x: node.x, y: node.y };
      e.stopPropagation();
    } else {
      // Start pan (existing logic)
      isPanning = true;
      panStartX = e.clientX;
      panStartY = e.clientY;
      panVbX = vbX;
      panVbY = vbY;
      svg.style.cursor = 'grabbing';
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (draggingNodeId) {
      const pos = screenToSvg(e.clientX, e.clientY);
      const dx = pos.x - dragStartSvg.x;
      const dy = pos.y - dragStartSvg.y;
      if (!isDraggingNode && Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD) {
        isDraggingNode = true;
      }
      if (isDraggingNode && dragNodeStartPos) {
        const node = getNodeById(draggingNodeId);
        if (node) {
          node.x = dragNodeStartPos.x + dx;
          node.y = dragNodeStartPos.y + dy;
          render(false);
        }
      }
      return;
    }
    if (!isPanning) return;
    const rect = svg.getBoundingClientRect();
    const scaleX = vbW / rect.width;
    const scaleY = vbH / rect.height;
    vbX = panVbX - (e.clientX - panStartX) * scaleX;
    vbY = panVbY - (e.clientY - panStartY) * scaleY;
    applyViewBox();
  });

  window.addEventListener('mouseup', (e) => {
    if (draggingNodeId) {
      if (!isDraggingNode) {
        // It was a click (not drag) -- select node or create edge
        if (selectedNodeId && selectedNodeId !== draggingNodeId) {
          // Create edge between selected and clicked node
          edges.push({
            from: selectedNodeId, to: draggingNodeId,
            label: '', style: 'solid', animated: false, _points: null
          });
          runLayout(); render(false);
          if (typeof mup !== 'undefined' && mup.notifyInteraction) {
            mup.notifyInteraction('edge-create',
              `Created edge ${selectedNodeId} -> ${draggingNodeId}`,
              { from: selectedNodeId, to: draggingNodeId });
          }
          deselectAll();
          updateMupState(); emitUpdate();
        } else {
          selectNode(draggingNodeId);
        }
      } else {
        // Drag ended -- notify
        if (typeof mup !== 'undefined' && mup.notifyInteraction) {
          mup.notifyInteraction('node-move', `Moved ${draggingNodeId}`, { id: draggingNodeId });
        }
        updateMupState();
      }
      draggingNodeId = null;
      isDraggingNode = false;
      dragStartSvg = null;
      dragNodeStartPos = null;
      return;
    }
    if (isPanning) {
      // Check if it was a click (no real pan movement) on empty area
      const dx = Math.abs(e.clientX - panStartX);
      const dy = Math.abs(e.clientY - panStartY);
      if (dx < 3 && dy < 3) {
        deselectAll();
      }
    }
    isPanning = false;
    svg.style.cursor = '';
  });

  // ---- Double-click: create node or edit label ----
  svg.addEventListener('dblclick', (e) => {
    const nodeGroup = findNodeGroup(e.target);
    if (nodeGroup) {
      // Edit label
      startLabelEdit(nodeGroup.getAttribute('data-id'));
    } else {
      // Create new node at click position
      const pos = screenToSvg(e.clientX, e.clientY);
      const id = nextNodeId();
      const node = { id, label: 'New Node', shape: selectedShape, color: selectedColor, highlight: false, x: pos.x, y: pos.y };
      nodes.push(node);
      nodeMap.set(id, node);
      render(false);
      updateMupState(); emitUpdate();
      // Immediately start editing label
      startLabelEdit(id);
      if (typeof mup !== 'undefined' && mup.notifyInteraction) {
        mup.notifyInteraction('node-create', `Created node "${id}"`, { id, x: pos.x, y: pos.y });
      }
    }
  });

  // ---- Inline label editing ----
  let activeLabelCleanup = null;

  function startLabelEdit(nodeId) {
    const node = getNodeById(nodeId);
    if (!node) return;

    // Clean up any previous edit session
    if (activeLabelCleanup) activeLabelCleanup();

    // Position the overlay over the node
    const rect = svg.getBoundingClientRect();
    const screenX = rect.left + (node.x - vbX) / vbW * rect.width;
    const screenY = rect.top + (node.y - vbY) / vbH * rect.height;

    labelEditor.style.display = 'block';
    labelEditor.style.left = (screenX - 60) + 'px';
    labelEditor.style.top = (screenY - 12) + 'px';
    labelInput.value = node.label;
    labelInput.focus();
    labelInput.select();

    let finished = false;

    function cleanup() {
      labelInput.removeEventListener('keydown', onKey);
      labelInput.removeEventListener('blur', finish);
      activeLabelCleanup = null;
    }

    function finish() {
      if (finished) return;
      finished = true;
      const newLabel = labelInput.value.trim() || node.label;
      node.label = newLabel;
      labelEditor.style.display = 'none';
      cleanup();
      render(false);
      updateMupState(); emitUpdate();
      if (typeof mup !== 'undefined' && mup.notifyInteraction) {
        mup.notifyInteraction('node-rename', `Renamed "${nodeId}" to "${newLabel}"`, { id: nodeId, label: newLabel });
      }
    }

    function onKey(e) {
      if (e.key === 'Enter') { e.preventDefault(); finish(); }
      if (e.key === 'Escape') {
        labelEditor.style.display = 'none';
        cleanup();
      }
    }

    labelInput.addEventListener('keydown', onKey);
    labelInput.addEventListener('blur', finish);
    activeLabelCleanup = cleanup;
  }

  // ---- Keyboard: Delete selected node ----
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      // Don't delete if editing a label
      if (document.activeElement === labelInput) return;
      if (!selectedNodeId) return;
      const id = selectedNodeId;
      const idx = nodes.findIndex(n => n.id === id);
      if (idx === -1) return;
      nodes.splice(idx, 1);
      nodeMap.delete(id);
      edges = edges.filter(edge => edge.from !== id && edge.to !== id);
      selectedNodeId = null;
      if (nodes.length > 0) runLayout();
      render(false);
      updateMupState(); emitUpdate();
      if (typeof mup !== 'undefined' && mup.notifyInteraction) {
        mup.notifyInteraction('node-delete', `Deleted node "${id}"`, { id });
      }
    }
  });

  // ---- Toolbar buttons ----
  document.getElementById('fitBtn').addEventListener('click', () => fitViewInternal());
  document.getElementById('resetBtn').addEventListener('click', () => {
    vbX = 0; vbY = 0; vbW = 800; vbH = 600;
    applyViewBox();
  });
  document.getElementById('clearBtn').addEventListener('click', () => {
    nodes = []; edges = []; nodeMap.clear();
    selectedNodeId = null;
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
      render(true);
      updateMupState();
      if (typeof mup !== 'undefined' && mup.notifyInteraction) {
        mup.notifyInteraction('layout-change', `Layout changed to ${layoutType}`, { layout: layoutType });
      }
    });
  });

  // ---- Shape selector buttons ----
  document.querySelectorAll('.shape-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.shape-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedShape = btn.dataset.shape;
    });
  });

  // ---- Color dot selector ----
  document.querySelectorAll('.color-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
      dot.classList.add('active');
      selectedColor = dot.dataset.color;
    });
  });

  // ---- MUP Functions ----
  function ok(text) {
    return { content: [{ type: 'text', text }], isError: false };
  }

  function err(text) {
    return { content: [{ type: 'text', text }], isError: true };
  }

  mup.registerFunction('setDiagram', ({ nodes: newNodes, edges: newEdges, layout }) => {
    if (!Array.isArray(newNodes)) return err('nodes must be an array');
    if (!Array.isArray(newEdges)) return err('edges must be an array');

    nodes = newNodes.map(n => ({
      id: n.id,
      label: n.label,
      shape: n.shape || 'rect',
      color: n.color || DEFAULT_COLOR,
      highlight: false,
      x: undefined,
      y: undefined
    }));
    rebuildNodeMap();

    edges = newEdges.map(e => ({
      from: e.from,
      to: e.to,
      label: e.label || '',
      style: e.style || 'solid',
      animated: e.animated || false,
      _points: null
    }));

    selectedNodeId = null;
    runLayout(layout || 'tree');
    render(true);
    updateMupState();
    emitUpdate();
    return ok(`Diagram set: ${nodes.length} nodes, ${edges.length} edges (${currentLayout} layout)`);
  });

  mup.registerFunction('addNode', ({ id, label, shape, color }) => {
    if (!id || !label) return err('id and label are required');
    if (getNodeById(id)) return err(`Node "${id}" already exists`);

    const node = { id, label, shape: shape || 'rect', color: color || DEFAULT_COLOR, highlight: false, x: undefined, y: undefined };
    nodes.push(node);
    nodeMap.set(id, node);

    runLayout();
    render(true);
    updateMupState();
    emitUpdate();
    return ok(`Node "${id}" added (${nodes.length} total)`);
  });

  mup.registerFunction('addEdge', ({ from, to, label, style, animated }) => {
    if (!from || !to) return err('from and to are required');
    if (!getNodeById(from)) return err(`Source node "${from}" not found`);
    if (!getNodeById(to)) return err(`Target node "${to}" not found`);

    edges.push({
      from, to,
      label: label || '',
      style: style || 'solid',
      animated: animated || false,
      _points: null
    });

    runLayout();
    render(true);
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

    render(false);
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

    if (id === selectedNodeId) selectedNodeId = null;
    if (nodes.length > 0) runLayout();
    render(false);
    updateMupState();
    emitUpdate();
    return ok(`Node "${id}" removed (${nodes.length} remaining)`);
  });

  mup.registerFunction('clear', () => {
    nodes = [];
    edges = [];
    nodeMap.clear();
    selectedNodeId = null;
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
