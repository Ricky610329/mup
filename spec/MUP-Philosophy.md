# MUP Design Philosophy

This document explains the principles behind MUP's design — why certain choices were made and, more importantly, why certain features were intentionally left out. The [spec](./MUP-Spec.md) defines *what* and *how*; this document covers *why*.

---

## Three Principles

### 1. Security is the host's responsibility

The protocol defines no security mechanisms. MUPs declare what permissions they need; hosts decide what to grant. Iframe sandboxing, permissions policies, content isolation — these are all host concerns.

This keeps the protocol simple and lets each host implement security appropriate to its environment. A local development host and a production deployment will have very different security requirements; the protocol should not prescribe either.

### 2. MUPs provide functions and function descriptions

A MUP is self-describing. Its manifest declares what it does (`description`) and what it can do (`functions` with descriptions and JSON Schemas). The LLM never sees the UI, the CSS, or the HTML — it only sees these descriptions.

Good descriptions are the bridge between the visual interface and the language model. The protocol ensures this bridge exists (descriptions are required fields); it cannot ensure the bridge is well-built (that is the MUP author's job).

### 3. Rendering is unconstrained

A MUP is a full HTML document rendered in an iframe. It can use any web technology — Canvas, SVG, WebGL, video, audio, or plain DOM. The protocol does not prescribe how content is rendered.

A tiny HTML file can reference external libraries to build a complex interface. The protocol does not prevent this — though hosts are not required to provide network access, so self-containment improves portability.

---

## Core Design Decisions

### Single file, no build step

A MUP is one `.html` file. Drop it into a host and it works. The manifest, UI, and logic all live in the same file. This is the lowest possible barrier to creating and sharing a MUP.

### Shared functions

A function declared in the manifest can be called by the LLM (as a tool) or triggered by the user (via UI). Not every function needs a corresponding button, and not every UI action needs a corresponding function — but when they overlap, the implementation is shared. This is what makes MUP bidirectional: the protocol supports both callers through the same mechanism.

### LLM as orchestrator

MUPs do not communicate with each other. The LLM reads one MUP's output and decides whether to call another. Each MUP only needs to know about itself and the host. Cross-MUP coordination is the LLM's job.

### Host-agnostic

The spec defines the message contract between a MUP and its host. It does not define how the host renders MUPs, presents information to the LLM, or enforces security. Different hosts may use different layouts, different LLM APIs, and different isolation strategies. The protocol works across all of them.

### SDK injected by host

The `mup` global object is not a library the MUP imports — it is injected by the host at load time. MUPs have zero dependencies and don't need to track SDK versions. The host controls the SDK implementation, ensuring protocol compatibility.

---

## What We Intentionally Left Out

Each feature below was considered and deliberately excluded. The reasoning follows a single principle: **every protocol feature is a tax on all implementers.** A feature that helps 10% of MUPs but adds complexity to 100% of hosts is not worth including in the protocol.

| Feature | Why not | Workaround |
|---------|---------|------------|
| **Dynamic manifest** — add/remove functions at runtime | Forces every host to manage mid-conversation tool list updates and LLM re-synchronization. | Expose a generic function (e.g., `execute(command, args)`) whose description explains the available commands. |
| **Function cancellation** — abort a running call | Forces every MUP author to handle abort logic, partial state, and race conditions. | Functions run to completion. There is no way to cancel a single call while keeping the MUP alive — if a MUP must be stopped entirely, the host destroys its container via shutdown. |
| **Host capability query** — "do you support X?" | Requires a shared vocabulary of feature names that constrains how hosts extend. | Attempt the operation; handle the `-32601` (Method not found) error. |
| **Output schema** — declare what a function returns | Adds authoring burden to every function without clear benefit. The result format is already structured (typed content items); a per-function schema adds little beyond what the description provides. | Describe expected output in the function's `description`. |
| **Progress reporting** — intermediate updates during a call | Forces hosts to decide how and where to forward progress. | Use `updateState()` to update the visual UI during long operations. The function call stays simple: request in, response out. |
| **Binary transport** — avoid base64 overhead | Complicates the message layer. JSON-RPC 2.0 is simple, debuggable, and universal. | Use the `data` content type to carry any encoding you need. Base64 works for images; custom formats can be embedded as structured JSON. |
| **Streaming** — progressive data delivery in calls | Adds a new communication pattern with its own flow control and error handling. | Function arguments and results are typically small. For large data, the MUP should fetch independently (e.g., via HTTP). For MUP-to-host streaming, `updateState()` and `notifyInteraction()` already serve as push channels — return the function call quickly, then push updates via notifications. Host-to-LLM streaming is entirely the host's concern. |
| **MUP-to-MUP communication** — direct messaging | Creates dependency graphs between MUPs, breaking self-containment. | The LLM mediates. Hosts may offer cross-MUP communication as a host-specific extension. |

---

## Evaluating Future Changes

When considering a new protocol feature, apply these tests:

**1. Protocol tax.** Does this add work for all hosts, all MUPs, or both — even those that don't use it? If yes, the bar is very high.

**2. Freedom test.** Does adding this constrain how hosts or MUPs can be implemented? A capability registry constrains hosts to a fixed vocabulary. A cancellation mechanism constrains MUP authors to writing abort logic. Constraints compound.

**3. Workaround test.** Can the same goal be achieved with existing primitives? If a reasonable workaround exists, the protocol doesn't need the feature.

**4. Enum vs. mechanism.** Adding a new value to an existing enum (e.g., a new content type) is low-cost. Adding a new communication pattern or lifecycle phase is high-cost. Prefer the former.

Changes that pass all four tests — low tax, don't constrain freedom, can't be worked around, and are as small as an enum value — are good candidates. Everything else should be left to host-specific extensions.
