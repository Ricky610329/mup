// ============================================================
// Star Map MUP — app.js — Entry point
// ============================================================
// This file is loaded LAST. All other modules (projection.js,
// overlays.js, render.js, interaction.js, settings.js) and data
// files (data/stars.js, data/constellations.js, data/deep-sky.js)
// are loaded before this.

// ---- Parsed star objects (from data/stars.js) ----
const stars = STARS.map(([name, ra, dec, mag, con, spec]) => ({
  name, ra, dec, mag, con,
  spectral: spec || null,
  phase: Math.random() * Math.PI * 2,
  speed: 0.5 + Math.random() * 1.5
}));

// Star lookup by name (case-insensitive)
const starByName = {};
stars.forEach(s => { starByName[s.name.toLowerCase()] = s; });

// Pre-compute sphere positions
stars.forEach(s => {
  [s.sx, s.sy, s.sz] = raDecToSphere(s.ra, s.dec);
});

// ---- Background stars on unit sphere ----
const BG_STARS = Array.from({ length: 300 }, () => {
  const ra = Math.random() * 2 * Math.PI;
  const dec = Math.asin(2 * Math.random() - 1);
  return {
    x: Math.cos(dec) * Math.cos(ra), y: Math.sin(dec), z: Math.cos(dec) * Math.sin(ra),
    r: 0.3 + Math.random() * 0.7,
    alpha: 0.2 + Math.random() * 0.4,
    phase: Math.random() * Math.PI * 2,
    speed: 0.3 + Math.random() * 0.8
  };
});

// ---- View state (spherical) ----
let view = { lon: 0, lat: 0, fov: 60 };
const FOV_MIN = 10, FOV_MAX = 120;

// ---- Observer location & time ----
let observer = { lat: 25.03, lon: 121.56 }; // Taiwan (degrees)

// ---- Overlay state ----
let overlays = { ecliptic: false, milkyway: false, horizon: true };

// ---- Active constellations ----
const activeConstellations = new Map(); // name → { revealStart }

// ---- Navigation animation ----
let nav = null;

// ---- Canvas setup ----
const canvas = document.getElementById('starCanvas');
const ctx = canvas.getContext('2d');

function resize() {
  canvas.width = canvas.clientWidth * devicePixelRatio;
  canvas.height = canvas.clientHeight * devicePixelRatio;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
}
resize();
new ResizeObserver(resize).observe(canvas);

// ---- Navigation helpers ----
function animateNav(timestamp) {
  if (!nav) return;
  const t = Math.min(1, (timestamp - nav.startTime) / nav.duration);
  const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  // Shortest-path lon interpolation
  let dLon = nav.targetLon - nav.startLon;
  while (dLon > Math.PI) dLon -= 2 * Math.PI;
  while (dLon < -Math.PI) dLon += 2 * Math.PI;
  view.lon = nav.startLon + dLon * ease;
  view.lat = nav.startLat + (nav.targetLat - nav.startLat) * ease;
  view.fov = nav.startFov + (nav.targetFov - nav.startFov) * ease;
  if (t >= 1) nav = null;
}

function navigateTo(lon, lat, fov, duration = 800) {
  nav = {
    startLon: view.lon, startLat: view.lat, startFov: view.fov,
    targetLon: lon, targetLat: lat, targetFov: fov,
    startTime: performance.now(), duration
  };
}

// ---- Info card ----
const infoCard = document.getElementById('infoCard');
const infoTitle = document.getElementById('infoTitle');
const infoText = document.getElementById('infoText');

function showInfo(title, text) {
  infoTitle.textContent = title;
  infoText.textContent = text;
  infoCard.classList.remove('hidden');
}

function hideInfo() {
  infoCard.classList.add('hidden');
}

// ---- Constellation helpers ----
function findConstellation(name) {
  const lower = name.toLowerCase();
  for (const key of Object.keys(CONSTELLATIONS)) {
    if (key.toLowerCase() === lower) return key;
  }
  for (const key of Object.keys(CONSTELLATIONS)) {
    if (key.toLowerCase().includes(lower) || lower.includes(key.toLowerCase())) return key;
  }
  return null;
}

function constellationCenter(name) {
  const con = CONSTELLATIONS[name];
  if (!con) return null;
  const names = [...new Set(con.lines.flat())];
  const cStars = names.map(n => starByName[n.toLowerCase()]).filter(Boolean);
  if (!cStars.length) return null;
  let ax = 0, ay = 0, az = 0;
  cStars.forEach(s => { ax += s.sx; ay += s.sy; az += s.sz; });
  return sphereToLonLat(ax / cStars.length, ay / cStars.length, az / cStars.length);
}

function autoFovForConstellation(name) {
  const con = CONSTELLATIONS[name];
  if (!con) return 40;
  const names = [...new Set(con.lines.flat())];
  const cStars = names.map(n => starByName[n.toLowerCase()]).filter(Boolean);
  if (cStars.length < 2) return 30;
  let maxAngle = 0;
  for (let i = 0; i < cStars.length; i++) {
    for (let j = i + 1; j < cStars.length; j++) {
      const dot = cStars[i].sx * cStars[j].sx + cStars[i].sy * cStars[j].sy + cStars[i].sz * cStars[j].sz;
      const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
      if (angle > maxAngle) maxAngle = angle;
    }
  }
  const fov = maxAngle * (180 / Math.PI) * 2.5;
  return Math.max(15, Math.min(80, fov));
}

// ---- Helper: set view to observer's local sky ----
function setViewToLocalSky(animate) {
  const lst = computeLST();
  const zenithRA = lst / 15; // hours
  const targetLon = zenithRA * (2 * Math.PI / 24);
  const targetLat = (observer.lat - 45) * Math.PI / 180;
  if (animate) {
    navigateTo(targetLon, targetLat, 60, 1000);
  } else {
    view.lon = targetLon;
    view.lat = targetLat;
    view.fov = 60;
  }
}

// ---- MUP function registrations ----
mup.registerFunction('showConstellation', async (args) => {
  const key = findConstellation(args.name);
  if (!key) {
    const available = Object.keys(CONSTELLATIONS).join(', ');
    return { content: [{ type: 'text', text: `Unknown constellation "${args.name}". Available: ${available}` }], isError: true };
  }
  activeConstellations.set(key, { revealStart: performance.now() });
  const center = constellationCenter(key);
  const fov = autoFovForConstellation(key);
  if (center) navigateTo(center.lon, center.lat, fov);
  mup.updateState(`Showing ${key}`, { activeConstellations: [...activeConstellations.keys()] });
  const starCount = [...new Set(CONSTELLATIONS[key].lines.flat())].length;
  return { content: [{ type: 'text', text: `Showing ${CONSTELLATIONS[key].displayName} (${starCount} stars, ${CONSTELLATIONS[key].lines.length} connections)` }], isError: false };
});

mup.registerFunction('navigate', async (args) => {
  const conKey = findConstellation(args.target);
  if (conKey) {
    const center = constellationCenter(conKey);
    const fov = args.zoom ? Math.max(FOV_MIN, Math.min(FOV_MAX, 60 / args.zoom)) : autoFovForConstellation(conKey);
    if (center) navigateTo(center.lon, center.lat, fov);
    return { content: [{ type: 'text', text: `Navigating to ${CONSTELLATIONS[conKey].displayName}` }], isError: false };
  }
  const star = starByName[args.target.toLowerCase()];
  if (star) {
    const { lon, lat } = sphereToLonLat(star.sx, star.sy, star.sz);
    const fov = args.zoom ? Math.max(FOV_MIN, Math.min(FOV_MAX, 60 / args.zoom)) : 15;
    navigateTo(lon, lat, fov);
    return { content: [{ type: 'text', text: `Navigating to ${star.name}` }], isError: false };
  }
  return { content: [{ type: 'text', text: `Unknown target "${args.target}". Try a constellation or star name.` }], isError: true };
});

mup.registerFunction('setInfo', async (args) => {
  if (!args.title && !args.text) {
    hideInfo();
    return { content: [{ type: 'text', text: 'Info card hidden' }], isError: false };
  }
  showInfo(args.title || '', args.text || '');
  return { content: [{ type: 'text', text: 'Info card updated' }], isError: false };
});

mup.registerFunction('reset', async () => {
  activeConstellations.clear();
  nav = null;
  observer.lat = 25.03;
  observer.lon = 121.56;
  overlays = { ecliptic: false, milkyway: false, horizon: true };
  setViewToLocalSky();
  view.fov = 60;
  hideInfo();
  hoveredStar = null;
  mup.updateState('Ready', {});
  return { content: [{ type: 'text', text: 'View reset to Taiwan sky' }], isError: false };
});

mup.registerFunction('getView', async () => {
  const active = [...activeConstellations.keys()];
  const ra = ((view.lon * 24 / (2 * Math.PI)) % 24 + 24) % 24;
  const dec = view.lat * 180 / Math.PI;
  const summary = `Center: RA ${ra.toFixed(1)}h, Dec ${dec.toFixed(1)}°, FOV: ${view.fov.toFixed(0)}°` +
    `. Observer: ${observer.lat.toFixed(1)}°${observer.lat >= 0 ? 'N' : 'S'}, ${observer.lon.toFixed(1)}°${observer.lon >= 0 ? 'E' : 'W'}` +
    `. Overlays: ${Object.entries(overlays).filter(([,v]) => v).map(([k]) => k).join(', ') || 'none'}` +
    (active.length ? `. Showing: ${active.join(', ')}` : '');
  return {
    content: [
      { type: 'text', text: summary },
      { type: 'data', data: { center: { ra: +ra.toFixed(2), dec: +dec.toFixed(2) }, fov: +view.fov.toFixed(1), observer: { lat: observer.lat, lon: observer.lon }, overlays: { ...overlays }, activeConstellations: active } }
    ],
    isError: false
  };
});

mup.registerFunction('setLocation', async (args) => {
  observer.lat = args.latitude;
  observer.lon = args.longitude;
  // Update view to look south at comfortable angle
  const lst = computeLST();
  view.lon = lst * Math.PI / 180;
  view.lat = Math.max(-Math.PI / 4, (observer.lat - 45) * Math.PI / 180);
  return { content: [{ type: 'text', text: `Location set to ${args.latitude.toFixed(1)}°${args.latitude >= 0 ? 'N' : 'S'}, ${args.longitude.toFixed(1)}°${args.longitude >= 0 ? 'E' : 'W'}` }], isError: false };
});

mup.registerFunction('toggleOverlay', async (args) => {
  const name = args.overlay.toLowerCase();
  if (!['ecliptic', 'milkyway', 'horizon'].includes(name)) {
    return { content: [{ type: 'text', text: 'Unknown overlay. Use: ecliptic, milkyway, horizon' }], isError: true };
  }
  overlays[name] = args.visible !== undefined ? args.visible : !overlays[name];
  if (window._syncSettingsUI) window._syncSettingsUI();
  return { content: [{ type: 'text', text: `${name} overlay ${overlays[name] ? 'shown' : 'hidden'}` }], isError: false };
});

// ---- MUP lifecycle ----
mup.onReady(({ theme }) => {
  if (theme === 'dark') document.body.classList.add('dark');
  setViewToLocalSky();
  mup.updateState('Star Map ready — drag to rotate, scroll to zoom, click stars', {});
});

mup.onThemeChange((theme) => {
  document.body.classList.toggle('dark', theme === 'dark');
});

// ---- Initialize modules that need canvas/globals ----
initInteraction(); // interaction.js
initSettings();    // settings.js

// ---- Start the render loop (render is defined in render.js) ----
requestAnimationFrame(render);
