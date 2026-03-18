// Content script: silently bridges LLM chat ↔ MUP extension
// Detects MUP calls in LLM output, executes them, no visible text injected

(() => {
  let currentMups = [];
  let pendingCalls = new Map();
  let callIdCounter = 0;
  let observer = null;
  const processedBlocks = new WeakSet();

  // Guard: stop everything if extension context is invalidated (after reload)
  function isContextValid() {
    try { return !!chrome.runtime.id; } catch { return false; }
  }

  const site = location.hostname.includes("chatgpt") || location.hostname.includes("chat.openai")
    ? "chatgpt"
    : location.hostname.includes("claude")
      ? "claude"
      : location.hostname.includes("gemini")
        ? "gemini"
        : "unknown";

  // ---- Messages from service worker ----
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "mups-updated") {
      currentMups = msg.mups || [];
    }

    if (msg.type === "inject-prompt") {
      if (currentMups.length > 0) {
        injectSystemPrompt();
      }
    }

    if (msg.type === "function-result") {
      const pending = pendingCalls.get(msg.callId);
      if (pending) {
        pendingCalls.delete(msg.callId);
        pending.resolve(msg.result);
      }
    }
  });

  // Get current MUPs on load
  chrome.runtime.sendMessage({ type: "get-mups" }, (response) => {
    if (response && response.mups && response.mups.length > 0) {
      currentMups = response.mups;
    }
  });

  // ---- Context injection: silently prepend MUP info to user's first message ----
  let contextSent = false;
  let lastUrl = location.href;

  // Reset when navigating to a new conversation
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      contextSent = false;
    }
  }, 1000);

  function formatParams(schema) {
    if (!schema || !schema.properties) return "";
    return Object.entries(schema.properties)
      .map(([key, val]) => key + ": " + (val.type || "any"))
      .join(", ");
  }

  function buildMupContext() {
    const tools = currentMups.map((m) => {
      const fns = (m.manifest.functions || [])
        .map((fn) => m.manifest.name + "." + fn.name + "(" + formatParams(fn.inputSchema) + ") — " + fn.description)
        .join("\n");
      return m.manifest.name + " — " + m.manifest.description + "\n" + fns;
    }).join("\n\n");

    return "[System: Interactive UI panels are available. " +
      "To call a function, reply with a fenced code block (language: mup) containing JSON: " +
      '{"fn": "Name.function", "args": {...}}. ' +
      "Available panels:\n" + tools + "]";
  }

  // Resync from panel button — reset so next message re-includes context
  function injectSystemPrompt() {
    contextSent = false;
  }

  function getActiveEditor() {
    if (site === "chatgpt") {
      return document.querySelector("#prompt-textarea") ||
             document.querySelector('div[contenteditable="true"]');
    }
    if (site === "claude") {
      return document.querySelector("div.ProseMirror[contenteditable]") ||
             document.querySelector('[contenteditable="true"]');
    }
    if (site === "gemini") {
      // Gemini: contenteditable is a light DOM descendant of rich-textarea
      // (confirmed by Gemini Voyager extension source)
      return document.querySelector('rich-textarea [contenteditable="true"]') ||
             document.querySelector('div[contenteditable="true"][role="textbox"]') ||
             document.querySelector("textarea");
    }
    return null;
  }

  // Prepend context to the editor content right before send.
  function maybeInjectContext() {
    if (currentMups.length === 0 || contextSent) return false;

    const editor = getActiveEditor();
    if (!editor) return false;

    const userText = (editor.innerText || editor.textContent || "").trim();
    if (!userText) return false;

    // Check if text is just placeholder
    const placeholder = editor.getAttribute("data-placeholder") ||
                        editor.getAttribute("aria-placeholder") || "";
    if (placeholder && userText === placeholder.trim()) return false;

    const context = buildMupContext();
    const combined = context + "\n\n" + userText;

    // Same approach for all sites: focus, select all, replace via execCommand
    editor.focus();

    // Position cursor to select all content
    const sel = window.getSelection();
    if (sel) {
      const range = document.createRange();
      range.selectNodeContents(editor);
      sel.removeAllRanges();
      sel.addRange(range);
    }

    document.execCommand("insertText", false, combined);

    contextSent = true;
    return true;
  }

  // Hook Enter key — modify text but DO NOT block it.
  // The original Enter event continues to propagate and the platform sends the modified text.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
    maybeInjectContext();
    // Don't preventDefault — let Enter propagate normally
  }, true);

  // Hook send button click — same logic, modify text before click propagates
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    // Check if it looks like a send button
    const isSend =
      btn.matches('[data-testid="send-button"]') ||
      btn.matches('[aria-label*="Send"]') ||
      btn.matches('[aria-label*="送出"]') ||
      btn.matches('[aria-label*="傳送"]') ||
      btn.closest("form") && btn.matches('[type="submit"]');
    if (!isSend) return;
    maybeInjectContext();
    // Don't preventDefault — let click propagate normally
  }, true);

  // ---- Type into chat input ----
  function typeIntoChat(text) {
    if (site === "chatgpt") return typeIntoChatGPT(text);
    if (site === "claude") return typeIntoClaude(text);
    if (site === "gemini") return typeIntoGemini(text);
    return false;
  }

  function insertViaExecCommand(editor, text) {
    editor.focus();
    const sel = window.getSelection();
    sel.selectAllChildren(editor);
    document.execCommand("insertText", false, text);
    return true;
  }

  function typeIntoChatGPT(text) {
    const editor =
      document.querySelector("#prompt-textarea") ||
      document.querySelector('div[contenteditable="true"]') ||
      document.querySelector("textarea");
    if (!editor) return false;

    if (editor.isContentEditable) return insertViaExecCommand(editor, text);

    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(editor, text);
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }

  function typeIntoClaude(text) {
    const editor =
      document.querySelector("div.ProseMirror[contenteditable]") ||
      document.querySelector("fieldset [contenteditable='true']") ||
      document.querySelector('[contenteditable="true"]');
    if (!editor) return false;
    return insertViaExecCommand(editor, text);
  }

  function typeIntoGemini(text) {
    // Gemini: contenteditable is light DOM descendant of rich-textarea
    const editor =
      document.querySelector('rich-textarea [contenteditable="true"]') ||
      document.querySelector('div[contenteditable="true"][role="textbox"]') ||
      document.querySelector("textarea");
    if (!editor) {
      console.warn("[MUP] Gemini input not found");
      return false;
    }
    if (editor.isContentEditable) return insertViaExecCommand(editor, text);
    editor.value = text;
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }

  // ---- Send button (for auto-sending results back to LLM) ----
  function clickSendButton() {
    if (site === "chatgpt") {
      const btn = document.querySelector('button[data-testid="send-button"]') ||
                  document.querySelector('button[aria-label="Send prompt"]');
      if (btn) { btn.click(); return; }
    }
    if (site === "gemini") {
      const btn = document.querySelector('.send-button') ||
                  document.querySelector('button[aria-label*="Send"]') ||
                  document.querySelector('button[aria-label*="送出"]');
      if (btn) { btn.click(); return; }
    }
    if (site === "claude") {
      const btn = document.querySelector('button[aria-label="Send Message"]');
      if (btn) { btn.click(); return; }
    }
    // Fallback: Enter key on the active editor
    const editor = getActiveEditor();
    if (editor) {
      editor.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter", code: "Enter", keyCode: 13, bubbles: true,
      }));
    }
  }

  // ---- Detect MUP calls in LLM output ----
  function startObserving() {
    const target = document.querySelector("main") || document.body;
    observer = new MutationObserver(() => scanAllCodeBlocks());
    observer.observe(target, { childList: true, subtree: true });
    setInterval(scanAllCodeBlocks, 2000);
  }

  // Extract multiple JSON objects from a string, even without newline separators.
  // Uses brace-counting to find each complete {...} object containing "fn".
  function extractJsonObjects(text) {
    const results = [];
    let i = 0;
    while (i < text.length) {
      const start = text.indexOf("{", i);
      if (start === -1) break;
      // Count braces to find matching close
      let depth = 0;
      let j = start;
      while (j < text.length) {
        if (text[j] === "{") depth++;
        else if (text[j] === "}") { depth--; if (depth === 0) break; }
        // Skip string contents to avoid counting braces inside strings
        else if (text[j] === '"') {
          j++;
          while (j < text.length && text[j] !== '"') {
            if (text[j] === "\\") j++; // skip escaped char
            j++;
          }
        }
        j++;
      }
      if (depth === 0 && j < text.length) {
        const jsonStr = text.slice(start, j + 1);
        try {
          const obj = JSON.parse(jsonStr);
          if (obj.fn) results.push(obj);
        } catch {
          // not valid JSON, skip
        }
      }
      i = (depth === 0 ? j : start) + 1;
    }
    return results;
  }

  function scanAllCodeBlocks() {
    if (!isContextValid()) {
      if (observer) { observer.disconnect(); observer = null; }
      return;
    }
    // Collect code block containers across platforms:
    // ChatGPT: <pre> with .cm-content or <code>
    // Claude:  <pre><code class="language-mup">
    // Gemini:  <code-block> with <code role="text"> and .code-block-decoration
    //          (ref: Nagi-ovo/gemini-voyager DOMContentExtractor)
    const containers = new Set();
    document.querySelectorAll("pre").forEach((el) => containers.add(el));
    document.querySelectorAll("code-block").forEach((el) => containers.add(el));

    containers.forEach((block) => {
      if (processedBlocks.has(block)) return;

      // Find the actual code content element
      const contentEl =
        block.querySelector('code[role="text"]') ||  // Gemini
        block.querySelector(".cm-content") ||         // ChatGPT
        block.querySelector("code") ||                // Claude/generic
        block;

      const raw = (contentEl.innerText || contentEl.textContent || "").trim();
      if (!raw || !raw.includes('"fn"')) return;

      const idx = raw.indexOf("{");
      if (idx === -1) return;
      const jsonText = raw.slice(idx);
      const pre = block;

      // Extract all JSON objects from the text (handles single, multi-line, or concatenated)
      const calls = extractJsonObjects(jsonText);
      if (calls.length > 0) {
        processedBlocks.add(pre);
        for (const call of calls) {
          executeMupCall(call, pre);
        }
      }
    });
  }

  async function executeMupCall(call, el) {
    const dotIdx = call.fn.indexOf(".");
    if (dotIdx === -1) return;

    const mupName = call.fn.substring(0, dotIdx).toLowerCase().replace(/\s+/g, "_");
    const fnName = call.fn.substring(dotIdx + 1);

    const mup = currentMups.find(
      (m) =>
        m.manifest.name.toLowerCase().replace(/\s+/g, "_") === mupName ||
        m.mupId.toLowerCase() === mupName
    );
    if (!mup) return;

    // Subtle visual feedback on the code block
    const pre = el.closest("pre") || el;
    pre.style.borderLeft = "3px solid #34c759";
    pre.style.transition = "border-color 0.3s";

    const callId = "ext-" + (++callIdCounter);

    const result = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingCalls.delete(callId);
        resolve({ content: [{ type: "text", text: "Timeout" }], isError: true });
      }, 30000);

      pendingCalls.set(callId, {
        resolve: (r) => { clearTimeout(timer); resolve(r); },
      });

      chrome.runtime.sendMessage({
        type: "call-function",
        callId,
        mupId: mup.mupId,
        fn: fnName,
        args: call.args || {},
      });
    });

    // Visual feedback
    pre.style.borderLeft = result.isError
      ? "3px solid #ef4444"
      : "3px solid #34c759";

    // Send result back to LLM so it can act on the data
    const resultText = (result.content || [])
      .map((c) => {
        if (c.type === "text") return c.text;
        if (c.type === "data") return JSON.stringify(c.data);
        if (c.type === "image") return "[Image captured — see panel]";
        return "";
      })
      .filter(Boolean)
      .join("\n");

    if (resultText) {
      const msg = "[MUP " + call.fn + " result] " + resultText;
      typeIntoChat(msg);
      setTimeout(() => clickSendButton(), 200);
    }
  }

  // ---- Init ----
  startObserving();
})();
