// ============================================================
// Star Map — projection.js — Spherical projection math
// ============================================================
// Depends on globals (defined in app.js, loaded after this file):
//   view, canvas
// These are function declarations, so they capture globals lazily
// at call-time, not at parse-time.

// ---- RA/Dec → unit sphere ----
function raDecToSphere(ra_h, dec_deg) {
  const ra = ra_h * (2 * Math.PI / 24);
  const dec = dec_deg * (Math.PI / 180);
  return [Math.cos(dec) * Math.cos(ra), Math.sin(dec), Math.cos(dec) * Math.sin(ra)];
}

// ---- Projection scale from FOV ----
function getProjectionScale() {
  const fovRad = view.fov * Math.PI / 180;
  return Math.min(canvas.clientWidth, canvas.clientHeight) / (2 * Math.tan(fovRad / 2));
}

// ---- Sphere coordinates → screen pixel coordinates ----
function sphereToScreen(px, py, pz) {
  const cosLon = Math.cos(view.lon), sinLon = Math.sin(view.lon);
  const cosLat = Math.cos(view.lat), sinLat = Math.sin(view.lat);
  // Look-at rotation matrix: maps view direction (lon,lat) → +Z
  const x2 = -sinLon * px + cosLon * pz;
  const y2 = -sinLat * cosLon * px + cosLat * py - sinLat * sinLon * pz;
  const z2 =  cosLat * cosLon * px + sinLat * py + cosLat * sinLon * pz;
  if (z2 <= 0.01) return null; // behind camera
  const scale = getProjectionScale();
  return [
    (x2 / (1 + z2)) * scale + canvas.clientWidth / 2,
    (-y2 / (1 + z2)) * scale + canvas.clientHeight / 2,
    z2
  ];
}

// ---- Sphere coordinates → longitude/latitude ----
function sphereToLonLat(sx, sy, sz) {
  return {
    lon: Math.atan2(sz, sx),
    lat: Math.atan2(sy, Math.sqrt(sx * sx + sz * sz))
  };
}
