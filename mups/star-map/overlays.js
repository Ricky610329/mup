// ============================================================
// Star Map — overlays.js — Horizon, ecliptic, milky way, sun
// ============================================================
// Depends on globals (defined in app.js):
//   observer, overlays, ctx
// Depends on functions (defined in projection.js):
//   raDecToSphere, sphereToScreen

// ---- Local Sidereal Time (returns degrees 0-360) ----
function computeLST() {
  const J2000 = Date.UTC(2000, 0, 1, 12, 0, 0);
  const d = (Date.now() - J2000) / 86400000;
  const GMST = (280.46061837 + 360.98564736629 * d) % 360;
  return ((GMST + observer.lon) % 360 + 360) % 360;
}

// ---- Star altitude above horizon (returns radians) ----
function starAltitude(ra_hours, dec_deg) {
  const lst = computeLST();
  const ha = (lst - ra_hours * 15) * Math.PI / 180;
  const lat = observer.lat * Math.PI / 180;
  const dec = dec_deg * Math.PI / 180;
  return Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha));
}

// ---- Sun position (approximate) ----
function getSunPosition() {
  const J2000 = Date.UTC(2000, 0, 1, 12, 0, 0);
  const d = (Date.now() - J2000) / 86400000;
  const L = ((280.460 + 0.9856474 * d) % 360 + 360) % 360;
  const g = ((357.528 + 0.9856003 * d) % 360 + 360) % 360;
  const gRad = g * Math.PI / 180;
  const lambda = (L + 1.915 * Math.sin(gRad) + 0.020 * Math.sin(2 * gRad)) * Math.PI / 180;
  const epsilon = 23.439 * Math.PI / 180;
  const ra = Math.atan2(Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(epsilon) * Math.sin(lambda));
  return raDecToSphere(ra * 24 / (2 * Math.PI), dec * 180 / Math.PI);
}

// ---- Ecliptic line points ----
function getEclipticPoints(n = 72) {
  const epsilon = 23.439 * Math.PI / 180;
  const points = [];
  for (let i = 0; i < n; i++) {
    const lon = i * 2 * Math.PI / n;
    const ra = Math.atan2(Math.cos(epsilon) * Math.sin(lon), Math.cos(lon));
    const dec = Math.asin(Math.sin(epsilon) * Math.sin(lon));
    const [x, y, z] = raDecToSphere(ra * 24 / (2 * Math.PI), dec * 180 / Math.PI);
    points.push({ x, y, z });
  }
  return points;
}

// ---- Horizon circle points ----
function getHorizonPoints(n = 72) {
  const lst = computeLST();
  const zenithRA = lst * Math.PI / 180;
  const zenithDec = observer.lat * Math.PI / 180;
  // Zenith vector
  const zx = Math.cos(zenithDec) * Math.cos(zenithRA);
  const zy = Math.sin(zenithDec);
  const zz = Math.cos(zenithDec) * Math.sin(zenithRA);
  // Build orthonormal basis: u = zenith x (0,1,0), normalized
  const ex = -zz, ez = zx;
  const elen = Math.sqrt(ex * ex + ez * ez);
  // Handle degenerate case (observer at pole)
  let ux, uy, uz;
  if (elen < 0.0001) {
    ux = 1; uy = 0; uz = 0;
  } else {
    ux = ex / elen; uy = 0; uz = ez / elen;
  }
  // v = zenith x u
  const vx = zy * uz - zz * uy;
  const vy = zz * ux - zx * uz;
  const vz = zx * uy - zy * ux;

  const points = [];
  for (let i = 0; i < n; i++) {
    const angle = i * 2 * Math.PI / n;
    const cos_a = Math.cos(angle), sin_a = Math.sin(angle);
    points.push({
      x: ux * cos_a + vx * sin_a,
      y: uy * cos_a + vy * sin_a,
      z: uz * cos_a + vz * sin_a
    });
  }
  return points;
}

// ---- Milky Way band ----
function drawMilkyWay() {
  // Galactic north pole
  const gnpRA = 12.85 * 2 * Math.PI / 24;
  const gnpDec = 27.13 * Math.PI / 180;
  const gx = Math.cos(gnpDec) * Math.cos(gnpRA);
  const gy = Math.sin(gnpDec);
  const gz = Math.cos(gnpDec) * Math.sin(gnpRA);

  // Build basis for galactic plane
  const ref = Math.abs(gy) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  let u = { x: gy * ref.z - gz * ref.y, y: gz * ref.x - gx * ref.z, z: gx * ref.y - gy * ref.x };
  let ulen = Math.sqrt(u.x * u.x + u.y * u.y + u.z * u.z);
  u.x /= ulen; u.y /= ulen; u.z /= ulen;
  let v = { x: gy * u.z - gz * u.y, y: gz * u.x - gx * u.z, z: gx * u.y - gy * u.x };

  // Draw a band: for each angle along the galactic equator, draw a short perpendicular strip
  const n = 120;
  for (let i = 0; i < n; i++) {
    const angle = i * 2 * Math.PI / n;
    const cos_a = Math.cos(angle), sin_a = Math.sin(angle);
    // Point on galactic equator
    const px = u.x * cos_a + v.x * sin_a;
    const py = u.y * cos_a + v.y * sin_a;
    const pz = u.z * cos_a + v.z * sin_a;

    // Draw a few points spread perpendicular to the galactic plane
    for (let offset = -12; offset <= 12; offset += 3) {
      const spread = offset * Math.PI / 180;
      const mx = px * Math.cos(spread) + gx * Math.sin(spread);
      const my = py * Math.cos(spread) + gy * Math.sin(spread);
      const mz = pz * Math.cos(spread) + gz * Math.sin(spread);
      const proj = sphereToScreen(mx, my, mz);
      if (!proj) continue;
      const dist = Math.abs(offset);
      const alpha = (1 - dist / 15) * 0.08;
      const size = 2 + Math.random() * 2;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#c8d0f0';
      ctx.beginPath();
      ctx.arc(proj[0], proj[1], size, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

// ---- Draw a path of sphere points as a line ----
function drawSpherePath(points, color, lineWidth, dashed) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  if (dashed) ctx.setLineDash([6, 4]);
  else ctx.setLineDash([]);

  // Project all points, draw segments between visible consecutive pairs
  const projected = points.map(p => sphereToScreen(p.x, p.y, p.z));
  ctx.beginPath();
  let penDown = false;
  for (let i = 0; i <= points.length; i++) {
    const idx = i % points.length;
    const proj = projected[idx];
    if (proj) {
      if (!penDown) {
        ctx.moveTo(proj[0], proj[1]);
        penDown = true;
      } else {
        ctx.lineTo(proj[0], proj[1]);
      }
    } else {
      penDown = false;
    }
  }
  ctx.stroke();
  ctx.setLineDash([]);
}
