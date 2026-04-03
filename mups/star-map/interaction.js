// ============================================================
// Star Map — interaction.js — Mouse/touch/momentum interaction
// ============================================================
// Depends on globals (defined in app.js):
//   view, canvas, nav, FOV_MIN, FOV_MAX, showInfo
// Depends on functions (defined in projection.js):
//   sphereToScreen
// Depends on globals (defined in app.js):
//   stars

// ---- Shared state: hovered star (read by render.js) ----
let hoveredStar = null;

// ---- Interaction state ----
let dragging = false, dragStart = null, dragViewStart = null, didDrag = false;
let velocity = { dLon: 0, dLat: 0 };
let lastMouse = null, lastMoveTime = 0;
const FRICTION = 0.94;
let zoomVelocity = 0;
const ZOOM_FRICTION = 0.92;

// ---- Touch state ----
let touches = [], lastTouchDist = null;

// ---- Momentum physics ----
function applyMomentum() {
  if (dragging || nav) return;
  // Pan momentum (angular)
  if (Math.abs(velocity.dLon) > 0.0001 || Math.abs(velocity.dLat) > 0.0001) {
    view.lon += velocity.dLon;
    view.lat += velocity.dLat;
    view.lat = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, view.lat));
    velocity.dLon *= FRICTION;
    velocity.dLat *= FRICTION;
  } else {
    velocity.dLon = 0; velocity.dLat = 0;
  }
  // Zoom momentum (FOV)
  if (Math.abs(zoomVelocity) > 0.001) {
    view.fov = Math.max(FOV_MIN, Math.min(FOV_MAX, view.fov * (1 + zoomVelocity)));
    zoomVelocity *= ZOOM_FRICTION;
  } else {
    zoomVelocity = 0;
  }
}

// ---- Find nearest star to screen coordinates ----
function findNearestStar(sx, sy, maxDist) {
  let best = null, bestDist = maxDist;
  stars.forEach(s => {
    const proj = sphereToScreen(s.sx, s.sy, s.sz);
    if (!proj) return;
    const d = Math.hypot(proj[0] - sx, proj[1] - sy);
    if (d < bestDist) { bestDist = d; best = s; }
  });
  return best;
}

// ---- Initialize all event listeners (called from app.js after canvas is ready) ----
function initInteraction() {

// ---- Mouse: drag to pan ----
canvas.addEventListener('mousedown', e => {
  dragging = true;
  didDrag = false;
  dragStart = { x: e.clientX, y: e.clientY };
  dragViewStart = { lon: view.lon, lat: view.lat };
  lastMouse = { x: e.clientX, y: e.clientY };
  lastMoveTime = performance.now();
  velocity.dLon = 0; velocity.dLat = 0;
  document.body.classList.add('dragging');
});

window.addEventListener('mousemove', e => {
  if (dragging) {
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didDrag = true;
    const sensitivity = view.fov * Math.PI / 180;
    view.lon = dragViewStart.lon - dx / canvas.clientWidth * sensitivity;
    view.lat = dragViewStart.lat + dy / canvas.clientHeight * sensitivity;
    view.lat = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, view.lat));
    nav = null;
    // Track angular velocity
    const now = performance.now();
    const dt = now - lastMoveTime;
    if (dt > 0) {
      const ddx = e.clientX - lastMouse.x;
      const ddy = e.clientY - lastMouse.y;
      velocity.dLon = -(ddx / canvas.clientWidth * sensitivity) * (16 / dt);
      velocity.dLat = (ddy / canvas.clientHeight * sensitivity) * (16 / dt);
    }
    lastMouse = { x: e.clientX, y: e.clientY };
    lastMoveTime = now;
  } else {
    // Hover detection
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    hoveredStar = findNearestStar(mx, my, 18);
    // Compass hover
    const compassDist = Math.hypot(mx - (canvas.clientWidth - 44), my - 90);
    canvas.style.cursor = (hoveredStar || compassDist <= 34) ? 'pointer' : 'grab';
  }
});

window.addEventListener('mouseup', () => {
  if (performance.now() - lastMoveTime > 50) {
    velocity.dLon = 0; velocity.dLat = 0;
  }
  dragging = false;
  document.body.classList.remove('dragging');
  if (!hoveredStar) canvas.style.cursor = 'grab';
});

// ---- Mouse: scroll to zoom ----
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const impulse = e.deltaY > 0 ? 0.025 : -0.025; // scroll down = zoom out = increase FOV
  zoomVelocity += impulse;
  nav = null;
}, { passive: false });

// ---- Touch: drag to pan, pinch to zoom ----
canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  touches = [...e.touches];
  if (touches.length === 1) {
    dragging = true;
    didDrag = false;
    dragStart = { x: touches[0].clientX, y: touches[0].clientY };
    dragViewStart = { lon: view.lon, lat: view.lat };
    lastMouse = { x: touches[0].clientX, y: touches[0].clientY };
    lastMoveTime = performance.now();
    velocity.dLon = 0; velocity.dLat = 0;
  } else if (touches.length === 2) {
    lastTouchDist = Math.hypot(touches[1].clientX - touches[0].clientX, touches[1].clientY - touches[0].clientY);
  }
}, { passive: false });

canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  touches = [...e.touches];
  if (touches.length === 1 && dragging) {
    const dx = touches[0].clientX - dragStart.x;
    const dy = touches[0].clientY - dragStart.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didDrag = true;
    const sensitivity = view.fov * Math.PI / 180;
    view.lon = dragViewStart.lon - dx / canvas.clientWidth * sensitivity;
    view.lat = dragViewStart.lat + dy / canvas.clientHeight * sensitivity;
    view.lat = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, view.lat));
    nav = null;
    const now = performance.now();
    const dt = now - lastMoveTime;
    if (dt > 0) {
      const ddx = touches[0].clientX - lastMouse.x;
      const ddy = touches[0].clientY - lastMouse.y;
      velocity.dLon = -(ddx / canvas.clientWidth * sensitivity) * (16 / dt);
      velocity.dLat = (ddy / canvas.clientHeight * sensitivity) * (16 / dt);
    }
    lastMouse = { x: touches[0].clientX, y: touches[0].clientY };
    lastMoveTime = now;
  } else if (touches.length === 2 && lastTouchDist) {
    const dist = Math.hypot(touches[1].clientX - touches[0].clientX, touches[1].clientY - touches[0].clientY);
    const scale = dist / lastTouchDist;
    view.fov = Math.max(FOV_MIN, Math.min(FOV_MAX, view.fov / scale));
    zoomVelocity = (1 / scale - 1) * 0.3;
    lastTouchDist = dist;
    nav = null;
  }
}, { passive: false });

canvas.addEventListener('touchend', e => {
  if (e.touches.length === 0) {
    if (performance.now() - lastMoveTime > 50) {
      velocity.dLon = 0; velocity.dLat = 0;
    }
    dragging = false;
    lastTouchDist = null;
  }
  touches = [...e.touches];
});

// ---- Click: compass or star ----
canvas.addEventListener('click', e => {
  if (didDrag) return;
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  // Compass hit: top-right area (cx = w-44, cy = 90, radius = 28)
  const w = canvas.clientWidth;
  const compassDist = Math.hypot(mx - (w - 44), my - 90);
  if (compassDist <= 34) {
    setViewToLocalSky(true); // animate
    return;
  }
  const star = findNearestStar(mx, my, 18);
  if (star) {
    showInfo(star.name, `Magnitude: ${star.mag.toFixed(2)}  |  RA: ${star.ra.toFixed(1)}h  Dec: ${star.dec.toFixed(1)}°`);
    mup.notifyInteraction('star-tap', `Tapped ${star.name} (${star.con})`, { star: star.name, constellation: star.con, magnitude: star.mag });
  }
});

} // end initInteraction
