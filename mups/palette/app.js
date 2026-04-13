// ---- State ----
let palette = { colors: [], name: 'Color Palette', type: 'custom' };
let displayMode = 'swatches';
let showContrast = false;
let showNames = true;
let wavesAnimId = null;

// ---- DOM refs ----
const mainEl = document.getElementById('main');
const canvasEl = document.getElementById('wavesCanvas');
const gradientBar = document.getElementById('gradientBar');
const paletteNameEl = document.getElementById('paletteName');
const typeBadgeEl = document.getElementById('typeBadge');
const modeBadgeEl = document.getElementById('modeBadge');
const modeBtns = document.querySelectorAll('.mode-btn');
const contrastToggleBtn = document.getElementById('contrastToggle');
const namesToggleBtn = document.getElementById('namesToggle');
const conceptInput = document.getElementById('conceptInput');

// ---- Color math utilities ----
function hexToRgb(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  const n = parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(c => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0')).join('');
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) { h = s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return [h * 360, s * 100, l * 100];
}

function hslToRgb(h, s, l) {
  h /= 360; s /= 100; l /= 100;
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1/3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1/3) * 255)
  ];
}

function hslToHex(h, s, l) {
  const [r, g, b] = hslToRgb(h, s, l);
  return rgbToHex(r, g, b);
}

function hexToHsl(hex) {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHsl(r, g, b);
}

function wrapHue(h) { return ((h % 360) + 360) % 360; }

// ---- WCAG contrast ----
function relativeLuminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(c => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(hex1, hex2) {
  const L1 = Math.max(relativeLuminance(hex1), relativeLuminance(hex2));
  const L2 = Math.min(relativeLuminance(hex1), relativeLuminance(hex2));
  return (L1 + 0.05) / (L2 + 0.05);
}

function wcagLabel(ratio) {
  if (ratio >= 7) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  return 'Fail';
}

function textColorFor(hex) {
  return relativeLuminance(hex) > 0.4 ? '#111111' : '#f0f0f0';
}

// ---- Harmony generators ----
function generateHarmony(seedHex, type, count) {
  const [h, s, l] = hexToHsl(seedHex);
  count = Math.max(3, Math.min(8, count || 5));
  const colors = [];

  switch (type) {
    case 'complementary': {
      colors.push(seedHex);
      colors.push(hslToHex(wrapHue(h + 180), s, l));
      for (let i = 2; i < count; i++) {
        const t = i / (count - 1);
        colors.push(hslToHex(wrapHue(h + 180 * t), Math.max(20, s - 15 + 30 * t), Math.max(20, Math.min(85, l - 20 + 40 * t))));
      }
      break;
    }
    case 'analogous': {
      const spread = 30;
      const totalSpread = spread * (count - 1);
      const startHue = h - totalSpread / 2;
      for (let i = 0; i < count; i++) {
        const ch = wrapHue(startHue + spread * i);
        const sl = Math.max(20, Math.min(85, l - 10 + 20 * (i / (count - 1))));
        colors.push(hslToHex(ch, s, sl));
      }
      break;
    }
    case 'triadic':
    case 'split-complementary': {
      const offsets = type === 'triadic' ? [0, 120, 240] : [0, 150, 210];
      const satDrop = type === 'triadic' ? 20 : 15;
      colors.push(seedHex);
      colors.push(hslToHex(wrapHue(h + offsets[1]), s, l));
      colors.push(hslToHex(wrapHue(h + offsets[2]), s, l));
      for (let i = 3; i < count; i++) {
        const offset = offsets[(i - 3) % 3];
        colors.push(hslToHex(wrapHue(h + offset), Math.max(20, s - satDrop), Math.max(25, Math.min(80, l + (i % 2 ? 15 : -15)))));
      }
      break;
    }
    case 'monochromatic': {
      for (let i = 0; i < count; i++) {
        const t = i / (count - 1);
        const sl = 20 + t * 60;
        const ss = Math.max(20, s - 20 + 40 * (1 - Math.abs(t - 0.5) * 2));
        colors.push(hslToHex(h, ss, sl));
      }
      break;
    }
    default:
      return generateHarmony(seedHex, 'analogous', count);
  }
  return colors.slice(0, count);
}

// ---- Concept mapping ----
const CONCEPT_MAP = [
  { keys: ['ocean', 'sea', 'water', 'aqua', 'marine'], hueRange: [180, 220], sat: [60, 90], lit: [40, 65] },
  { keys: ['sunset', 'sunrise', 'dawn', 'dusk'], hueRange: [0, 40], sat: [70, 95], lit: [45, 65] },
  { keys: ['forest', 'nature', 'green', 'jungle', 'plant'], hueRange: [80, 160], sat: [40, 75], lit: [30, 55] },
  { keys: ['cyberpunk', 'neon', 'synthwave', 'retro'], hueRange: [270, 330], sat: [80, 100], lit: [45, 65] },
  { keys: ['fire', 'warm', 'hot', 'flame', 'lava'], hueRange: [0, 30], sat: [80, 100], lit: [40, 60] },
  { keys: ['ice', 'cool', 'cold', 'winter', 'frost'], hueRange: [180, 240], sat: [30, 60], lit: [55, 75] },
  { keys: ['candy', 'sweet', 'pastel', 'soft'], hueRange: [0, 360], sat: [30, 55], lit: [70, 85] },
  { keys: ['earth', 'ground', 'desert', 'sand', 'clay'], hueRange: [20, 50], sat: [30, 55], lit: [35, 55] },
  { keys: ['night', 'dark', 'space', 'midnight', 'void'], hueRange: [220, 280], sat: [40, 70], lit: [10, 30] },
  { keys: ['gold', 'luxury', 'royal', 'elegant', 'rich'], hueRange: [40, 55], sat: [70, 95], lit: [40, 60] },
];

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function rand(min, max, seed) {
  const x = Math.sin(seed) * 10000;
  return min + (x - Math.floor(x)) * (max - min);
}

function generateFromConcept(concept, count) {
  const lower = concept.toLowerCase();
  let matched = null;
  for (const entry of CONCEPT_MAP) {
    if (entry.keys.some(k => lower.includes(k))) { matched = entry; break; }
  }

  count = count || 5;
  const colors = [];
  const seed = hashString(concept);

  if (matched) {
    const [hueMin, hueMax] = matched.hueRange;
    const [satMin, satMax] = matched.sat;
    const [litMin, litMax] = matched.lit;
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const h = wrapHue(hueMin + t * (hueMax - hueMin) + rand(-15, 15, seed + i));
      const s = satMin + rand(0, satMax - satMin, seed + i + 100);
      const l = litMin + t * (litMax - litMin) + rand(-5, 5, seed + i + 200);
      colors.push(hslToHex(h, Math.max(0, Math.min(100, s)), Math.max(5, Math.min(95, l))));
    }
  } else {
    const seedHue = seed % 360;
    const seedHex = hslToHex(seedHue, 65, 50);
    return { colors: generateHarmony(seedHex, 'analogous', count || 5), type: 'analogous' };
  }

  return { colors, type: 'custom' };
}

function buildGradientCSS(colors) {
  const stops = colors.map((c, i) => `${c} ${(i / (colors.length - 1) * 100).toFixed(1)}%`).join(', ');
  return `linear-gradient(to right, ${stops})`;
}

function updateGradientBar() {
  if (palette.colors.length === 0) {
    gradientBar.style.background = 'var(--border)';
    return;
  }
  gradientBar.style.background = buildGradientCSS(palette.colors);
}

// ---- Update header ----
function updateHeader() {
  paletteNameEl.textContent = palette.name || 'Color Palette';
  typeBadgeEl.textContent = palette.type || 'custom';
  modeBadgeEl.textContent = displayMode;
}

// ---- Click-to-copy ----
function copyColor(hexColor, el) {
  const hex = hexColor.toUpperCase();
  navigator.clipboard.writeText(hex).then(() => {
    showCopyFeedback(el);
  });
  if (typeof mup !== 'undefined' && mup.notifyInteraction) {
    mup.notifyInteraction('color-copy', 'Copied ' + hex, { color: hex });
  }
}

function showCopyFeedback(el) {
  const feedback = document.createElement('div');
  feedback.textContent = 'Copied!';
  feedback.style.cssText =
    'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);' +
    'background:rgba(0,0,0,0.7);color:#fff;padding:4px 12px;' +
    'border-radius:4px;font-size:12px;pointer-events:none;' +
    'animation:fadeOut 0.8s ease forwards;';
  el.appendChild(feedback);
  setTimeout(() => feedback.remove(), 800);
}

// ---- Render functions ----
function stopWaves() {
  if (wavesAnimId) { cancelAnimationFrame(wavesAnimId); wavesAnimId = null; }
  canvasEl.style.display = 'none';
}

function render() {
  stopWaves();
  mainEl.innerHTML = '';
  updateHeader();
  updateGradientBar();
  syncControlsUI();

  if (palette.colors.length === 0) {
    mainEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text2);font-size:12px;">No palette set</div>';
    return;
  }

  switch (displayMode) {
    case 'swatches': renderSwatches(); break;
    case 'gradient': renderGradient(); break;
    case 'circles': renderCircles(); break;
    case 'waves': renderWaves(); break;
    default: renderSwatches();
  }
}

function renderSwatches() {
  const container = document.createElement('div');
  container.className = 'swatches-container';
  palette.colors.forEach((color, i) => {
    const swatch = document.createElement('div');
    swatch.className = 'swatch';
    swatch.style.backgroundColor = color;
    const tc = textColorFor(color);

    let inner = '';
    if (showContrast) {
      const rWhite = contrastRatio(color, '#ffffff');
      const rBlack = contrastRatio(color, '#000000');
      const wLabel = wcagLabel(rWhite);
      const bLabel = wcagLabel(rBlack);
      const wClass = wLabel === 'Fail' ? 'fail' : 'pass';
      const bClass = bLabel === 'Fail' ? 'fail' : 'pass';
      inner += `<div class="swatch-contrast" style="color:${tc}"><span class="${wClass}">W:${wLabel}</span> <span class="${bClass}">B:${bLabel}</span></div>`;
    }
    if (showNames) {
      inner += `<div class="swatch-hex" style="color:${tc}">${color.toUpperCase()}</div>`;
    }
    swatch.innerHTML = inner;
    swatch.addEventListener('click', () => copyColor(color, swatch));
    container.appendChild(swatch);
    setTimeout(() => swatch.classList.add('visible'), 50 * i);
  });
  mainEl.appendChild(container);
}

function renderGradient() {
  const container = document.createElement('div');
  container.className = 'gradient-container';
  const display = document.createElement('div');
  display.className = 'gradient-display';
  display.style.background = buildGradientCSS(palette.colors);
  container.appendChild(display);

  const stopsRow = document.createElement('div');
  stopsRow.className = 'gradient-stops';
  palette.colors.forEach((color, i) => {
    const stop = document.createElement('div');
    stop.className = 'gradient-stop';
    stop.style.color = color;
    stop.textContent = color.toUpperCase();
    stop.addEventListener('click', () => copyColor(color, stop));
    stopsRow.appendChild(stop);
    setTimeout(() => stop.classList.add('visible'), 80 * i);
  });
  container.appendChild(stopsRow);
  mainEl.appendChild(container);
}

function renderCircles() {
  const container = document.createElement('div');
  container.className = 'circles-container';
  const count = palette.colors.length;
  const maxDiam = Math.min(120, Math.max(40, 300 / count));
  const overlap = Math.max(0, maxDiam * 0.15);

  palette.colors.forEach((color, i) => {
    const circle = document.createElement('div');
    circle.className = 'circle';
    circle.style.width = maxDiam + 'px';
    circle.style.height = maxDiam + 'px';
    circle.style.backgroundColor = color;
    if (i > 0) circle.style.marginLeft = -overlap + 'px';
    circle.style.zIndex = count - i;
    circle.style.animationDelay = (i * 0.4) + 's';

    if (showNames) {
      const hex = document.createElement('div');
      hex.className = 'circle-hex';
      hex.style.color = textColorFor(color);
      hex.textContent = color.toUpperCase();
      circle.appendChild(hex);
    }
    circle.addEventListener('click', () => copyColor(color, circle));
    container.appendChild(circle);
    setTimeout(() => circle.classList.add('visible'), 60 * i);
  });
  mainEl.appendChild(container);
}

function renderWaves() {
  canvasEl.style.display = 'block';
  const ctx = canvasEl.getContext('2d');
  let time = 0;
  let cachedW = 0, cachedH = 0;

  function resizeCanvas() {
    const rect = mainEl.getBoundingClientRect();
    if (rect.width !== cachedW || rect.height !== cachedH) {
      cachedW = rect.width;
      cachedH = rect.height;
      canvasEl.width = cachedW * devicePixelRatio;
      canvasEl.height = cachedH * devicePixelRatio;
      canvasEl.style.width = cachedW + 'px';
      canvasEl.style.height = cachedH + 'px';
    }
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }

  function draw() {
    resizeCanvas();
    ctx.clearRect(0, 0, cachedW, cachedH);

    const count = palette.colors.length;
    palette.colors.forEach((color, i) => {
      ctx.beginPath();
      ctx.globalAlpha = 0.5;
      const amp = cachedH * 0.15;
      const freq = 0.01 + i * 0.003;
      const phase = time * (0.02 + i * 0.005);
      const yBase = cachedH * (0.3 + 0.4 * (i / Math.max(1, count - 1)));
      ctx.moveTo(0, cachedH);
      for (let x = 0; x <= cachedW; x += 2) {
        const y = yBase + Math.sin(x * freq + phase) * amp + Math.sin(x * freq * 0.5 + phase * 1.3) * amp * 0.5;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(cachedW, cachedH);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    time++;
    wavesAnimId = requestAnimationFrame(draw);
  }
  draw();

  canvasEl.onclick = (e) => {
    if (palette.colors.length === 0) return;
    const rect = canvasEl.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const count = palette.colors.length;
    const idx = Math.round((y / rect.height - 0.3) / 0.4 * (count - 1));
    const clamped = Math.max(0, Math.min(count - 1, idx));
    copyColor(palette.colors[clamped], mainEl);
  };
}

// ---- Set palette and re-render ----
function applyPalette(colors, name, type) {
  palette.colors = colors.map(c => c.startsWith('#') ? c : '#' + c);
  palette.name = name || palette.name;
  palette.type = type || 'custom';
  render();
  mup.emitEvent('palette-changed', { colors: palette.colors, name: palette.name, type: palette.type });
  mup.updateState(`${palette.name} (${palette.colors.length} colors, ${palette.type})`, {
    colors: palette.colors, name: palette.name, type: palette.type, displayMode
  });
}

// ---- Controls sync & handlers ----
function syncControlsUI() {
  modeBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === displayMode);
  });
  contrastToggleBtn.classList.toggle('active', showContrast);
  namesToggleBtn.classList.toggle('active', showNames);
}

modeBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    displayMode = btn.dataset.mode;
    render();
    if (typeof mup !== 'undefined' && mup.notifyInteraction) {
      mup.notifyInteraction('mode-change', `Switched to ${displayMode}`, { mode: displayMode });
    }
  });
});

contrastToggleBtn.addEventListener('click', () => {
  showContrast = !showContrast;
  render();
  if (typeof mup !== 'undefined' && mup.notifyInteraction) {
    mup.notifyInteraction('toggle-contrast', `Contrast ${showContrast ? 'on' : 'off'}`, { showContrast });
  }
});

namesToggleBtn.addEventListener('click', () => {
  showNames = !showNames;
  render();
  if (typeof mup !== 'undefined' && mup.notifyInteraction) {
    mup.notifyInteraction('toggle-names', `Names ${showNames ? 'on' : 'off'}`, { showNames });
  }
});

const colorCountSlider = document.getElementById('colorCount');
const colorCountLabel = document.getElementById('colorCountLabel');

colorCountSlider.addEventListener('input', () => {
  colorCountLabel.textContent = colorCountSlider.value;
});

conceptInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const concept = conceptInput.value.trim();
    if (!concept) return;
    const count = parseInt(colorCountSlider.value) || 5;
    const result = generateFromConcept(concept, count);
    applyPalette(result.colors, concept, result.type);
    conceptInput.value = '';
    if (typeof mup !== 'undefined' && mup.notifyInteraction) {
      mup.notifyInteraction('generate-concept', `Generated palette for "${concept}" (${count} colors)`, { concept, count, colors: result.colors });
    }
  }
});

// ---- MUP Functions ----
mup.registerFunction('setPalette', ({ colors, name, type }) => {
  if (!colors || !Array.isArray(colors) || colors.length === 0) {
    return { content: [{ type: 'text', text: 'Error: colors array is required and must be non-empty.' }], isError: true };
  }
  applyPalette(colors, name || 'Custom Palette', type || 'custom');
  return { content: [{ type: 'text', text: `Palette "${palette.name}" set with ${palette.colors.length} colors.` }], isError: false };
});

mup.registerFunction('generateFromSeed', ({ seed, type, count }) => {
  if (!seed) {
    return { content: [{ type: 'text', text: 'Error: seed hex color is required.' }], isError: true };
  }
  const harmonyType = type || 'analogous';
  const n = Math.max(3, Math.min(8, count || 5));
  const colors = generateHarmony(seed, harmonyType, n);
  applyPalette(colors, `${harmonyType} from ${seed}`, harmonyType);
  return { content: [{ type: 'text', text: `Generated ${harmonyType} palette with ${n} colors from seed ${seed}.` }], isError: false };
});

mup.registerFunction('generateFromConcept', ({ concept }) => {
  if (!concept) {
    return { content: [{ type: 'text', text: 'Error: concept string is required.' }], isError: true };
  }
  const result = generateFromConcept(concept);
  applyPalette(result.colors, concept, result.type);
  return { content: [{ type: 'text', text: `Generated palette for concept "${concept}" with ${result.colors.length} colors.` }], isError: false };
});

mup.registerFunction('setDisplay', ({ mode, showContrast: sc, showNames: sn }) => {
  if (mode) displayMode = mode;
  if (sc !== undefined) showContrast = sc;
  if (sn !== undefined) showNames = sn;
  render();
  return { content: [{ type: 'text', text: `Display: ${displayMode}, contrast: ${showContrast}, names: ${showNames}` }], isError: false };
});

mup.registerFunction('exportCSS', () => {
  if (palette.colors.length === 0) {
    return { content: [{ type: 'text', text: 'No palette set. Use setPalette or generateFromSeed first.' }], isError: true };
  }
  const lines = palette.colors.map((c, i) => `  --palette-${i + 1}: ${c};`);
  const css = `:root {\n${lines.join('\n')}\n}`;
  return { content: [{ type: 'text', text: css }], isError: false };
});

// ---- MUP lifecycle ----
mup.onReady(({ theme }) => {
  if (theme === 'dark') document.body.classList.add('dark');
  render();
  mup.updateState('Color Palette ready', {});
});

mup.onThemeChange((theme) => {
  document.body.classList.toggle('dark', theme === 'dark');
});
