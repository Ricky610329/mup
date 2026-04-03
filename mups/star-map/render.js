// ============================================================
// Star Map — render.js — Main render loop, compass, deep sky
// ============================================================
// Depends on globals (defined in app.js):
//   stars, BG_STARS, CONSTELLATIONS, activeConstellations,
//   view, canvas, ctx, overlays, observer, nav
// Depends on globals (defined in interaction.js):
//   hoveredStar
// Depends on functions (defined in projection.js):
//   sphereToScreen, raDecToSphere, getProjectionScale
// Depends on functions (defined in overlays.js):
//   starAltitude, computeLST, getSunPosition, getEclipticPoints,
//   getHorizonPoints, drawMilkyWay, drawSpherePath
// Depends on functions (defined in interaction.js):
//   applyMomentum
// Depends on functions (defined in app.js):
//   animateNav

// ---- Star rendering helpers ----
function starRadius(mag) {
  return Math.max(1, 3.5 - mag * 0.6);
}

function starColor(mag, spectral) {
  if (spectral) {
    switch (spectral) {
      case 'O': case 'B': return '#aac8ff';
      case 'A': return '#eef0ff';
      case 'F': return '#fff8e8';
      case 'G': return '#ffe8a0';
      case 'K': return '#ffc870';
      case 'M': return '#ff9060';
    }
  }
  // fallback based on magnitude
  if (mag < 0.5) return '#fffbe6';
  if (mag < 1.5) return '#fff4d6';
  if (mag < 2.5) return '#e8ecf8';
  return '#c8d0e0';
}

// ---- Deep sky object rendering ----
function drawDeepSky(baseScale) {
  if (typeof DEEP_SKY === 'undefined') return;
  DEEP_SKY.forEach(obj => {
    const [x, y, z] = raDecToSphere(obj.ra, obj.dec);
    const proj = sphereToScreen(x, y, z);
    if (!proj) return;
    const [px, py] = proj;
    if (px < -50 || px > canvas.clientWidth + 50 || py < -50 || py > canvas.clientHeight + 50) return;

    // Dim below horizon if applicable
    if (overlays.horizon) {
      const alt = starAltitude(obj.ra, obj.dec);
      if (alt < 0) return; // don't render deep sky below horizon
    }

    const colors = {
      galaxy: [180, 160, 255],
      nebula: [255, 120, 140],
      cluster: [200, 220, 255],
      planetary: [100, 220, 200],
      globular: [255, 220, 160]
    };
    const rgb = colors[obj.type] || colors.cluster;
    const r = Math.max(8, obj.size * baseScale * 4);

    const grad = ctx.createRadialGradient(px, py, 0, px, py, r);
    grad.addColorStop(0, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.25)`);
    grad.addColorStop(0.4, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.1)`);
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  });
}

// ---- Main render loop ----
function render(timestamp) {
  animateNav(timestamp);
  applyMomentum();

  const w = canvas.clientWidth, h = canvas.clientHeight;
  ctx.clearRect(0, 0, w, h);

  // Background gradient
  const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
  grad.addColorStop(0, '#0d1130');
  grad.addColorStop(1, '#04060f');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  const baseScale = getProjectionScale() / 400;

  // ---- 1. Milky Way (behind everything) ----
  if (overlays.milkyway) {
    drawMilkyWay();
  }

  // ---- 2. Background stars ----
  BG_STARS.forEach(s => {
    const proj = sphereToScreen(s.x, s.y, s.z);
    if (!proj) return;
    const twinkle = s.alpha * (0.6 + 0.4 * Math.sin(timestamp * 0.001 * s.speed + s.phase));
    let alpha = twinkle;
    // Dim below horizon
    if (overlays.horizon) {
      // Approximate RA/Dec from sphere coords for background stars
      const bgRA = Math.atan2(s.z, s.x) * 24 / (2 * Math.PI);
      const bgDec = Math.asin(s.y) * 180 / Math.PI;
      const alt = starAltitude(((bgRA % 24) + 24) % 24, bgDec);
      if (alt < 0) alpha *= 0.15;
    }
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#c8d4f0';
    ctx.beginPath();
    ctx.arc(proj[0], proj[1], s.r, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;

  // ---- 3. Deep sky objects (before constellation lines) ----
  drawDeepSky(baseScale);

  // ---- 4. Constellation lines ----
  activeConstellations.forEach(({ revealStart }, name) => {
    const con = CONSTELLATIONS[name];
    if (!con) return;
    const progress = Math.min(1, (timestamp - revealStart) / 500);
    ctx.strokeStyle = `rgba(80, 140, 255, ${0.45 * progress})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    con.lines.forEach(([a, b]) => {
      const sa = starByName[a.toLowerCase()];
      const sb = starByName[b.toLowerCase()];
      if (!sa || !sb) return;
      const pa = sphereToScreen(sa.sx, sa.sy, sa.sz);
      const pb = sphereToScreen(sb.sx, sb.sy, sb.sz);
      if (!pa || !pb) return;
      ctx.moveTo(pa[0], pa[1]);
      ctx.lineTo(pb[0], pb[1]);
    });
    ctx.stroke();

    // Constellation label at centroid
    if (progress > 0.5) {
      const nameSet = new Set(con.lines.flat().map(n => n.toLowerCase()));
      const cStars = stars.filter(s => nameSet.has(s.name.toLowerCase()));
      if (cStars.length) {
        let ax = 0, ay = 0, az = 0;
        cStars.forEach(s => { ax += s.sx; ay += s.sy; az += s.sz; });
        const len = Math.sqrt(ax * ax + ay * ay + az * az);
        if (len > 0) { ax /= len; ay /= len; az /= len; }
        const proj = sphereToScreen(ax, ay, az);
        if (proj) {
          ctx.globalAlpha = 0.6 * progress;
          ctx.fillStyle = '#80b0ff';
          ctx.font = `${Math.max(11, 13 * baseScale * 0.3)}px system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText(con.displayName, proj[0], proj[1] - 14 * baseScale * 0.5);
          ctx.globalAlpha = 1;
        }
      }
    }
  });

  // ---- 5. Ecliptic line ----
  if (overlays.ecliptic) {
    const eclipticPts = getEclipticPoints(72);
    drawSpherePath(eclipticPts, 'rgba(200, 180, 80, 0.3)', 1.2, true);
  }

  // ---- 6. Horizon line + cardinal directions ----
  if (overlays.horizon) {
    const horizonPts = getHorizonPoints(72);
    drawSpherePath(horizonPts, 'rgba(80, 60, 40, 0.4)', 1.5, false);
    // Cardinal direction labels on horizon
    drawCardinalDirections(baseScale);
  }

  // ---- 7. Catalog stars (with altitude-based dimming) ----
  stars.forEach(s => {
    const proj = sphereToScreen(s.sx, s.sy, s.sz);
    if (!proj) return;
    const [px, py] = proj;
    // Cull off-screen
    if (px < -20 || px > w + 20 || py < -20 || py > h + 20) return;

    const r = starRadius(s.mag) * Math.max(1, baseScale * 0.4);
    const twinkle = 0.7 + 0.3 * Math.sin(timestamp * 0.001 * s.speed + s.phase);

    // Altitude-based dimming
    let alpha = twinkle;
    if (overlays.horizon) {
      const alt = starAltitude(s.ra, s.dec);
      if (alt < 0) {
        alpha = twinkle * 0.12;
      }
    }

    ctx.globalAlpha = alpha;
    ctx.fillStyle = starColor(s.mag, s.spectral);

    // Glow for bright stars
    if (s.mag < 1.5) {
      ctx.shadowColor = starColor(s.mag, s.spectral);
      ctx.shadowBlur = r * 3;
    }

    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;

    // Label for hovered star
    if (s === hoveredStar) {
      ctx.fillStyle = '#e0e8ff';
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(s.name, px, py - r - 6);
    }
  });

  // ---- 8. Sun marker ----
  const sunPos = getSunPosition();
  const sunProj = sphereToScreen(sunPos[0], sunPos[1], sunPos[2]);
  if (sunProj) {
    const [sx, sy] = sunProj;
    // Large glow
    const sunGlow = ctx.createRadialGradient(sx, sy, 0, sx, sy, 20);
    sunGlow.addColorStop(0, 'rgba(255, 240, 120, 0.4)');
    sunGlow.addColorStop(0.5, 'rgba(255, 220, 80, 0.1)');
    sunGlow.addColorStop(1, 'rgba(255, 200, 50, 0)');
    ctx.fillStyle = sunGlow;
    ctx.beginPath();
    ctx.arc(sx, sy, 20, 0, Math.PI * 2);
    ctx.fill();
    // Sun disc
    ctx.fillStyle = '#ffe060';
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(sx, sy, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // ---- 9. Hemisphere boundary circle ----
  const projScale = getProjectionScale();
  const hemisphereR = projScale; // radius of z2=0 boundary on screen
  if (hemisphereR < Math.max(w, h) * 0.8) {
    // Mask outside the hemisphere
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.arc(w / 2, h / 2, hemisphereR, 0, Math.PI * 2, true); // cut out circle
    ctx.fillStyle = 'rgba(4, 6, 15, 0.85)';
    ctx.fill();
    ctx.restore();
    // Glow ring
    const ringGrad = ctx.createRadialGradient(w / 2, h / 2, hemisphereR - 8, w / 2, h / 2, hemisphereR + 4);
    ringGrad.addColorStop(0, 'rgba(60, 100, 200, 0)');
    ringGrad.addColorStop(0.5, 'rgba(60, 100, 200, 0.15)');
    ringGrad.addColorStop(1, 'rgba(60, 100, 200, 0)');
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, hemisphereR, 0, Math.PI * 2);
    ctx.lineWidth = 12;
    ctx.strokeStyle = ringGrad;
    ctx.stroke();
    // Crisp border
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, hemisphereR, 0, Math.PI * 2);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(80, 130, 220, 0.35)';
    ctx.stroke();
  }

  // ---- 10. Compass (top-right) ----
  drawCompass(w, h);

  // ---- 11. Sky dome mini-map (bottom-left) ----
  drawSkyDome(w, h);

  requestAnimationFrame(render);
}

// ---- Compass widget ----
function drawCompass(w, h) {
  const cx = w - 44, cy = 90, radius = 28; // below settings button
  const ra = ((view.lon * 24 / (2 * Math.PI)) % 24 + 24) % 24;
  const dec = view.lat * 180 / Math.PI;
  // Ring rotation: RA direction mapped to compass angle
  const ringAngle = -view.lon;

  ctx.save();
  ctx.translate(cx, cy);

  // Background
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = '#0a0e28';
  ctx.beginPath();
  ctx.arc(0, 0, radius + 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Outer ring
  ctx.strokeStyle = 'rgba(100, 140, 255, 0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.stroke();

  // Rotating RA tick marks and labels
  ctx.save();
  ctx.rotate(ringAngle);
  const labels = ['0h', '6h', '12h', '18h'];
  for (let i = 0; i < 24; i++) {
    const angle = i * (Math.PI * 2 / 24) - Math.PI / 2; // 0h at top
    const cos_a = Math.cos(angle), sin_a = Math.sin(angle);
    const isMajor = i % 6 === 0;
    const isMinor = i % 3 === 0;
    const innerR = isMajor ? radius - 7 : isMinor ? radius - 5 : radius - 3;
    ctx.strokeStyle = isMajor ? 'rgba(100, 180, 255, 0.7)' : 'rgba(100, 140, 255, 0.3)';
    ctx.lineWidth = isMajor ? 1.5 : 0.8;
    ctx.beginPath();
    ctx.moveTo(cos_a * innerR, sin_a * innerR);
    ctx.lineTo(cos_a * radius, sin_a * radius);
    ctx.stroke();
    // Labels for major ticks
    if (isMajor) {
      ctx.fillStyle = 'rgba(160, 200, 255, 0.7)';
      ctx.font = '8px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const lr = radius - 13;
      ctx.save();
      ctx.translate(cos_a * lr, sin_a * lr);
      ctx.rotate(-ringAngle); // keep text upright
      ctx.fillText(labels[i / 6], 0, 0);
      ctx.restore();
    }
  }
  ctx.restore();

  // North arrow (fixed, always points up = celestial north)
  const northVisible = view.lat >= 0;
  ctx.fillStyle = northVisible ? 'rgba(100, 200, 255, 0.85)' : 'rgba(255, 110, 110, 0.6)';
  ctx.beginPath();
  ctx.moveTo(0, -radius + 1);
  ctx.lineTo(-4, -radius + 10);
  ctx.lineTo(4, -radius + 10);
  ctx.closePath();
  ctx.fill();

  // "N" label
  ctx.fillStyle = northVisible ? 'rgba(200, 230, 255, 0.9)' : 'rgba(255, 130, 130, 0.6)';
  ctx.font = 'bold 9px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', 0, -radius + 16);

  // Center: Dec readout
  const decStr = `${dec >= 0 ? '+' : ''}${dec.toFixed(0)}°`;
  ctx.fillStyle = 'rgba(180, 200, 230, 0.7)';
  ctx.font = '10px system-ui, sans-serif';
  ctx.fillText(decStr, 0, 2);

  ctx.restore();
}

// ---- Cardinal direction labels on the horizon ----
function drawCardinalDirections(baseScale) {
  // Compute the 4 cardinal direction points on the celestial sphere
  // N/S/E/W on the horizon correspond to specific RA/Dec based on observer location and LST
  const lst = computeLST(); // degrees
  const lstRad = lst * Math.PI / 180;
  const latRad = observer.lat * Math.PI / 180;

  // Cardinal azimuth directions → RA/Dec on celestial sphere
  // Az=0 North, Az=90 East, Az=180 South, Az=270 West
  const cardinals = [
    { label: 'N', az: 0 },
    { label: 'E', az: 90 },
    { label: 'S', az: 180 },
    { label: 'W', az: 270 }
  ];

  ctx.font = `bold ${Math.max(12, 14 * baseScale * 0.3)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  cardinals.forEach(({ label, az }) => {
    const azRad = az * Math.PI / 180;
    // Convert horizon point (alt=0, az) to RA/Dec
    // Dec = asin(cos(az) * cos(lat))  [at alt=0]
    // HA = atan2(-sin(az), -cos(az)*sin(lat))
    const dec = Math.asin(Math.cos(azRad) * Math.cos(latRad));
    const ha = Math.atan2(-Math.sin(azRad), -Math.cos(azRad) * Math.sin(latRad));
    const ra = lstRad - ha;

    // Convert to 3D sphere
    const [x, y, z] = raDecToSphere(ra * 24 / (2 * Math.PI), dec * 180 / Math.PI);
    const proj = sphereToScreen(x, y, z);
    if (!proj) return;
    const [px, py] = proj;
    // Skip if off screen
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (px < 10 || px > w - 10 || py < 10 || py > h - 10) return;

    // Background pill
    const textW = ctx.measureText(label).width + 10;
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = 'rgba(10, 14, 30, 0.7)';
    ctx.beginPath();
    ctx.arc(px - textW / 2 + textW / 2, py, 12, 0, Math.PI * 2);
    ctx.fill();

    // Label
    ctx.globalAlpha = label === 'N' ? 0.9 : 0.6;
    ctx.fillStyle = label === 'N' ? '#80c8ff' : '#8898b8';
    ctx.fillText(label, px, py);
    ctx.globalAlpha = 1;
  });
}

// ---- Sky dome mini-map (bottom-left) ----
function viewToAltAz() {
  const lstDeg = computeLST();
  const raDeg = view.lon * 180 / Math.PI;
  const ha = (lstDeg - raDeg) * Math.PI / 180;
  const latRad = observer.lat * Math.PI / 180;
  const decRad = view.lat; // already radians

  const sinAlt = Math.sin(latRad) * Math.sin(decRad) + Math.cos(latRad) * Math.cos(decRad) * Math.cos(ha);
  const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));

  const cosLat = Math.cos(latRad);
  const cosAlt = Math.cos(alt);
  let az = 0;
  if (cosAlt * cosLat > 0.0001) {
    const cosAz = (Math.sin(decRad) - sinAlt * Math.sin(latRad)) / (cosAlt * cosLat);
    az = Math.acos(Math.max(-1, Math.min(1, cosAz)));
    if (Math.sin(ha) > 0) az = 2 * Math.PI - az;
  }

  return { alt: alt * 180 / Math.PI, az: az * 180 / Math.PI };
}

function altAzToDome(alt, az, cx, cy, radius) {
  const r = (1 - Math.max(0, alt) / 90) * radius;
  const angle = (az - 90) * Math.PI / 180; // N=up
  return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) };
}

function drawSkyDome(w, h) {
  const cx = 60, cy = h - 60, radius = 42;

  ctx.save();

  // Background
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = '#0a0e28';
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Horizon ring
  ctx.strokeStyle = 'rgba(80, 60, 40, 0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();

  // Inner rings (30° and 60° altitude)
  ctx.strokeStyle = 'rgba(60, 80, 120, 0.15)';
  ctx.lineWidth = 0.5;
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  ctx.arc(cx, cy, radius * (1 - 30 / 90), 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, radius * (1 - 60 / 90), 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Zenith dot
  ctx.fillStyle = 'rgba(100, 140, 220, 0.3)';
  ctx.beginPath();
  ctx.arc(cx, cy, 2, 0, Math.PI * 2);
  ctx.fill();

  // Cardinal labels
  ctx.font = 'bold 8px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const dirs = [
    { label: 'N', angle: -90 },
    { label: 'E', angle: 0 },
    { label: 'S', angle: 90 },
    { label: 'W', angle: 180 }
  ];
  dirs.forEach(({ label, angle }) => {
    const a = angle * Math.PI / 180;
    const lx = cx + (radius + 10) * Math.cos(a);
    const ly = cy + (radius + 10) * Math.sin(a);
    ctx.fillStyle = label === 'N' ? 'rgba(100, 200, 255, 0.7)' : 'rgba(140, 160, 200, 0.45)';
    ctx.fillText(label, lx, ly);
  });

  // Sun position
  if (typeof getSunPosition === 'function') {
    const sunSphere = getSunPosition();
    const sunRA = Math.atan2(sunSphere[2], sunSphere[0]) * 24 / (2 * Math.PI);
    const sunDec = Math.asin(sunSphere[1]) * 180 / Math.PI;
    const sunAlt = starAltitude(sunRA, sunDec) * 180 / Math.PI;
    if (sunAlt > -10) { // show if near or above horizon
      const lstDeg = computeLST();
      const sunHA = (lstDeg - sunRA * 15) * Math.PI / 180;
      const latRad = observer.lat * Math.PI / 180;
      const decRad = sunDec * Math.PI / 180;
      const sinAlt = Math.sin(latRad) * Math.sin(decRad) + Math.cos(latRad) * Math.cos(decRad) * Math.cos(sunHA);
      const alt = Math.asin(Math.max(-1, Math.min(1, sinAlt)));
      const cosAlt = Math.cos(alt);
      let az = 0;
      if (cosAlt * Math.cos(latRad) > 0.0001) {
        const cosAz = (Math.sin(decRad) - sinAlt * Math.sin(latRad)) / (cosAlt * Math.cos(latRad));
        az = Math.acos(Math.max(-1, Math.min(1, cosAz)));
        if (Math.sin(sunHA) > 0) az = 2 * Math.PI - az;
      }
      const sunAltDeg = alt * 180 / Math.PI;
      const sunAzDeg = az * 180 / Math.PI;
      const sp = altAzToDome(sunAltDeg, sunAzDeg, cx, cy, radius);
      ctx.globalAlpha = sunAltDeg < 0 ? 0.3 : 0.8;
      ctx.fillStyle = '#ffdd44';
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // FOV indicator — current view direction
  const { alt, az } = viewToAltAz();
  const vp = altAzToDome(alt, az, cx, cy, radius);

  // FOV circle size
  const fovFraction = view.fov / 180;
  const fovR = Math.max(4, fovFraction * radius);

  // FOV area
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = '#4080ff';
  ctx.beginPath();
  ctx.arc(vp.x, vp.y, fovR, 0, Math.PI * 2);
  ctx.fill();

  // FOV border
  ctx.globalAlpha = 0.7;
  ctx.strokeStyle = '#60a0ff';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(vp.x, vp.y, fovR, 0, Math.PI * 2);
  ctx.stroke();

  // Center dot
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = '#80c0ff';
  ctx.beginPath();
  ctx.arc(vp.x, vp.y, 2, 0, Math.PI * 2);
  ctx.fill();

  // Alt label
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = '#a0b8d8';
  ctx.font = '9px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`${alt.toFixed(0)}°`, cx, cy + radius + 20);

  ctx.globalAlpha = 1;
  ctx.restore();
}
