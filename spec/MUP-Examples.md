# MUP Examples

This document describes the example MUPs included in `poc/examples/`. Each demonstrates a different protocol capability.

---

## Overview

| MUP | Grid | Functions | Demonstrates |
|-----|------|-----------|-------------|
| [Counter](#counter) | 1×1 | `setCount`, `getCount` | Basic bidirectional function calls |
| [Pixel Art](#pixel-art) | 2×2 | `setPixels`, `clear`, `getGrid` | LLM-driven pixel display |
| [Drum Machine](#drum-machine) | 2×2 | `setPattern`, `setBPM`, `play`, `stop`, `clear`, `getState` | Complex state + Web Audio |
| [Sticky Notes](#sticky-notes) | 2×2 | `addNote`, `removeNote`, `editNote`, `getNotes`, `clearAll` | Full CRUD operations |
| [Camera](#camera) | 2×2 | `capturePhoto`, `startCamera`, `stopCamera` | Browser permissions + multimodal `image` content |
| [File Organizer](#file-organizer) | 2×2 | `getStatus`, `listFiles`, `createFolder`, `moveFile`, `readFileText` | File System Access API |
| [Chart](#chart) | 2×2 | `renderChart`, `clear`, `getData` | LLM → visual data pipeline |
| [Timer](#timer) | 1×1 | `start`, `pause`, `reset`, `getStatus` | `updateState` at state transitions |
| [Dice](#dice) | 1×1 | `roll`, `getLastRoll` | Single d6, interactive entertainment |

---

## Counter

**File:** `counter.html`

The "hello world" of MUP. A number, two buttons, two functions.

**What it shows:**
- Simplest possible manifest
- `registerFunction` with both read and write operations
- `notifyInteraction` on user clicks
- `updateState` to keep LLM informed
- `onReady` for initialization

**Demo flow:** Load it → LLM can `setCount(42)` → User clicks +/- → LLM sees the interaction via badge → LLM can `getCount()` to read current value.

---

## Pixel Art

**File:** `pixel-art.html`

A 16×16 pixel display rendered on `<canvas>`. The LLM draws by calling `setPixels`.

**What it shows:**
- **LLM → visual pipeline**: LLM generates pixel data, MUP renders it
- Array-of-objects in `inputSchema` (pixel coordinates + colors)
- `<canvas>` with `image-rendering: pixelated` for crisp pixel art
- `ResizeObserver` for responsive rendering

**Demo flow:** User asks "Draw a heart" → LLM calls `setPixels` with heart-shaped coordinates in red → Canvas renders the heart → User sees the pixel art.

---

## Drum Machine

**File:** `drum-machine.html`

A 4-track, 16-step sequencer with Web Audio synthesis. LLM can compose beats.

**What it shows:**
- Complex state management (4 instruments × 16 steps + BPM + playback state)
- Multiple functions with different parameter types
- Web Audio API usage inside a MUP
- Rich `updateState` with structured data

**Demo flow:** User asks "Make a hip-hop beat" → LLM calls `setPattern` for kick, snare, hihat → calls `setBPM(90)` → calls `play` → User hears the beat and can tweak it.

---

## Sticky Notes

**File:** `sticky-notes.html`

A board of draggable, editable sticky notes with colors.

**What it shows:**
- Full CRUD: add, edit, remove, list, clear
- Enum types in `inputSchema` (color options)
- Pointer-based drag and drop
- `contenteditable` for inline editing
- Each note has a visible ID for LLM reference

**Demo flow:** User asks "Brainstorm ideas for a birthday party" → LLM calls `addNote` multiple times with different colors → User drags to rearrange → Edits text → LLM sees interactions.

---

## Camera

**File:** `camera.html`

Live camera feed with photo capture. The LLM receives photos as base64 images.

**What it shows:**
- `permissions: ["camera"]` in manifest
- Multimodal `image` content type in function results
- Landing state → active state UI transition
- `updateState` for camera on/off status
- Auto-start: `capturePhoto` starts the camera automatically if not running

**Demo flow:** User asks "What do you see?" → LLM calls `capturePhoto` → Camera auto-starts → Photo returned as `{ type: "image", data: "base64...", mimeType: "image/jpeg" }` → LLM describes the photo.

---

## File Organizer

**File:** `file-organizer.html`

Browse and organize local files via the File System Access API.

**What it shows:**
- `permissions: ["file-system-access"]`
- Complex multi-step operations (navigate, list, move, read)
- User-initiated actions that the LLM can't trigger directly (folder picker requires user gesture)
- Breadcrumb navigation
- `updateState` to report open folder name

**Demo flow:** User clicks "Choose Folder" → LLM sees "Folder opened: Downloads" → LLM calls `listFiles` → Sees messy files → Calls `createFolder("images")` → Calls `moveFile` to organize.

---

## Chart

**File:** `chart.html`

Data visualization: bar, line, and pie charts rendered on Canvas.

**What it shows:**
- **LLM → visual pipeline**: LLM generates data, MUP renders it as a chart
- Complex `inputSchema` with nested objects and arrays (datasets)
- Canvas rendering with proper scaling and DPI handling
- User can switch chart types; LLM can set chart types
- `ResizeObserver` for responsive rendering

**Demo flow:** User asks "Show me a comparison of Q1-Q4 sales" → LLM calls `renderChart({ type: "bar", labels: ["Q1","Q2","Q3","Q4"], datasets: [{label: "2024", data: [120,150,180,200]}] })` → Chart appears → User clicks "Pie" to switch view.

---

## Timer

**File:** `timer.html`

Countdown timer with a circular SVG progress ring.

**What it shows:**
- **`updateState` at every transition**: LLM knows when the timer starts, pauses, resets, or completes
- LLM can start/pause/reset the timer
- Completion notification: LLM knows when timer finishes
- SVG animation (progress ring with `stroke-dashoffset`)

**Demo flow:** User asks "Set a 2-minute timer" → LLM calls `start({ seconds: 120 })` → Ring animates → Timer reaches 0 → LLM sees "Timer completed!" → Can respond accordingly.

---

## Dice

**File:** `dice.html`

A single six-sided die with CSS-rendered dot faces and roll animation.

**What it shows:**
- Fun, interactive use case — games, decisions, random generation
- CSS-only d6 face rendering with dot patterns
- Roll animation
- Roll history

**Demo flow:** User says "Roll for me" → LLM calls `roll()` → Animated d6 lands on 4 → LLM says "You rolled a 4!"

---

## Protocol Feature Coverage

| Feature | Example MUPs |
|---------|-------------|
| `registerFunction` | All 9 |
| `onReady` | All 9 |
| `updateState` | All 9 |
| `notifyInteraction` | Counter, Drum Machine, Sticky Notes, Camera, File Organizer, Chart, Timer, Dice |
| `requestResize` | — (none currently, candidates: chart, sticky notes) |
| `permissions` | Camera, File Organizer |
| `text` content | All 9 |
| `data` content | Counter, Drum Machine, Pixel Art, Sticky Notes, File Organizer, Chart, Timer, Dice |
| `image` content | Camera |

| Headless MUP (0×0) | — (none currently) |
