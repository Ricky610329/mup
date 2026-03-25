# MUP — Model UI Protocol

Version: `mup/2026-03-17` (Draft)

---

# Protocol

## 1. What is MUP

A **MUP** is an interactive UI component that lives inside an LLM chat interface. It bundles a visual interface with callable functions — the user operates it through the UI, the LLM operates it through function calls, and both sides see each other's actions.

The simplest MUP is a single `.html` file. No build step, no framework, no SDK install.

```
          User
         ↗    ↖
    (visual)  (natural language)
       ↙          ↘
   MUP UI  ←→  LLM
        ↘    ↙
       Host Runtime
```

**Key ideas:**

- **Shared functions.** A function declared in the manifest can be called by the LLM (as a tool) or triggered by the user (via UI). Not every function needs a button, and not every button needs a function — but when they overlap, the implementation is shared.
- **LLM as orchestrator.** MUPs don't talk to each other. The LLM mediates: MUP A's output goes to the LLM, which decides to call MUP B.
- **Host-agnostic.** This spec defines the MUP format and communication protocol. How the host renders, isolates, or manages MUPs is the host's business.

---

## 2. Quick Start

A complete, working MUP:

```html
<!DOCTYPE html>
<html>
<head>
  <script type="application/mup-manifest">
  {
    "name": "Counter",
    "description": "A counter. User clicks +/-, LLM can set or read the value.",
    "grid": { "minWidth": 1, "minHeight": 1 },
    "functions": [
      {
        "name": "setCount",
        "description": "Set the counter to a specific value",
        "inputSchema": {
          "type": "object",
          "properties": { "value": { "type": "number" } },
          "required": ["value"]
        }
      },
      {
        "name": "getCount",
        "description": "Get the current counter value",
        "inputSchema": { "type": "object", "properties": {} }
      }
    ]
  }
  </script>
</head>
<body>
  <div id="count" style="font-size:48px; text-align:center; padding:20px;">0</div>
  <div style="text-align:center;">
    <button id="dec">−</button>
    <button id="inc">+</button>
  </div>
  <script>
    let count = 0;
    const el = document.getElementById('count');

    document.getElementById('dec').addEventListener('click', () => adjust(-1));
    document.getElementById('inc').addEventListener('click', () => adjust(+1));

    function adjust(delta) {
      count += delta;
      el.textContent = count;
      mup.notifyInteraction(
        delta > 0 ? 'increment' : 'decrement',
        `Counter is now ${count}`,
        { count }
      );
    }

    mup.registerFunction('setCount', async (params) => {
      count = params.value;
      el.textContent = count;
      return { content: [{ type: 'text', text: `Counter set to ${count}` }], isError: false };
    });

    mup.registerFunction('getCount', async () => {
      return { content: [{ type: 'text', text: `Counter is at ${count}` }, { type: 'data', data: { count } }], isError: false };
    });

    mup.onReady(() => {
      mup.updateState(`Counter: ${count}`, { count });
    });
  </script>
</body>
</html>
```

Drop this file into a MUP-compatible host, and it works. (`grid` is optional — omit it for the host's default size.)

---

## 3. Manifest

Every MUP declares a JSON manifest inside a `<script type="application/mup-manifest">` tag. This tells the host what the MUP is, how much space it needs, and what functions it exposes.

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Display name. Shown in the host UI. |
| `description` | string | What this MUP does. **The LLM reads this** to decide when to use your MUP and how to talk about it. Write it for both humans and LLMs. |

### Optional Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `protocol` | string | Current version | Protocol version (e.g., `"mup/2026-03-17"`). |
| `id` | string | Host-generated | Unique identifier. Reverse-domain recommended (e.g., `"com.example.my-chart"`). Stable IDs help the LLM remember your MUP across sessions. |
| `version` | string | `"1.0.0"` | Semantic version of your MUP. |
| `grid` | object | Host default | Size hints. See [Grid](#4-grid). |
| `functions` | Function[] | `[]` | Callable functions. Omit or empty = display-only MUP. |
| `permissions` | string[] | `[]` | Browser permissions you need (e.g., `["camera", "microphone"]`). The host restricts your container to only these. |
| `author` | string | — | Your name. |
| `icon` | string | — | URL or data URI for an icon. |

---

## 4. Grid

The `grid` object is an **optional hint** that tells the host how much space your MUP prefers, in abstract grid cells. The host decides the actual layout — it may use a grid, floating windows, tabs, or any other arrangement. A MUP without `grid` gets the host's default size.

```json
{
  "minWidth": 2,
  "minHeight": 2,
  "maxWidth": 4,
  "maxHeight": 3,
  "preferredWidth": 2,
  "preferredHeight": 2,
  "resizable": true
}
```

All fields are optional:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `minWidth` | integer | 1 | Preferred minimum columns (≥ 0) |
| `minHeight` | integer | 1 | Preferred minimum rows (≥ 0) |
| `maxWidth` | integer | minWidth | Preferred maximum columns |
| `maxHeight` | integer | minHeight | Preferred maximum rows |
| `preferredWidth` | integer | minWidth | Ideal columns |
| `preferredHeight` | integer | minHeight | Ideal rows |
| `resizable` | boolean | false | Hint that this MUP benefits from user resizing |

These are **hints, not guarantees**. The host may allocate a different size based on available space, screen size, or its own layout strategy.

**Headless MUP:** Set `minWidth: 0, minHeight: 0` for a MUP with no UI — only functions. The host won't show it visually.

---

## 5. Functions

Functions are the core of MUP. Each function is callable by the LLM (as a tool) and can also be triggered by your own UI.

### Declaring in Manifest

```json
{
  "name": "renderChart",
  "description": "Render a chart from the given data",
  "inputSchema": {
    "type": "object",
    "properties": {
      "type": { "type": "string", "enum": ["bar", "line", "pie"] },
      "data": { "type": "array", "items": { "type": "number" } }
    },
    "required": ["type", "data"]
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Function name. Must match `^[a-zA-Z][a-zA-Z0-9_]*$`. |
| `description` | string | Yes | What this function does. **The LLM reads this** to decide when to call it. |
| `inputSchema` | JSON Schema | Yes | JSON Schema for the function's parameters. |

### Function Result Format

Every function must return a `FunctionCallResult`:

```typescript
{
  content: ContentItem[];
  isError: boolean;
}
```

Each `ContentItem` is one of:

| Type | Fields | Use for |
|------|--------|---------|
| `text` | `{ type: "text", text: "..." }` | Human/LLM-readable description of what happened |
| `data` | `{ type: "data", data: {...} }` | Structured JSON data for the LLM to process |
| `image` | `{ type: "image", data: "base64...", mimeType: "image/jpeg" }` | Images (e.g., camera snapshots) |

Always include at least one `text` content item — the LLM needs it to understand the result.

---

## 6. Lifecycle

A MUP goes through a fixed sequence of stages:

```
load → initialize → onReady → active → shutdown → destroyed
```

**Rules:**

1. **`registerFunction` MUST be called synchronously during script evaluation** — before the host sends `initialize`. The host reads registered function names during initialization; late registrations are ignored.
2. **Host MUST send `initialize` exactly once**, as the first JSON-RPC message after the MUP loads.
3. **Host MUST NOT send `functions/call` before receiving the `initialize` response.** Any function calls before that point are invalid.
4. **After `gracePeriodMs` expires, host MAY destroy the container** without waiting for `notifications/shutdown/complete`. MUPs should clean up quickly.
5. **`onReady` fires after `initialize` succeeds.** This is the right place for initial state setup, DOM rendering, and the first `updateState` call.

---

## 7. Error Handling

### Function errors

If a function handler throws an exception, the SDK catches it and returns:

```json
{ "content": [{ "type": "text", "text": "Error: <message>" }], "isError": true }
```

The host forwards this to the LLM so it can react accordingly.

### Invalid function calls

| Scenario | Host behavior |
|----------|--------------|
| LLM calls a function name that doesn't exist in the manifest | Host returns a JSON-RPC error (`-32601 Method not found`). The call is **not** forwarded to the MUP. |
| `registerFunction` called with a name not declared in the manifest | Host SHOULD log a warning. The function is **not** callable. |
| Function call times out (handler doesn't respond) | Host MAY return `{ isError: true }` after an implementation-defined timeout. |

### Unknown methods

Both sides may encounter methods they do not recognize — for example, a MUP using an extension method that the host does not support.

- **Host** receiving an unknown MUP→Host request MUST respond with JSON-RPC error code `-32601` (Method not found).
- **MUP** receiving an unknown Host→MUP request MUST respond with JSON-RPC error code `-32601` (Method not found).
- Unknown **notifications** (no `id`) SHOULD be silently ignored by both sides.
- The caller SHOULD handle `-32601` gracefully (e.g., fall back to alternative behavior) rather than treating it as a fatal error.

### JSON-RPC error codes

Both hosts and MUPs SHOULD use standard JSON-RPC 2.0 error codes:

| Code | Meaning |
|------|---------|
| `-32600` | Invalid request |
| `-32601` | Method not found |
| `-32603` | Internal error |

---

# Guidance

## 8. SDK Reference

The host injects a global `mup` object into your MUP. No import needed.

### `mup.registerFunction(name, handler)`

Register a function declared in your manifest.

```javascript
mup.registerFunction('myFunc', async (params, source) => {
  // params: object matching your inputSchema
  // source: "llm" | "user"
  return { content: [...], isError: false };
});
```

### `mup.onReady(callback)`

Called once after the host completes initialization. Use this to set up initial state.

```javascript
mup.onReady((params) => {
  // params.gridAllocation = { width, height } — your allocated grid size
  // params.savedState = { ... } — optional, previous state from host (see State Persistence)
  if (params.savedState) {
    restoreFrom(params.savedState);
  }
  mup.updateState('Ready', { initialized: true });
});
```

### `mup.updateState(summary, data?)`

Tell the host your current state. The host forwards `summary` to the LLM's context, so the LLM always knows what's happening in your MUP.

```javascript
mup.updateState('Timer running: 45s remaining', { status: 'running', remaining: 45 });
```

**Throttle this** — the host may silently drop excess calls. Call frequency should be reasonable for the data being reported.

### `mup.notifyInteraction(action, summary, data?)`

Tell the host the user did something in your UI. The host forwards `summary` to the LLM.

```javascript
mup.notifyInteraction('paint', 'User painted 12 pixels in red', { color: '#ff0000', count: 12 });
```

- `action`: machine-readable identifier (e.g., `"click"`, `"drag"`, `"toggle"`)
- `summary`: LLM-readable description of what the user did
- `data`: optional structured data

#### Notification levels (optional)

MUPs can declare a notification level in their manifest to control how the host delivers interactions to the LLM:

```json
{
  "notifications": {
    "level": "immediate",
    "overridable": false
  }
}
```

| Level | Behavior | Use case |
|-------|----------|----------|
| `immediate` | Host pushes interactions to the LLM in real time (e.g., via channel notifications). The LLM is expected to respond. | Chat, turn-based games |
| `notify` | Interactions are queued and delivered when the LLM polls (e.g., `checkInteractions`). **This is the default.** | Kanban updates, drawing edits |
| `silent` | `notifyInteraction` calls are suppressed entirely. Only `updateState` is active. | Sliders, minor UI tweaks |

The `overridable` field controls whether the LLM can dynamically change the level at runtime (e.g., a user says "watch what I'm doing" and the LLM upgrades a MUP from `notify` to `immediate`). Defaults to `true` if omitted. Set to `false` for MUPs where the level must not change (e.g., a chat panel must always be `immediate`).

If `notifications` is omitted from the manifest, the MUP defaults to `notify` with `overridable: true`.

**Self-notification prevention:** When the LLM calls a function on a MUP, interactions from that same MUP during the call should be suppressed to avoid circular notifications.

```javascript
// Chat MUP: always immediate, not overridable
// manifest: { "notifications": { "level": "immediate", "overridable": false } }
mup.notifyInteraction('message', 'Hello!', { text: 'Hello!' });

// Counter MUP: default (notify), LLM can upgrade
mup.notifyInteraction('increment', 'Counter is now 5', { count: 5 });
```

### `mup.system(action, params)` (optional)

Request a host-provided service. Returns a promise that resolves with the host's response. Not all hosts support this — handle errors gracefully.

```javascript
const results = await mup.system('webSearch', { query: 'MUP protocol' });
```

- `action`: the service to invoke (host-defined, e.g., `"webSearch"`, `"fetchUrl"`)
- `params`: action-specific parameters

This sends a `system/request` JSON-RPC call to the host. If the host does not support the action, it returns a `-32601` error. MUPs should catch this and fall back gracefully.

---

## 9. Writing Good Descriptions

The `description` field in your manifest and functions is **the only thing the LLM sees**. It doesn't see your UI, your CSS, or your HTML. Write descriptions as if you're explaining to a colleague what this MUP does and when to use each function.

**Manifest description — good:**
> A 16×16 pixel art canvas. Users paint by clicking/dragging. LLM can set pixels, draw shapes, or clear the canvas. Both sides work on the same grid.

**Manifest description — bad:**
> Pixel art tool.

**Function description — good:**
> Take a photo from the camera and return it as a base64 JPEG image. Use this when the user asks you to look at something or analyze what's in front of them.

**Function description — bad:**
> Capture photo.

---

## 10. Best Practices

### updateState vs. notifyInteraction

| | `updateState` | `notifyInteraction` |
|--|---------------|---------------------|
| **When** | State changed (timer ticked, data loaded) | User did something (clicked, typed, dragged) |
| **Purpose** | Keep LLM informed of current state | Tell LLM about user actions |
| **Throttle** | Host may drop excess calls | Per-event, but batch rapid actions |

### Handle concurrent function calls

The host may call your function while a previous call is still executing. Two strategies:

1. **Queue** — process calls sequentially with a simple promise chain. Best when your function modifies shared state.
2. **Idempotent** — make each call a full state replacement (e.g., `setPixels` overwrites all pixels). No conflict possible.

Avoid relying on call order or assuming only one call runs at a time.

### State Persistence (Optional)

A host MAY save a MUP's state between sessions and restore it on reload. This is a cooperative mechanism — it requires both the host and the MUP to participate.

**How it works:**

1. **MUP reports state** — call `updateState(summary, data)` where `data` contains all state needed for restoration. This is the same call you're already making to keep the LLM informed.

2. **Host saves `data`** — the host persists the `data` from the most recent `updateState` call as part of its session storage.

3. **Host passes `savedState` on reload** — when the host re-initializes a MUP, it includes a `savedState` field in the `initialize` params:

```json
{
  "method": "initialize",
  "params": {
    "protocolVersion": "mup/2026-03-17",
    "hostInfo": { "name": "MUP Agent", "version": "0.1.0" },
    "gridAllocation": { "width": 2, "height": 2 },
    "savedState": { "count": 42 }
  }
}
```

4. **MUP restores** — in `onReady`, check for `params.savedState` and restore:

```javascript
mup.onReady((params) => {
  if (params.savedState) {
    count = params.savedState.count;
    updateDisplay();
  }
  mup.updateState('Counter: ' + count, { count });
});
```

**Rules:**

- `savedState` is **optional** in `initialize` params. MUPs MUST NOT assume it exists.
- MUPs that don't support persistence simply ignore `savedState`. No code changes needed.
- The `data` argument to `updateState` should be **JSON-serializable** and contain everything needed to restore the MUP's visual and logical state.
- Hosts are NOT required to implement state persistence. This is a host capability, not a protocol requirement.

### Keep your MUP self-contained

A MUP should work with zero external dependencies. Inline your CSS, bundle your JS, embed your assets. The host loads your HTML as-is — there's no module resolution or CDN access guaranteed.

### Permissions

If you need browser APIs (camera, microphone, geolocation), declare them in `permissions`. The host will only grant what you declare. Don't request permissions you don't need.

---

# Appendices

## Appendix A: JSON-RPC 2.0 (for host implementers)

All host↔MUP communication uses JSON-RPC 2.0 over a `MessageChannel` (or equivalent). The SDK handles serialization — MUP authors don't need to know this. For host implementers, see the [JSON-RPC 2.0 spec](https://www.jsonrpc.org/specification).

### Host → MUP messages

| Method | Type | Description |
|--------|------|-------------|
| `initialize` | Request | First message after load. Params: `protocolVersion`, `hostInfo`, `gridAllocation`, `savedState?` (optional, for state persistence). MUP responds with protocol version and info. Triggers `onReady`. |
| `functions/call` | Request | Call a registered function. Params: `name`, `arguments`, `source` (`"llm"` or `"user"`). |
| `notifications/grid/resize` | Notification | Host resized the MUP's allocation. Params: `width`, `height`. |
| `notifications/shutdown` | Notification | Host is destroying the container. Params: `reason`, `gracePeriodMs`. |

### MUP → Host messages

| Method | Type | Description |
|--------|------|-------------|
| `notifications/state/update` | Notification | MUP state changed. Params: `summary`, `data?`. |
| `notifications/interaction` | Notification | User interacted with MUP UI. Params: `action`, `summary`, `data?`. |
| `notifications/shutdown/complete` | Notification | MUP acknowledges shutdown. No params. |
| `system/request` | Request (optional) | Request a host service. Params: `action`, `params`. Host returns result or `-32601` if unsupported. |

## Appendix B: Comparison with MCP

MUP and MCP are complementary — MCP connects LLMs to backend tools and data; MUP brings interactive UI to the user. A host can support both protocols simultaneously.

| | MCP | MUP |
|--|-----|-----|
| **Purpose** | Connect LLMs to data/tools | Embed interactive UI into LLM chat |
| **Has UI** | No | Yes |
| **User can interact** | No | Yes |
| **Runs in** | Server (any language) | Browser |
| **Format** | Server process | HTML file |
| **Transport** | JSON-RPC 2.0 (stdio/SSE/HTTP) | JSON-RPC 2.0 (MessageChannel) |
| **LLM sees** | Tool definitions | Tool definitions |
| **User sees** | Nothing | Interactive UI |
| **Browser API access** | No | Yes (camera, files, audio, GPU) |
