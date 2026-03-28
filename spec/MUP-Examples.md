# MUP Examples

> **Note:** The original example MUPs have been moved to `archive/examples/`. The active MUPs are now in `mups/` — **slides/** (presentation), **sound-pad/** (synthesizer), **voice.html** (voice assistant), and **progress.html** (progress indicator). See the [main README](../README.md) for details.

This document describes the archived example MUPs. Each demonstrates a different protocol capability.

---

## Overview

### basic/

| MUP | Grid | Functions | Demonstrates |
|-----|------|-----------|-------------|
| [Counter](#counter) | 1×1 | `setCount`, `getCount` | Basic bidirectional function calls |
| [Timer](#timer) | 1×1 | `start`, `pause`, `reset`, `setTime`, `getStatus` | `updateState` at state transitions |
| [Dice](#dice) | 1×1 | `roll`, `getLastRoll` | Multi-dice rolls, interactive entertainment |
| [Chess](#chess) | 1×1 | `makeMove`, `getBoard`, `resetGame` | Turn-based game with LLM opponent |

### creative/

| MUP | Grid | Functions | Demonstrates |
|-----|------|-----------|-------------|
| [Pixel Art](#pixel-art) | 1×1 | `setPixels`, `fillRect`, `clear`, `getGrid` | LLM-driven pixel display |
| [Slides](#slides) | 2×2 | `createPresentation`, `addSlide`, `updateSlide`, `removeSlide`, `getSlides`, `setTheme` | Presentation builder with layouts |

### data/

| MUP | Grid | Functions | Demonstrates |
|-----|------|-----------|-------------|
| [Chart](#chart) | 1×1 | `renderChart`, `clear`, `getData`, `setType` | LLM → visual data pipeline |

### games/

| MUP | Grid | Functions | Demonstrates |
|-----|------|-----------|-------------|
| [Snake Engine](#snake-engine) | 1×1 | — | Game engine example |

### media/

| MUP | Grid | Functions | Demonstrates |
|-----|------|-----------|-------------|
| [Camera](#camera) | 1×1 | `capturePhoto`, `startCamera`, `stopCamera` | Browser permissions + multimodal `image` content |
| [Voice](#voice) | 1×1 | `startListening`, `stopListening`, `speak`, `getTranscript` | Speech-to-text + text-to-speech |

### music/

| MUP | Grid | Functions | Demonstrates |
|-----|------|-----------|-------------|
| [Drums](#drums) | 1×1 | `setPattern`, `toggleStep`, `setBPM`, `play`, `stop`, `clear`, `getState` | Complex state + Web Audio |
| Plus 7 others | — | — | arranger, bass, guitar, mixer, piano, strings, synth |

### productivity/

| MUP | Grid | Functions | Demonstrates |
|-----|------|-----------|-------------|
| [Markdown](#markdown) | 1×1 | `loadFile`, `render`, `clear` | Markdown rendering + file loading |
| [Sticky Notes](#sticky-notes) | 1×1 | `addNote`, `moveNote`, `removeNote`, `editNote`, `getNotes`, `clearAll`, `setNotifications` | Full CRUD + position control |
| [Kanban](#kanban) | 2×1 | `addTask`, `moveTask`, `removeTask`, `getTasks`, `clearBoard`, `addColumn` | Task management board with drag-and-drop |

---

## Counter

**File:** `basic/counter.html`

The "hello world" of MUP. A number, two buttons, two functions.

**What it shows:**
- Simplest possible manifest
- `registerFunction` with both read and write operations
- `notifyInteraction` on user clicks
- `updateState` to keep LLM informed
- `onReady` for initialization

**Demo flow:** Load it → LLM can `setCount(42)` → User clicks +/- → LLM sees the interaction via badge → LLM can `getCount()` to read current value.

---

## Timer

**File:** `basic/timer.html`

Countdown timer with a circular SVG progress ring.

**What it shows:**
- **`updateState` at every transition**: LLM knows when the timer starts, pauses, resets, or completes
- LLM can start/pause/reset the timer
- Completion notification: LLM knows when timer finishes
- SVG animation (progress ring with `stroke-dashoffset`)

**Demo flow:** User asks "Set a 2-minute timer" → LLM calls `start({ seconds: 120 })` → Ring animates → Timer reaches 0 → LLM sees "Timer completed!" → Can respond accordingly.

---

## Dice

**File:** `basic/dice.html`

A single six-sided die with CSS-rendered dot faces and roll animation.

**What it shows:**
- Fun, interactive use case — games, decisions, random generation
- CSS-only d6 face rendering with dot patterns
- Roll animation
- Roll history

**Demo flow:** User says "Roll for me" → LLM calls `roll()` → Animated d6 lands on 4 → LLM says "You rolled a 4!"

---

## Chess

**File:** `basic/chess.html`

A chess board where the user plays against the LLM. Simple coordinate-based moves (e.g., `e2e4`).

**What it shows:**
- Turn-based game interaction between user and LLM
- `notifyInteraction` to report user moves
- Coordinate notation for moves (from-square + to-square)
- LLM as an opponent, not just an assistant

**Demo flow:** User clicks a piece and moves it → LLM sees the move → LLM calls `makeMove("e7e5")` → Board updates → User's turn again.

---

## Pixel Art

**File:** `creative/pixel-art.html`

A 16×16 pixel display rendered on `<canvas>`. The LLM draws by calling `setPixels`.

**What it shows:**
- **LLM → visual pipeline**: LLM generates pixel data, MUP renders it
- Array-of-objects in `inputSchema` (pixel coordinates + colors)
- `<canvas>` with `image-rendering: pixelated` for crisp pixel art
- `ResizeObserver` for responsive rendering

**Demo flow:** User asks "Draw a heart" → LLM calls `setPixels` with heart-shaped coordinates in red → Canvas renders the heart → User sees the pixel art.

---

## Slides

**File:** `creative/slides.html`

A presentation maker. LLM creates slides with titles, markdown content, and different layouts.

**What it shows:**
- Batch creation via `createPresentation()` (full deck at once)
- Multiple layouts: title, content, split, image
- Theme support via `setTheme()`
- Individual slide management: add, update, remove

**Demo flow:** User asks "Make a presentation about MUP" → LLM calls `createPresentation()` with multiple slides → User browses slides → Asks "Change the theme to dark" → LLM calls `setTheme("dark")`.

---

## Chart

**File:** `data/chart.html`

Data visualization: bar, line, and pie charts rendered on Canvas.

**What it shows:**
- **LLM → visual pipeline**: LLM generates data, MUP renders it as a chart
- Complex `inputSchema` with nested objects and arrays (datasets)
- Canvas rendering with proper scaling and DPI handling
- User can switch chart types; LLM can set chart types via `setType()`
- `ResizeObserver` for responsive rendering

**Demo flow:** User asks "Show me a comparison of Q1-Q4 sales" → LLM calls `renderChart({ type: "bar", labels: ["Q1","Q2","Q3","Q4"], datasets: [{label: "2024", data: [120,150,180,200]}] })` → Chart appears → User clicks "Pie" to switch view.

---

## Snake Engine

**File:** `games/snake-engine.html`

A Snake game engine. Demonstrates game logic running inside a MUP.

---

## Camera

**File:** `media/camera.html`

Live camera feed with photo capture. The LLM receives photos as base64 images.

**What it shows:**
- `permissions: ["camera"]` in manifest
- Multimodal `image` content type in function results
- Landing state → active state UI transition
- `updateState` for camera on/off status
- Auto-start: `capturePhoto` starts the camera automatically if not running

**Demo flow:** User asks "What do you see?" → LLM calls `capturePhoto` → Camera auto-starts → Photo returned as `{ type: "image", data: "base64...", mimeType: "image/jpeg" }` → LLM describes the photo.

---

## Voice

**File:** `media/voice.html`

Voice assistant with speech-to-text and text-to-speech. User taps the mic to speak, the transcription is sent to the LLM, and the LLM can reply with spoken audio.

**What it shows:**
- `permissions: ["microphone"]` in manifest
- Speech recognition (Web Speech API)
- Text-to-speech via `speak()`
- Push-to-talk interaction: user taps mic, speaks one utterance
- `notifyInteraction` with transcribed text

**Demo flow:** User taps mic → Speaks "What's the weather?" → Transcript sent to LLM → LLM calls `speak({ text: "I can't check the weather, but I can help with other things!" })` → User hears the response.

---

## Drums

**File:** `music/drums.html`

A 4-track, 16-step sequencer with Web Audio synthesis. LLM can compose beats.

**What it shows:**
- Complex state management (4 instruments × 16 steps + BPM + playback state)
- Multiple functions with different parameter types
- Web Audio API usage inside a MUP
- Rich `updateState` with structured data

**Demo flow:** User asks "Make a hip-hop beat" → LLM calls `setPattern` for kick, snare, hihat → calls `setBPM(90)` → calls `play` → User hears the beat and can tweak it.

---

## Markdown

**File:** `productivity/markdown.html`

A markdown renderer. Can render LLM-generated content or load `.md` files from the workspace.

**What it shows:**
- Markdown rendering with headings, lists, code blocks, tables, links
- Cross-MUP collaboration potential

**Demo flow:** User asks "Show me the README" → LLM calls `loadFile({ path: "README.md" })` → Markdown rendered in the viewer → User can click refresh to reload from source.

---

## Sticky Notes

**File:** `productivity/sticky-notes.html`

A board of draggable, editable sticky notes with colors.

**What it shows:**
- Full CRUD: add, edit, remove, list, clear
- Enum types in `inputSchema` (color options)
- Pointer-based drag and drop
- `contenteditable` for inline editing
- Each note has a visible ID for LLM reference
- Configurable notifications via `setNotifications()`

**Demo flow:** User asks "Brainstorm ideas for a birthday party" → LLM calls `addNote` multiple times with different colors → User drags to rearrange → Edits text → LLM sees interactions.

---

## Kanban

**File:** `productivity/kanban.html`

A task board with columns (To Do, In Progress, Done). LLM can manage tasks, users can drag cards between columns.

**What it shows:**
- Drag-and-drop between columns
- Dynamic column creation via `addColumn()`
- `notifyInteraction` on card moves and edits
- Task management workflow with LLM assistance

**Demo flow:** User asks "Help me plan this sprint" → LLM calls `addTask` for each item → User drags "Login page" to In Progress → LLM sees the move → Can suggest next steps.

---

## Protocol Feature Coverage

| Feature | Example MUPs |
|---------|-------------|
| `registerFunction` | All documented examples |
| `onReady` | All documented examples |
| `updateState` | All documented examples |
| `notifyInteraction` | Counter, Timer, Dice, Chess, Chart, Camera, Voice, Drums, Sticky Notes, Kanban |
| `permissions` | Camera, Voice |
| `text` content | All documented examples |
| `data` content | All except Camera |
| `image` content | Camera |
| Headless MUP (0×0) | — (none currently) |
