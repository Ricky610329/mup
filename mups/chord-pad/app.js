// ---- Audio Context ----
let ctx = null;
let reverbNode = null;
let reverbDry = null;
let reverbWet = null;
let analyser = null;

function getCtx() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    setupReverb(0.3);
    setupAnalyser();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// ---- Reverb (convolver with procedural impulse response) ----
function createImpulseResponse(duration, decay) {
  const c = getCtx();
  const len = c.sampleRate * duration;
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

let masterNode = null;
let masterVolume = 1.0;
function getMasterNode() {
  const c = getCtx();
  if (!masterNode) {
    masterNode = c.createGain();
    masterNode.connect(c.destination);
  }
  masterNode.gain.value = masterVolume;
  return masterNode;
}

function setupReverb(amount) {
  const c = getCtx();
  if (reverbNode) { reverbNode.disconnect(); reverbDry.disconnect(); reverbWet.disconnect(); }
  reverbNode = c.createConvolver();
  reverbNode.buffer = createImpulseResponse(2, 3);
  reverbDry = c.createGain();
  reverbWet = c.createGain();
  reverbDry.gain.value = 1;
  reverbWet.gain.value = amount;
  const master = getMasterNode();
  reverbDry.connect(master);
  reverbWet.connect(reverbNode).connect(master);
}

function getOutput() {
  const c = getCtx();
  const g = c.createGain();
  g.gain.value = 1;
  g.connect(reverbDry);
  g.connect(reverbWet);
  if (analyser) g.connect(analyser);
  return g;
}

// ---- Analyser for waveform ----
function setupAnalyser() {
  const c = getCtx();
  analyser = c.createAnalyser();
  analyser.fftSize = 256;
}

// ---- Voice settings ----
let currentVoice = 'piano';
let voiceAttack = 0.01;
let voiceRelease = 0.3;

// ---- Central BPM / swing ----
let centralBpm = 120;
let swing = 0;

// ---- Step display ----
const STEPS_PER_BAR = 8;
let stepDots = [];
let stepInterval = null;

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

function clearStepInterval() {
  if (stepInterval) { clearInterval(stepInterval); stepInterval = null; }
}

function startStepTimer(bpm, totalSteps) {
  clearStepInterval();
  const stepDuration = 60 / bpm / 2 * 1000; // each step = 1/8 note
  let step = 0;
  highlightStep(0);
  stepInterval = setInterval(() => {
    step++;
    if (step >= totalSteps) { clearStepInterval(); highlightStep(-1); return; }
    highlightStep(step);
  }, stepDuration);
}

// ---- Note / Chord mapping ----
const NOTE_NAMES = { 'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11 };

const CHORD_TYPES = {
  'maj7': [0, 4, 7, 11],
  'min7': [0, 3, 7, 10],
  'm7': [0, 3, 7, 10],
  'add9': [0, 4, 7, 14],
  'sus2': [0, 2, 7],
  'sus4': [0, 5, 7],
  'dim': [0, 3, 6],
  'aug': [0, 4, 8],
  '9': [0, 4, 7, 10, 14],
  '7': [0, 4, 7, 10],
  'm': [0, 3, 7],
  '': [0, 4, 7]  // major
};

// Pre-sorted by key length descending so longest match wins
const CHORD_TYPE_KEYS = Object.keys(CHORD_TYPES).sort((a, b) => b.length - a.length);

const ROOT_COLORS = {
  'C': '#e53e3e', 'D': '#dd6b20', 'E': '#d69e2e',
  'F': '#38a169', 'G': '#3182ce', 'A': '#5a67d8', 'B': '#805ad5'
};

function noteNameToMidi(name, defaultOctave) {
  const match = name.match(/^([A-Ga-g])(#|b)?(\d)?$/);
  if (!match) return null;
  const letter = match[1].toUpperCase();
  const accidental = match[2] || '';
  const octave = match[3] !== undefined ? parseInt(match[3]) : defaultOctave;
  let semitone = NOTE_NAMES[letter];
  if (semitone === undefined) return null;
  if (accidental === '#') semitone++;
  if (accidental === 'b') semitone--;
  return (octave + 1) * 12 + semitone;
}

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function parseChord(chordStr, octave) {
  const match = chordStr.match(/^([A-Ga-g])(#|b)?(.*)$/);
  if (!match) return null;
  const rootLetter = match[1].toUpperCase();
  const accidental = match[2] || '';
  const quality = match[3] || '';

  let rootSemitone = NOTE_NAMES[rootLetter];
  if (rootSemitone === undefined) return null;
  if (accidental === '#') rootSemitone++;
  if (accidental === 'b') rootSemitone--;

  let intervals = null;
  for (const type of CHORD_TYPE_KEYS) {
    if (quality === type) { intervals = CHORD_TYPES[type]; break; }
  }
  if (!intervals) intervals = CHORD_TYPES[''];

  const baseMidi = (octave + 1) * 12 + rootSemitone;
  const midiNotes = intervals.map(i => baseMidi + i);

  return { root: rootLetter, rootSemitone, intervals, midiNotes, name: chordStr };
}

// ---- Synth Voices ----

function playNoteWithVoice(freq, when, duration, velocity, output) {
  const c = getCtx();
  const atk = voiceAttack;
  const rel = voiceRelease;
  const endTime = when + duration;
  const releaseEnd = endTime + rel;
  const nodes = [];

  switch (currentVoice) {
    case 'piano': {
      // 2 detuned sine oscillators, percussive envelope
      for (const detune of [-3, 3]) {
        const osc = c.createOscillator();
        const g = c.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        osc.detune.value = detune;
        g.gain.setValueAtTime(0, when);
        g.gain.linearRampToValueAtTime(velocity * 0.5, when + Math.min(atk, 0.005));
        g.gain.exponentialRampToValueAtTime(velocity * 0.2, when + 0.08);
        g.gain.setValueAtTime(velocity * 0.2, endTime);
        g.gain.exponentialRampToValueAtTime(0.001, releaseEnd);
        osc.connect(g).connect(output);
        osc.start(when);
        osc.stop(releaseEnd + 0.01);
        nodes.push(osc);
      }
      break;
    }
    case 'epiano': {
      // sine + triangle with slight FM, warm tone
      const mod = c.createOscillator();
      const modGain = c.createGain();
      mod.type = 'sine';
      mod.frequency.value = freq * 2;
      modGain.gain.value = freq * 0.5;
      mod.connect(modGain);

      const osc = c.createOscillator();
      const g = c.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      modGain.connect(osc.frequency);
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(velocity * 0.45, when + atk);
      g.gain.setValueAtTime(velocity * 0.35, endTime);
      g.gain.exponentialRampToValueAtTime(0.001, releaseEnd);
      osc.connect(g).connect(output);
      osc.start(when); osc.stop(releaseEnd + 0.01);
      mod.start(when); mod.stop(releaseEnd + 0.01);
      nodes.push(osc, mod);

      const osc2 = c.createOscillator();
      const g2 = c.createGain();
      osc2.type = 'triangle';
      osc2.frequency.value = freq;
      g2.gain.setValueAtTime(0, when);
      g2.gain.linearRampToValueAtTime(velocity * 0.2, when + atk);
      g2.gain.setValueAtTime(velocity * 0.15, endTime);
      g2.gain.exponentialRampToValueAtTime(0.001, releaseEnd);
      osc2.connect(g2).connect(output);
      osc2.start(when); osc2.stop(releaseEnd + 0.01);
      nodes.push(osc2);
      break;
    }
    case 'pad': {
      // 3 detuned sawtooth through lowpass, slow attack, long release
      const padRel = Math.max(rel, 1.0);
      const padAtk = Math.max(atk, 0.3);
      const padEnd = endTime + padRel;
      const filter = c.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1200;
      filter.Q.value = 1;
      filter.connect(output);
      for (const detune of [-7, 0, 7]) {
        const osc = c.createOscillator();
        const g = c.createGain();
        osc.type = 'sawtooth';
        osc.frequency.value = freq;
        osc.detune.value = detune;
        g.gain.setValueAtTime(0, when);
        g.gain.linearRampToValueAtTime(velocity * 0.25, when + padAtk);
        g.gain.setValueAtTime(velocity * 0.25, endTime);
        g.gain.exponentialRampToValueAtTime(0.001, padEnd);
        osc.connect(g).connect(filter);
        osc.start(when); osc.stop(padEnd + 0.01);
        nodes.push(osc);
      }
      break;
    }
    case 'organ': {
      // multiple harmonics (1x, 2x, 3x) with equal gain, no decay
      for (const harmonic of [1, 2, 3]) {
        const osc = c.createOscillator();
        const g = c.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq * harmonic;
        const vol = velocity * 0.3 / harmonic;
        g.gain.setValueAtTime(0, when);
        g.gain.linearRampToValueAtTime(vol, when + atk);
        g.gain.setValueAtTime(vol, endTime);
        g.gain.linearRampToValueAtTime(0, endTime + 0.02);
        osc.connect(g).connect(output);
        osc.start(when); osc.stop(endTime + 0.05);
        nodes.push(osc);
      }
      break;
    }
    case 'strings': {
      // 2 detuned sawtooth through lowpass, slow attack, slow release
      const strAtk = Math.max(atk, 0.15);
      const strRel = Math.max(rel, 0.6);
      const strEnd = endTime + strRel;
      const filter = c.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 2000;
      filter.Q.value = 0.5;
      filter.connect(output);
      for (const detune of [-5, 5]) {
        const osc = c.createOscillator();
        const g = c.createGain();
        osc.type = 'sawtooth';
        osc.frequency.value = freq;
        osc.detune.value = detune;
        g.gain.setValueAtTime(0, when);
        g.gain.linearRampToValueAtTime(velocity * 0.35, when + strAtk);
        g.gain.setValueAtTime(velocity * 0.3, endTime);
        g.gain.exponentialRampToValueAtTime(0.001, strEnd);
        osc.connect(g).connect(filter);
        osc.start(when); osc.stop(strEnd + 0.01);
        nodes.push(osc);
      }
      break;
    }
  }
  return nodes;
}

// ---- Piano Keyboard (C3 to B5 = 3 octaves) ----
const KEYBOARD_START = 48; // C3
const KEYBOARD_END = 83;   // B5
const WHITE_NOTES = [0, 2, 4, 5, 7, 9, 11]; // C D E F G A B semitones in octave
const BLACK_NOTES = [1, 3, 6, 8, 10];        // C# D# F# G# A#

const keyElements = {};

function buildKeyboard() {
  const kb = document.getElementById('keyboard');
  kb.innerHTML = '';

  // Count white keys in range
  let whiteCount = 0;
  for (let midi = KEYBOARD_START; midi <= KEYBOARD_END; midi++) {
    if (WHITE_NOTES.includes(midi % 12)) whiteCount++;
  }

  const whiteWidth = 100 / whiteCount; // percentage
  let whiteIndex = 0;

  // First pass: white keys
  for (let midi = KEYBOARD_START; midi <= KEYBOARD_END; midi++) {
    const noteInOctave = midi % 12;
    if (!WHITE_NOTES.includes(noteInOctave)) continue;

    const key = document.createElement('div');
    key.className = 'key key-white';
    key.dataset.midi = midi;
    key.style.left = (whiteIndex * whiteWidth) + '%';
    key.style.width = whiteWidth + '%';

    // Label on C notes
    if (noteInOctave === 0) {
      const label = document.createElement('span');
      label.className = 'key-label';
      label.textContent = 'C' + (Math.floor(midi / 12) - 1);
      key.appendChild(label);
    }

    kb.appendChild(key);
    keyElements[midi] = key;
    attachKeyListeners(key);
    whiteIndex++;
  }

  // Second pass: black keys
  whiteIndex = 0;
  for (let midi = KEYBOARD_START; midi <= KEYBOARD_END; midi++) {
    const noteInOctave = midi % 12;
    if (WHITE_NOTES.includes(noteInOctave)) {
      whiteIndex++;
      continue;
    }
    if (!BLACK_NOTES.includes(noteInOctave)) continue;

    const key = document.createElement('div');
    key.className = 'key key-black';
    key.dataset.midi = midi;
    // Position black keys between white keys
    const blackWidth = whiteWidth * 0.6;
    key.style.left = ((whiteIndex - 1) * whiteWidth + whiteWidth * 0.7) + '%';
    key.style.width = blackWidth + '%';

    kb.appendChild(key);
    keyElements[midi] = key;
    attachKeyListeners(key);
  }
}

// ---- Single key tap (user interaction) ----
const NOTE_LABELS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function playKeyTap(midi) {
  const c = getCtx();
  const freq = midiToFreq(midi);
  const output = getOutput();
  const duration = 0.3;
  const nodes = playNoteWithVoice(freq, c.currentTime, duration, 0.7, output);
  scheduledNodes.push(...nodes);

  const noteName = NOTE_LABELS[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  const fullName = noteName + octave;
  const color = ROOT_COLORS[noteName.charAt(0)] || 'var(--accent)';

  highlightKey(midi, color, (duration + voiceRelease) * 1000);
  showChord(fullName, noteName.charAt(0));

  mup.notifyInteraction('key-tap', 'Played ' + fullName, { note: fullName, midi: midi });
}

function attachKeyListeners(keyEl) {
  keyEl.addEventListener('mousedown', function (e) {
    playKeyTap(parseInt(this.dataset.midi));
  });
  keyEl.addEventListener('touchstart', function (e) {
    e.preventDefault();
    playKeyTap(parseInt(this.dataset.midi));
  });
}

// ---- Key highlighting ----
const activeKeyTimeouts = {};

function highlightKey(midi, color, durationMs) {
  const el = keyElements[midi];
  if (!el) return;
  el.classList.add('active');
  if (color) el.style.setProperty('--note-glow', color);
  if (activeKeyTimeouts[midi]) clearTimeout(activeKeyTimeouts[midi]);
  activeKeyTimeouts[midi] = setTimeout(() => {
    el.classList.remove('active');
    el.style.removeProperty('--note-glow');
    delete activeKeyTimeouts[midi];
  }, durationMs || 500);
}

function clearAllKeys() {
  for (const midi in activeKeyTimeouts) clearTimeout(activeKeyTimeouts[midi]);
  for (const midi in keyElements) {
    keyElements[midi].classList.remove('active');
    keyElements[midi].style.removeProperty('--note-glow');
  }
}

// ---- Chord Display ----
const chordNameEl = document.getElementById('chordName');
const chordHistoryEl = document.getElementById('chordHistory');
const chordHistory = [];

function showChord(name, rootLetter) {
  const color = ROOT_COLORS[rootLetter] || 'var(--accent)';
  chordNameEl.textContent = name;
  chordNameEl.style.setProperty('--chord-glow', color);
  chordNameEl.classList.add('active');

  chordHistory.push(name);
  if (chordHistory.length > 12) chordHistory.shift();
  renderHistory();
}

function clearChordDisplay() {
  chordNameEl.classList.remove('active');
}

function renderHistory() {
  chordHistoryEl.innerHTML = '';
  chordHistory.forEach(name => {
    const el = document.createElement('span');
    el.className = 'chord-history-item';
    el.textContent = name;
    chordHistoryEl.appendChild(el);
  });
  // Scroll to end
  chordHistoryEl.scrollLeft = chordHistoryEl.scrollWidth;
}

// ---- Waveform Visualizer ----
const waveCanvas = document.getElementById('waveform');
const waveCtx = waveCanvas.getContext('2d');
let animFrameId = null;

let lastCanvasW = 0, lastCanvasH = 0;

function drawWaveform() {
  if (!analyser) { animFrameId = requestAnimationFrame(drawWaveform); return; }

  const dpr = window.devicePixelRatio || 1;
  const cw = waveCanvas.clientWidth * dpr;
  const ch = waveCanvas.clientHeight * dpr;
  if (cw !== lastCanvasW || ch !== lastCanvasH) {
    waveCanvas.width = cw; waveCanvas.height = ch;
    lastCanvasW = cw; lastCanvasH = ch;
  }
  const w = lastCanvasW, h = lastCanvasH;
  const bufLen = analyser.frequencyBinCount;
  const data = new Uint8Array(bufLen);
  analyser.getByteTimeDomainData(data);

  waveCtx.clearRect(0, 0, w, h);
  const isDark = document.body.classList.contains('dark');
  waveCtx.strokeStyle = isDark ? 'rgba(96,165,250,0.5)' : 'rgba(0,102,204,0.4)';
  waveCtx.lineWidth = 1.5 * (window.devicePixelRatio || 1);
  waveCtx.beginPath();

  const sliceWidth = w / bufLen;
  let x = 0;
  for (let i = 0; i < bufLen; i++) {
    const v = data[i] / 128.0;
    const y = v * h / 2;
    if (i === 0) waveCtx.moveTo(x, y);
    else waveCtx.lineTo(x, y);
    x += sliceWidth;
  }
  waveCtx.lineTo(w, h / 2);
  waveCtx.stroke();
  animFrameId = requestAnimationFrame(drawWaveform);
}

// ---- Playback state ----
let isPlaying = false;
let scheduledNodes = [];  // all oscillators we've scheduled
let playbackTimeouts = []; // setTimeout IDs for visual updates

function pruneStoppedNodes() {
  // Remove nodes whose stop time has passed to prevent unbounded growth
  const now = getCtx().currentTime;
  scheduledNodes = scheduledNodes.filter(n => {
    try { return n.context && n.playbackState !== 'finished'; } catch (e) { return false; }
  });
}

function stopAll() {
  isPlaying = false;
  const now = getCtx().currentTime;
  scheduledNodes.forEach(node => {
    try { node.stop(now); } catch (e) { /* already stopped */ }
  });
  scheduledNodes = [];
  playbackTimeouts.forEach(id => clearTimeout(id));
  playbackTimeouts = [];
  clearAllKeys();
  clearChordDisplay();
  clearStepInterval();
  highlightStep(-1);
  document.getElementById('status').textContent = 'Stopped';
}

// ---- Play a chord at a scheduled time ----
function scheduleChord(parsed, when, durationSec, velocity, arpeggiate) {
  const output = getOutput();
  const velGain = getCtx().createGain();
  velGain.gain.value = velocity;
  velGain.connect(output);

  const color = ROOT_COLORS[parsed.root] || 'var(--accent)';
  const notes = parsed.midiNotes;

  if (arpeggiate) {
    const dir = arpeggiate === 'down' ? [...notes].reverse() : [...notes];
    const arpDelay = Math.min(0.08, durationSec / dir.length / 2);
    dir.forEach((midi, i) => {
      const noteWhen = when + i * arpDelay;
      const noteDur = durationSec - i * arpDelay;
      if (noteDur <= 0) return;
      const freq = midiToFreq(midi);
      const nodes = playNoteWithVoice(freq, noteWhen, noteDur, 1, velGain);
      scheduledNodes.push(...nodes);

      const delayMs = Math.max(0, (noteWhen - getCtx().currentTime) * 1000);
      const tid = setTimeout(() => highlightKey(midi, color, noteDur * 1000), delayMs);
      playbackTimeouts.push(tid);
    });
  } else {
    notes.forEach(midi => {
      const freq = midiToFreq(midi);
      const nodes = playNoteWithVoice(freq, when, durationSec, 1, velGain);
      scheduledNodes.push(...nodes);

      const delayMs = Math.max(0, (when - getCtx().currentTime) * 1000);
      const tid = setTimeout(() => highlightKey(midi, color, durationSec * 1000), delayMs);
      playbackTimeouts.push(tid);
    });
  }

  const nameDelay = Math.max(0, (when - getCtx().currentTime) * 1000);
  const tid = setTimeout(() => showChord(parsed.name, parsed.root), nameDelay);
  playbackTimeouts.push(tid);
}

// ---- MUP Functions ----

mup.registerFunction('setVoice', ({ voice, reverb, attack, release }) => {
  getCtx();
  if (voice) currentVoice = voice;
  if (attack !== undefined) voiceAttack = Math.max(0, attack);
  if (release !== undefined) voiceRelease = Math.max(0, release);
  if (reverb !== undefined) {
    reverbWet.gain.value = Math.max(0, Math.min(1, reverb));
  }
  document.getElementById('voiceName').textContent = currentVoice;
  mup.updateState(`Voice: ${currentVoice}`, { voice: currentVoice });
  return {
    content: [{ type: 'text', text: `Voice: ${currentVoice}, reverb: ${reverbWet.gain.value}, attack: ${voiceAttack}s, release: ${voiceRelease}s` }],
    isError: false
  };
});

mup.registerFunction('playChord', ({ chord, duration, velocity, arpeggiate, octave }) => {
  getCtx();
  const oct = octave || 4;
  const dur = duration || 2;
  const vel = velocity || 0.7;
  const arp = arpeggiate || false;
  const bpm = 120; // default for single chord

  const parsed = parseChord(chord, oct);
  if (!parsed) return { content: [{ type: 'text', text: `Cannot parse chord: ${chord}` }], isError: true };

  const durationSec = dur * 60 / bpm;
  const now = getCtx().currentTime;

  isPlaying = true;
  document.getElementById('status').textContent = 'Playing';
  scheduleChord(parsed, now, durationSec, vel, arp);

  // Schedule end
  const endMs = durationSec * 1000 + voiceRelease * 1000;
  const tid = setTimeout(() => {
    if (isPlaying) {
      isPlaying = false;
      clearChordDisplay();
      document.getElementById('status').textContent = 'Ready';
    }
  }, endMs);
  playbackTimeouts.push(tid);

  mup.emitEvent('playback-start', { chord: chord, notes: parsed.midiNotes });

  return {
    content: [{ type: 'text', text: `Playing ${chord} (${dur} beats, oct ${oct})` }],
    isError: false
  };
});

mup.registerFunction('playProgression', ({ chords, bpm, loop }) => {
  getCtx();
  if (!chords || chords.length === 0) {
    return { content: [{ type: 'text', text: 'No chords provided' }], isError: true };
  }

  const tempo = bpm || centralBpm;
  const shouldLoop = loop || false;

  // Stop any current playback
  stopAll();

  document.getElementById('bpmDisplay').textContent = tempo + ' BPM';
  isPlaying = true;
  document.getElementById('status').textContent = `Playing (${chords.length} chords)`;

  // Calculate total bars for step display
  let totalBeats = 0;
  chords.forEach(entry => { totalBeats += (entry.duration || 2); });
  const totalBars = Math.ceil(totalBeats / 4);
  const totalSteps = totalBars * STEPS_PER_BAR;
  initStepDisplay(totalBars);
  startStepTimer(tempo, totalSteps);

  function scheduleProgression() {
    const c = getCtx();
    let time = c.currentTime;
    const beatDuration = 60 / tempo;

    chords.forEach((entry, idx) => {
      const chordName = entry.chord;
      const dur = entry.duration || 2;
      const arp = entry.arpeggiate || false;
      const durationSec = dur * beatDuration;

      const parsed = parseChord(chordName, 4);
      if (!parsed) return;

      scheduleChord(parsed, time, durationSec, 0.7, arp);

      // Emit playback-start event at the right time
      const delayMs = Math.max(0, (time - c.currentTime) * 1000);
      const tid = setTimeout(() => {
        mup.emitEvent('playback-start', { chord: chordName, notes: parsed.midiNotes });
      }, delayMs);
      playbackTimeouts.push(tid);

      time += durationSec;
    });

    // Total duration
    const totalDuration = time - c.currentTime;
    const endTid = setTimeout(() => {
      if (!isPlaying) return;
      if (shouldLoop) {
        clearAllKeys();
        pruneStoppedNodes();
        initStepDisplay(totalBars);
        startStepTimer(tempo, totalSteps);
        scheduleProgression();
      } else {
        isPlaying = false;
        clearChordDisplay();
        clearAllKeys();
        clearStepInterval();
        highlightStep(-1);
        document.getElementById('status').textContent = 'Ready';
        mup.emitEvent('playback-end', { chords: chords.length });
      }
    }, totalDuration * 1000);
    playbackTimeouts.push(endTid);
  }

  scheduleProgression();

  return {
    content: [{ type: 'text', text: `Playing ${chords.length} chords at ${tempo} BPM${shouldLoop ? ' (looping)' : ''}` }],
    isError: false
  };
});

mup.registerFunction('playMelody', ({ notes, bpm, octave }) => {
  getCtx();
  if (!notes) return { content: [{ type: 'text', text: 'No notes provided' }], isError: true };

  const tempo = bpm || centralBpm;
  const defaultOctave = octave || 4;
  const beatDuration = 60 / tempo;

  // Stop current playback
  stopAll();

  document.getElementById('bpmDisplay').textContent = tempo + ' BPM';
  isPlaying = true;
  document.getElementById('status').textContent = 'Playing melody';

  const tokens = notes.split(/\s+/).filter(t => t !== '|');
  const c = getCtx();
  let time = c.currentTime;
  const output = getOutput();
  const velGain = c.createGain();
  velGain.gain.value = 0.7;
  velGain.connect(output);

  // Step display: each token = 1 beat, bars = ceil(tokens / 4)
  const totalBars = Math.ceil(tokens.length / 4);
  const totalSteps = totalBars * STEPS_PER_BAR;
  initStepDisplay(totalBars);
  startStepTimer(tempo, totalSteps);

  let noteCount = 0;
  tokens.forEach(token => {
    if (token === '-') {
      // Rest
      time += beatDuration;
      return;
    }
    const midi = noteNameToMidi(token, defaultOctave);
    if (midi === null) {
      time += beatDuration;
      return;
    }

    const freq = midiToFreq(midi);
    const oscNodes = playNoteWithVoice(freq, time, beatDuration * 0.9, 1, velGain);
    scheduledNodes.push(...oscNodes);

    const rootLetter = token.charAt(0).toUpperCase();
    const color = ROOT_COLORS[rootLetter] || 'var(--accent)';
    const delayMs = Math.max(0, (time - c.currentTime) * 1000);
    const tid = setTimeout(() => {
      highlightKey(midi, color, beatDuration * 900);
      showChord(token, rootLetter);
    }, delayMs);
    playbackTimeouts.push(tid);

    noteCount++;
    time += beatDuration;
  });

  const totalDuration = time - c.currentTime;
  const endTid = setTimeout(() => {
    if (!isPlaying) return;
    isPlaying = false;
    clearChordDisplay();
    clearAllKeys();
    clearStepInterval();
    highlightStep(-1);
    document.getElementById('status').textContent = 'Ready';
    mup.emitEvent('playback-end', { notes: noteCount });
  }, totalDuration * 1000);
  playbackTimeouts.push(endTid);

  return {
    content: [{ type: 'text', text: `Playing melody: ${noteCount} notes at ${tempo} BPM` }],
    isError: false
  };
});

mup.registerFunction('setBPM', ({ bpm: b, swing: s }) => {
  if (b !== undefined) centralBpm = b;
  if (s !== undefined) swing = Math.max(0, Math.min(1, s));
  document.getElementById('bpmDisplay').textContent = `${centralBpm} BPM`;
  return { content: [{ type: 'text', text: `BPM: ${centralBpm}, swing: ${swing}` }], isError: false };
});

mup.registerFunction('stop', () => {
  stopAll();
  return { content: [{ type: 'text', text: 'Stopped.' }], isError: false };
});

// ---- User control buttons ----

// Voice preset defaults (attack/release per voice)
const VOICE_DEFAULTS = {
  piano:   { attack: 0.01, release: 0.3 },
  epiano:  { attack: 0.01, release: 0.3 },
  pad:     { attack: 0.3,  release: 1.0 },
  organ:   { attack: 0.01, release: 0.02 },
  strings: { attack: 0.15, release: 0.6 }
};

function applyVoice(voice) {
  getCtx();
  currentVoice = voice;
  const defaults = VOICE_DEFAULTS[voice] || VOICE_DEFAULTS.piano;
  voiceAttack = defaults.attack;
  voiceRelease = defaults.release;
  document.getElementById('voiceName').textContent = voice;
  // Update active class on buttons
  document.querySelectorAll('.voice-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.voice === voice);
  });
  mup.updateState(`Voice: ${currentVoice}`, { voice: currentVoice });
}

document.querySelectorAll('.voice-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const voice = btn.dataset.voice;
    applyVoice(voice);
    mup.notifyInteraction('voice-change', `Changed to ${voice}`, { voice });
  });
});

document.getElementById('stopBtn').addEventListener('click', () => {
  stopAll();
  mup.notifyInteraction('stop', 'Stopped playback', {});
});

document.getElementById('volumeSlider').addEventListener('input', function() {
  masterVolume = this.value / 100;
  if (masterNode) masterNode.gain.value = masterVolume;
});

// ---- MUP lifecycle ----
mup.onReady(({ theme }) => {
  if (theme === 'dark') document.body.classList.add('dark');
  buildKeyboard();
  drawWaveform();
  mup.updateState('Chord Pad ready', { voice: currentVoice });
});

mup.onThemeChange((theme) => {
  document.body.classList.toggle('dark', theme === 'dark');
});
