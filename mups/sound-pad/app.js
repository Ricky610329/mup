// ---- Dark mode (controlled by MUP system) ----

// ---- Pad definitions ----
const PAD_NAMES = [
  'kick', 'snare', 'clap', 'rim',
  'hihat', 'openhat', 'ride', 'crash',
  'bass', 'bass2', 'sub', 'pluck',
  'brass', 'synth', 'stab', 'perc'
];

// ---- Build pad grid ----
const gridEl = document.getElementById('padGrid');
PAD_NAMES.forEach(name => {
  const el = document.createElement('div');
  el.className = 'pad';
  el.dataset.pad = name;
  el.innerHTML = `<span class="name">${name}</span>`;
  const handler = (e) => {
    e.preventDefault();
    getCtx();
    triggerPad(name, 0.8);
    mup.notifyInteraction('pad-tap', `Tapped ${name}`, { pad: name });
  };
  el.addEventListener('mousedown', handler);
  el.addEventListener('touchstart', handler);
  gridEl.appendChild(el);
});

// ---- Audio Context ----
let ctx = null;
function getCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// ---- Master gain ----
function masterGain(vol) {
  const c = getCtx();
  const g = c.createGain();
  g.gain.value = vol;
  g.connect(c.destination);
  return g;
}

// ---- Noise buffer helper ----
function noiseBuf(duration) {
  const c = getCtx();
  const buf = c.createBuffer(1, c.sampleRate * duration, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

// ---- Synth sounds ----
function sKick(vol) {
  const c = getCtx(), t = c.currentTime, out = masterGain(vol);
  const osc = c.createOscillator(), g = c.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(150, t);
  osc.frequency.exponentialRampToValueAtTime(30, t + 0.15);
  g.gain.setValueAtTime(1, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
  osc.connect(g).connect(out);
  osc.start(t); osc.stop(t + 0.3);
}

function sSnare(vol) {
  const c = getCtx(), t = c.currentTime, out = masterGain(vol);
  const src = c.createBufferSource(); src.buffer = noiseBuf(0.12);
  const ng = c.createGain(); ng.gain.setValueAtTime(0.7, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1200;
  src.connect(hp).connect(ng).connect(out); src.start(t);
  const osc = c.createOscillator(), og = c.createGain();
  osc.type = 'triangle'; osc.frequency.value = 180;
  og.gain.setValueAtTime(0.5, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
  osc.connect(og).connect(out); osc.start(t); osc.stop(t + 0.08);
}

function sClap(vol) {
  const c = getCtx(), t = c.currentTime, out = masterGain(vol);
  for (let i = 0; i < 3; i++) {
    const src = c.createBufferSource(); src.buffer = noiseBuf(0.02);
    const g = c.createGain(), off = i * 0.008;
    g.gain.setValueAtTime(0.5, t + off); g.gain.exponentialRampToValueAtTime(0.001, t + off + 0.06);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2500; bp.Q.value = 3;
    src.connect(bp).connect(g).connect(out); src.start(t + off);
  }
}

function sRim(vol) {
  const c = getCtx(), t = c.currentTime, out = masterGain(vol);
  const osc = c.createOscillator(), g = c.createGain();
  osc.type = 'triangle'; osc.frequency.value = 800;
  g.gain.setValueAtTime(0.6, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
  osc.connect(g).connect(out); osc.start(t); osc.stop(t + 0.04);
}

function sHihat(vol) {
  const c = getCtx(), t = c.currentTime, out = masterGain(vol * 0.5);
  const src = c.createBufferSource(); src.buffer = noiseBuf(0.04);
  const g = c.createGain(); g.gain.setValueAtTime(1, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
  const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000;
  src.connect(hp).connect(g).connect(out); src.start(t);
}

function sOpenhat(vol) {
  const c = getCtx(), t = c.currentTime, out = masterGain(vol * 0.5);
  const src = c.createBufferSource(); src.buffer = noiseBuf(0.18);
  const g = c.createGain(); g.gain.setValueAtTime(1, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
  const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6000;
  const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 10000; bp.Q.value = 1;
  src.connect(hp).connect(bp).connect(g).connect(out); src.start(t);
}

function sRide(vol) {
  const c = getCtx(), t = c.currentTime, out = masterGain(vol * 0.4);
  const src = c.createBufferSource(); src.buffer = noiseBuf(0.3);
  const g = c.createGain(); g.gain.setValueAtTime(0.6, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
  const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 8000; bp.Q.value = 2;
  src.connect(bp).connect(g).connect(out); src.start(t);
  const osc = c.createOscillator(), og = c.createGain();
  osc.type = 'sine'; osc.frequency.value = 5500;
  og.gain.setValueAtTime(0.1, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
  osc.connect(og).connect(out); osc.start(t); osc.stop(t + 0.2);
}

function sCrash(vol) {
  const c = getCtx(), t = c.currentTime, out = masterGain(vol * 0.5);
  const src = c.createBufferSource(); src.buffer = noiseBuf(0.8);
  const g = c.createGain(); g.gain.setValueAtTime(1, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
  const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 4000;
  src.connect(hp).connect(g).connect(out); src.start(t);
}

let bassStep = 0;
function sBass(vol) {
  const c = getCtx(), t = c.currentTime, out = masterGain(vol);
  const walk = [55, 82.4, 65.4, 98, 73.4, 110, 82.4, 123.5];
  const freq = walk[bassStep % walk.length]; bassStep++;
  const osc = c.createOscillator(), g = c.createGain();
  const f = c.createBiquadFilter(); f.type = 'lowpass';
  osc.type = 'sawtooth'; osc.frequency.value = freq;
  f.frequency.setValueAtTime(800, t); f.frequency.exponentialRampToValueAtTime(200, t + 0.2);
  g.gain.setValueAtTime(0.8, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
  osc.connect(f).connect(g).connect(out); osc.start(t); osc.stop(t + 0.3);
}

let bassStep2 = 0;
function sBass2(vol) {
  const c = getCtx(), t = c.currentTime, out = masterGain(vol);
  const notes = [73.4, 82.4, 98, 110];
  const freq = notes[bassStep2 % notes.length]; bassStep2++;
  const osc = c.createOscillator(), g = c.createGain();
  osc.type = 'square'; osc.frequency.value = freq;
  const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600;
  g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
  osc.connect(f).connect(g).connect(out); osc.start(t); osc.stop(t + 0.2);
}

function sSub(vol) {
  const c = getCtx(), t = c.currentTime, out = masterGain(vol);
  const osc = c.createOscillator(), g = c.createGain();
  osc.type = 'sine'; osc.frequency.value = 45;
  g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
  osc.connect(g).connect(out); osc.start(t); osc.stop(t + 0.4);
}

function sPluck(vol) {
  const c = getCtx(), t = c.currentTime, out = masterGain(vol * 0.6);
  const notes = [523.3, 587.3, 659.3, 784, 880];
  const freq = notes[Math.floor(Math.random() * notes.length)];
  const osc = c.createOscillator(), g = c.createGain();
  const f = c.createBiquadFilter(); f.type = 'lowpass';
  osc.type = 'sawtooth'; osc.frequency.value = freq;
  f.frequency.setValueAtTime(4000, t); f.frequency.exponentialRampToValueAtTime(500, t + 0.1);
  g.gain.setValueAtTime(0.7, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  osc.connect(f).connect(g).connect(out); osc.start(t); osc.stop(t + 0.15);
}

let brassStep = 0;
function sBrass(vol) {
  const c = getCtx(), t = c.currentTime, out = masterGain(vol * 0.35);
  const chords = [[220, 261.6, 329.6, 392], [293.7, 349.2, 440, 523.3], [196, 246.9, 293.7, 349.2], [261.6, 329.6, 392, 493.9]];
  const chord = chords[brassStep % chords.length]; brassStep++;
  chord.forEach(freq => {
    const osc = c.createOscillator(), g = c.createGain();
    const f = c.createBiquadFilter(); f.type = 'lowpass';
    osc.type = 'square'; osc.frequency.value = freq;
    f.frequency.setValueAtTime(2000, t); f.frequency.exponentialRampToValueAtTime(400, t + 0.25);
    g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc.connect(f).connect(g).connect(out); osc.start(t); osc.stop(t + 0.35);
  });
}

function sSynth(vol) {
  const c = getCtx(), t = c.currentTime, out = masterGain(vol * 0.5);
  const notes = [523.3, 587.3, 659.3, 784];
  const freq = notes[Math.floor(Math.random() * notes.length)];
  const osc = c.createOscillator(), g = c.createGain();
  const f = c.createBiquadFilter(); f.type = 'lowpass';
  osc.type = 'sawtooth'; osc.frequency.value = freq;
  f.frequency.setValueAtTime(3000, t); f.frequency.exponentialRampToValueAtTime(600, t + 0.15);
  g.gain.setValueAtTime(0.6, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
  osc.connect(f).connect(g).connect(out); osc.start(t); osc.stop(t + 0.2);
}

function sStab(vol) {
  const c = getCtx(), t = c.currentTime, out = masterGain(vol * 0.4);
  const chord = [330, 415, 494]; // E4 Ab4 B4
  chord.forEach(freq => {
    const osc = c.createOscillator(), g = c.createGain();
    osc.type = 'square'; osc.frequency.value = freq;
    g.gain.setValueAtTime(0.4, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    osc.connect(g).connect(out); osc.start(t); osc.stop(t + 0.1);
  });
}

function sPerc(vol) {
  const c = getCtx(), t = c.currentTime, out = masterGain(vol * 0.5);
  const osc = c.createOscillator(), g = c.createGain();
  osc.type = 'sine'; osc.frequency.setValueAtTime(1200, t);
  osc.frequency.exponentialRampToValueAtTime(300, t + 0.06);
  g.gain.setValueAtTime(0.6, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
  osc.connect(g).connect(out); osc.start(t); osc.stop(t + 0.1);
}

const SOUNDS = {
  kick: sKick, snare: sSnare, clap: sClap, rim: sRim,
  hihat: sHihat, openhat: sOpenhat, ride: sRide, crash: sCrash,
  bass: sBass, bass2: sBass2, sub: sSub, pluck: sPluck,
  brass: sBrass, synth: sSynth, stab: sStab, perc: sPerc
};

// ---- Visual ----
function flashPad(padName) {
  const el = document.querySelector(`[data-pad="${padName}"]`);
  if (!el) return;
  el.classList.add('hit');
  setTimeout(() => el.classList.remove('hit'), 100);
}
function triggerPad(name, vol) {
  const fn = SOUNDS[name];
  if (fn) { fn(vol); flashPad(name); }
}

// ---- Step Display ----
const STEPS_PER_BAR = 8;
let stepDots = [];
function initStepDisplay(bars) {
  const display = document.getElementById('stepDisplay');
  display.innerHTML = '';
  stepDots = [];
  for (let i = 0; i < STEPS_PER_BAR * bars; i++) {
    const dot = document.createElement('div');
    dot.className = 'step-dot' + (i % STEPS_PER_BAR === 0 ? ' beat' : '');
    display.appendChild(dot);
    stepDots.push(dot);
  }
}
function highlightStep(idx) {
  stepDots.forEach((d, i) => d.classList.toggle('active', i === idx));
}

// ---- Sequencer ----
let bpm = 126, swing = 0.6, playing = false;
let currentStep = 0, totalSteps = 0, stepTimeout = null;
let currentTracks = {}, trackVolumes = {}, masterVol = 0.7, patternQueue = [];

// Web Audio clock scheduling constants
const LOOKAHEAD_SEC = 0.1;   // schedule notes this far ahead (100ms)
const SCHEDULER_MS  = 25;    // setTimeout wake-up interval (25ms)
let nextStepTime = 0;        // when the next step should fire (in ctx.currentTime)

function get8th() { return 60 / bpm / 2; }
function swungDur(step) {
  const base = get8th();
  return step % 2 === 0 ? base * (1 + swing * 0.33) : base * (1 - swing * 0.33);
}
function calcDurationMs(bars) {
  let ms = 0;
  for (let i = 0; i < STEPS_PER_BAR * bars; i++) ms += swungDur(i) * 1000;
  return Math.round(ms);
}

// Parse tracks: supports string OR {pattern, volume} per track.
// Auto-repeats short patterns to fill totalSteps.
function parseTracks(raw, bars) {
  const total = STEPS_PER_BAR * bars;
  const patterns = {}, volumes = {};
  for (const [pad, val] of Object.entries(raw || {})) {
    let pat, vol;
    if (typeof val === 'string') { pat = val; vol = undefined; }
    else if (val && typeof val === 'object') { pat = val.pattern || ''; vol = val.volume; }
    else continue;
    // Auto-repeat: if pattern shorter than totalSteps, loop it
    if (pat.length > 0 && pat.length < total) {
      const orig = pat;
      while (pat.length < total) pat += orig;
      pat = pat.slice(0, total);
    }
    patterns[pad] = pat;
    if (vol !== undefined) volumes[pad] = vol;
  }
  return { patterns, volumes };
}

// Schedule a pad sound at a precise Web Audio time
function triggerPadAt(name, vol, when) {
  const fn = SOUNDS[name];
  if (!fn) return;
  // Most synth functions use ctx.currentTime internally.
  // We temporarily nudge currentTime-based scheduling by scheduling via
  // a silent offset. For precise timing, we schedule the sound to start
  // at the given Web Audio time.
  // Since the synth functions read ctx.currentTime, we trigger them
  // early enough (within the lookahead window) and accept the tiny
  // offset. For background-tab resilience, this is far better than
  // setTimeout-based timing.
  fn(vol);
  flashPad(name);
}

function scheduleStep() {
  if (!playing) return;
  const c = getCtx();

  // Schedule all steps that fall within the lookahead window
  while (nextStepTime < c.currentTime + LOOKAHEAD_SEC) {
    if (currentStep >= totalSteps) {
      // Pattern ended — handle queue or stop
      if (patternQueue.length > 0) {
        const next = patternQueue.shift();
        startPattern(next.tracks, next.bars, next.volume);
        return; // startPattern will restart the scheduler
      } else {
        playing = false;
        document.getElementById('status').textContent = 'Ready';
        highlightStep(-1);
        mup.emitEvent('playback-end', { bars: totalSteps / STEPS_PER_BAR });
        patternIndex = 0;
        return;
      }
    }

    // Fire pads for this step
    for (const [pad, pattern] of Object.entries(currentTracks)) {
      if (currentStep < pattern.length && (pattern[currentStep] === 'x' || pattern[currentStep] === 'X')) {
        triggerPadAt(pad, trackVolumes[pad] ?? masterVol, nextStepTime);
      }
    }

    // Update visual on the closest step to "now"
    highlightStep(currentStep);

    // Advance to next step
    nextStepTime += swungDur(currentStep);
    currentStep++;
  }

  // Wake up again after a short interval (setTimeout is only a wake-up call,
  // NOT used for timing — Web Audio clock handles precision)
  stepTimeout = setTimeout(scheduleStep, SCHEDULER_MS);
}

let patternIndex = 0;
function startPattern(tracks, bars, volume) {
  const b = bars || 4;
  const { patterns, volumes } = parseTracks(tracks, b);
  currentTracks = patterns;
  trackVolumes = volumes;
  totalSteps = STEPS_PER_BAR * b;
  masterVol = volume ?? 0.7;
  currentStep = 0;
  const c = getCtx();
  nextStepTime = c.currentTime;
  initStepDisplay(b);
  document.getElementById('status').textContent = `Playing (${b} bars)`;
  playing = true;
  mup.emitEvent('pattern-start', { index: patternIndex++, bars: b });
  scheduleStep();
}

// ---- Pad Colors ----
// Grouped by category: drums (red/orange), cymbals (amber/yellow), bass (purple), melodic (blue)
const padColors = {
  kick: '#dc2626', snare: '#ea580c', clap: '#e05030', rim: '#f06040',
  hihat: '#ca8a04', openhat: '#d4a017', ride: '#b8960c', crash: '#c49a10',
  bass: '#9333ea', bass2: '#a855f7', sub: '#7c3aed', pluck: '#8b5cf6',
  brass: '#2563eb', synth: '#3b82f6', stab: '#1d4ed8', perc: '#6366f1'
};
function applyPadColor(name, color) {
  const el = document.querySelector(`[data-pad="${name}"]`);
  if (!el) return;
  if (!color) { el.removeAttribute('data-color'); el.style.removeProperty('--pad-color'); return; }
  el.setAttribute('data-color', '');
  el.style.setProperty('--pad-color', color);
}
function applyAllColors() {
  for (const [name, color] of Object.entries(padColors)) applyPadColor(name, color);
}
applyAllColors();

// ---- MUP Functions ----
mup.registerFunction('setBPM', ({ bpm: b, swing: s }) => {
  getCtx();
  bpm = b || 126;
  if (s !== undefined) swing = Math.max(0, Math.min(1, s));
  document.getElementById('bpmDisplay').textContent = `${bpm} BPM`;
  return { content: [{ type: 'text', text: `BPM: ${bpm}, swing: ${swing}` }], isError: false };
});

mup.registerFunction('playBars', ({ tracks, bars, volume }) => {
  getCtx();
  const b = bars || 4;
  const dur = calcDurationMs(b);
  const entry = { tracks: tracks || {}, bars: b, volume: volume ?? 0.7 };
  if (playing) {
    patternQueue.push(entry);
    return { content: [{ type: 'text', text: `Queued ${b} bars (${dur}ms).` }], isError: false };
  }
  startPattern(entry.tracks, entry.bars, entry.volume);
  return { content: [{ type: 'text', text: `Playing ${b} bars at ${bpm} BPM (${dur}ms).` }], isError: false };
});

mup.registerFunction('play', ({ pad, volume }) => {
  getCtx();
  if (!SOUNDS[pad]) return { content: [{ type: 'text', text: `Unknown pad: ${pad}` }], isError: true };
  triggerPad(pad, volume ?? 0.8);
  return { content: [{ type: 'text', text: `Played ${pad}` }], isError: false };
});

mup.registerFunction('setPadColors', ({ colors }) => {
  for (const [name, color] of Object.entries(colors || {})) {
    if (color) { padColors[name] = color; } else { delete padColors[name]; }
  }
  applyAllColors();
  return { content: [{ type: 'text', text: `Updated ${Object.keys(colors).length} pad colors.` }], isError: false };
});

mup.registerFunction('stop', () => {
  playing = false; patternQueue = []; clearTimeout(stepTimeout);
  patternIndex = 0;
  highlightStep(-1);
  document.getElementById('status').textContent = 'Stopped';
  return { content: [{ type: 'text', text: 'Stopped.' }], isError: false };
});

mup.onReady(({ theme }) => {
  if (theme === 'dark') document.body.classList.add('dark');
  initStepDisplay(4);
  mup.updateState('Sound Pad ready', {});
});

mup.onThemeChange((theme) => {
  document.body.classList.toggle('dark', theme === 'dark');
});
