// ============================================================
// Star Map — settings.js — Settings panel UI
// ============================================================
// Depends on globals (defined in app.js):
//   observer, overlays, setViewToLocalSky

function initSettings() {
  const btn = document.getElementById('settingsBtn');
  const panel = document.getElementById('settingsPanel');
  const closeBtn = document.getElementById('settingsClose');
  const locationSelect = document.getElementById('locationPreset');
  const customDiv = document.getElementById('customLatLon');
  const inputLat = document.getElementById('inputLat');
  const inputLon = document.getElementById('inputLon');
  const applyBtn = document.getElementById('applyLocation');
  const togHorizon = document.getElementById('togHorizon');
  const togEcliptic = document.getElementById('togEcliptic');
  const togMilkyway = document.getElementById('togMilkyway');

  btn.addEventListener('click', () => panel.classList.toggle('hidden'));
  closeBtn.addEventListener('click', () => panel.classList.add('hidden'));

  // Location preset
  locationSelect.addEventListener('change', () => {
    if (locationSelect.value === 'custom') {
      customDiv.classList.remove('hidden');
      inputLat.value = observer.lat.toFixed(1);
      inputLon.value = observer.lon.toFixed(1);
    } else {
      customDiv.classList.add('hidden');
      const [lat, lon] = locationSelect.value.split(',').map(Number);
      applyLocation(lat, lon);
    }
  });

  applyBtn.addEventListener('click', () => {
    const lat = parseFloat(inputLat.value);
    const lon = parseFloat(inputLon.value);
    if (!isNaN(lat) && !isNaN(lon)) applyLocation(lat, lon);
  });

  function applyLocation(lat, lon) {
    observer.lat = Math.max(-90, Math.min(90, lat));
    observer.lon = Math.max(-180, Math.min(180, lon));
    setViewToLocalSky();
  }

  // Overlay toggles
  togHorizon.checked = overlays.horizon;
  togEcliptic.checked = overlays.ecliptic;
  togMilkyway.checked = overlays.milkyway;

  togHorizon.addEventListener('change', () => { overlays.horizon = togHorizon.checked; });
  togEcliptic.addEventListener('change', () => { overlays.ecliptic = togEcliptic.checked; });
  togMilkyway.addEventListener('change', () => { overlays.milkyway = togMilkyway.checked; });

  // Sync UI when overlays change via MUP function calls
  window._syncSettingsUI = () => {
    togHorizon.checked = overlays.horizon;
    togEcliptic.checked = overlays.ecliptic;
    togMilkyway.checked = overlays.milkyway;
  };
}
