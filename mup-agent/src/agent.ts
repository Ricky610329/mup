import { Agent } from "@mariozechner/pi-agent-core";
import type {
  AgentTool,
  AgentToolResult,
  AgentEvent,
  AgentMessage,
} from "@mariozechner/pi-agent-core";
import * as fs from "node:fs";
import * as path from "node:path";
import { getModel, getEnvApiKey } from "@mariozechner/pi-ai";
import type { Model, KnownProvider } from "@mariozechner/pi-ai";
import { loadSettings, saveSettings, type AgentSettings } from "./settings.js";
import { Type, type TSchema } from "@sinclair/typebox";
import type { MupManager } from "./manager.js";
import type { UiBridge } from "./bridge.js";
import type { TreeNode } from "./types.js";
import { setupSessionHandler } from "./session-handler.js";

// ---- Tool building ----

/** Build AgentTools from loaded MUPs, routing execution through the browser bridge */
export function buildMupTools(
  manager: MupManager,
  bridge: UiBridge
): AgentTool<TSchema, unknown>[] {
  return manager.getToolDefinitions().map((def): AgentTool<TSchema, unknown> => ({
    name: def.name,
    label: def.description.split("]")[0].slice(1) || def.name,
    description: def.description,
    parameters: Type.Unsafe(def.inputSchema) as TSchema,
    async execute(
      _toolCallId: string,
      params: unknown,
      _signal?: AbortSignal,
    ): Promise<AgentToolResult<unknown>> {
      const args = (params ?? {}) as Record<string, unknown>;
      const parsed = manager.parseToolName(def.name);
      if (!parsed) {
        return { content: [{ type: "text", text: `Unknown tool: ${def.name}` }], details: null };
      }

      const result = await bridge.callFunction(parsed.mupId, parsed.functionName, args);

      const content = result.content.map(
        (c: { type: string; text?: string; data?: unknown }) => {
          if (c.type === "text") return { type: "text" as const, text: c.text || "" };
          if (c.type === "data") return { type: "text" as const, text: JSON.stringify(c.data) };
          return { type: "text" as const, text: String(c) };
        }
      );

      // Append pending user interactions
      const events = manager.drainEvents();
      if (events.length > 0) {
        content.push({
          type: "text" as const,
          text: `\n--- Recent user interactions ---\n${events.map(e => `[${e.mupName}] ${e.summary}`).join("\n")}`,
        });
      }

      return { content, details: result };
    },
  }));
}

// ---- System prompt ----

export function buildSystemPrompt(manager: MupManager): string {
  const active = manager.getAll();
  const catalog = manager.getCatalog();
  const inactive = catalog.filter(e => !e.active);

  let prompt = `You are an AI assistant with interactive UI panels (MUPs).\n`;

  if (active.length > 0) {
    const list = active.map(m => {
      const state = m.stateSummary ? ` — ${m.stateSummary}` : "";
      return `- ${m.manifest.name}${state}`;
    }).join("\n");
    prompt += `\nActive panels:\n${list}\n`;
  }

  if (inactive.length > 0) {
    const list = inactive.map(e =>
      `- ${e.manifest.name} [id: ${e.manifest.id}]: ${e.manifest.description}`
    ).join("\n");
    prompt += `\nAvailable (call activateMup to open):\n${list}\n`;
  }

  if (active.length === 0 && inactive.length === 0) {
    prompt += `\nNo panels available. User can load MUPs from the Manager card.\n`;
  }

  prompt += `\nIMPORTANT: Always use tools to perform actions. Do NOT describe what you would do — actually do it by calling the functions. For example, if the user asks for a presentation, call activateMup then createPresentation with the actual slide data. Never output slide content as text.`;
  return prompt;
}

// ---- Model resolution ----

export function resolveModel(provider: string, modelId: string, apiKey?: string): Model<any> {
  if (apiKey) {
    const envMap: Record<string, string> = {
      anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY",
      google: "GOOGLE_API_KEY", groq: "GROQ_API_KEY", xai: "XAI_API_KEY",
    };
    const envVar = envMap[provider];
    if (envVar) process.env[envVar] = apiKey;
  }
  return getModel(provider as any, modelId as any);
}

// ---- Agent creation ----

export interface MupAgentOptions {
  manager: MupManager;
  bridge: UiBridge;
  provider: string;
  modelId: string;
  apiKey?: string;
}

export function createMupAgent(opts: MupAgentOptions): Agent {
  const { manager, bridge, provider, modelId } = opts;
  let apiKey = opts.apiKey;

  const model = resolveModel(provider, modelId, apiKey);
  const tools = buildMupTools(manager, bridge);

  // Built-in tool: let LLM activate MUPs
  const activateMupTool: AgentTool<TSchema, unknown> = {
    name: "activateMup",
    label: "Activate MUP",
    description: "Open a MUP panel by its ID. Use this to activate panels the user needs for their task.",
    parameters: Type.Object({
      mupId: Type.String({ description: "The MUP ID to activate (from the Available list in system prompt)" }),
    }) as TSchema,
    async execute(_id: string, params: unknown): Promise<AgentToolResult<unknown>> {
      const { mupId } = params as { mupId: string };
      if (manager.isActive(mupId)) {
        return { content: [{ type: "text", text: `${mupId} is already active.` }], details: null };
      }
      const name = doActivateMup(mupId);
      if (!name) {
        return { content: [{ type: "text", text: `MUP not found: ${mupId}` }], details: null };
      }
      return { content: [{ type: "text", text: `Activated ${name}. Its functions are now available.` }], details: null };
    },
  };

  const allTools = [...tools, activateMupTool];

  const agent = new Agent({
    initialState: { systemPrompt: buildSystemPrompt(manager), model, tools: allTools },
    transformContext: async (messages: AgentMessage[]) => {
      // 1. Refresh system prompt with latest MUP states
      agent.setSystemPrompt(buildSystemPrompt(manager));

      // 2. Strip thinking blocks — o4-mini returns them but they break subsequent turns
      let result = messages.map((m) => {
        const msg = m as any;
        if (msg.role === "assistant" && Array.isArray(msg.content)) {
          return { ...msg, content: msg.content.filter((c: any) => c.type !== "thinking") };
        }
        return m;
      });

      // 3. Prune if context is too large (rough estimate: chars/4 ≈ tokens)
      result = pruneContext(result, MAX_CONTEXT_TOKENS);

      return result;
    },
    getApiKey: (p: string) => apiKey || getEnvApiKey(p as KnownProvider),
    steeringMode: "all",
    toolExecution: "sequential",
    afterToolCall: async () => {
      toolCallCount++;
      if (toolCallCount > MAX_TOOL_CALLS) {
        console.error(`[mup-agent] Max tool calls (${MAX_TOOL_CALLS}) reached`);
        return { content: [{ type: "text" as const, text: "Maximum tool call limit reached." }], isError: true };
      }
      return undefined;
    },
  });

  const MAX_TOOL_CALLS = 20;
  let toolCallCount = 0;
  let wasStreaming = false;

  // ---- Event forwarding to browser ----

  agent.subscribe((event: AgentEvent) => {
    if (event.type === "agent_start") toolCallCount = 0;
    if (event.type === "message_start") wasStreaming = false;
  });

  agent.subscribe((event: AgentEvent) => {
    switch (event.type) {
      case "agent_start":
        bridge.sendChat({ type: "chat-loading", loading: true });
        break;
      case "agent_end":
        bridge.sendChat({ type: "chat-loading", loading: false });
        break;
      case "message_update": {
        const aEvent = event.assistantMessageEvent;
        if (aEvent.type === "text_delta") {
          wasStreaming = true;
          bridge.sendChat({ type: "chat-delta", delta: aEvent.delta });
        }
        break;
      }
      case "message_end": {
        const msg = event.message as any;
        if (msg.role === "assistant" && msg.content) {
          const arr = Array.isArray(msg.content) ? msg.content : [msg.content];
          const text = arr.filter((c: any) => typeof c === "string" || c.type === "text")
            .map((c: any) => typeof c === "string" ? c : c.text).join("");
          if (text && !wasStreaming) {
            bridge.sendChat({ type: "chat-message", role: "assistant", content: text });
          }
          if (wasStreaming) {
            bridge.sendChat({ type: "chat-stream-end" });
            wasStreaming = false;
          }
        }
        break;
      }
      case "tool_execution_start":
        bridge.sendChat({ type: "chat-tool-call", toolName: event.toolName, status: "start" });
        break;
      case "tool_execution_end":
        bridge.sendChat({ type: "chat-tool-call", toolName: event.toolName, status: "end" });
        break;
    }
  });

  // ---- Helper: rebuild tools + system prompt after MUP changes ----

  function refreshAgentTools() {
    agent.setTools([...buildMupTools(manager, bridge), activateMupTool]);
    agent.setSystemPrompt(buildSystemPrompt(manager));
  }

  // Shared activate logic (used by both LLM tool and browser UI)
  function doActivateMup(mupId: string): string | null {
    if (manager.isActive(mupId)) return null;
    const loaded = manager.activate(mupId);
    if (!loaded) return null;
    bridge.sendRaw({ type: "load-mup", mupId: loaded.manifest.id, html: loaded.html, manifest: loaded.manifest });
    refreshAgentTools();
    return loaded.manifest.name;
  }

  // ---- MUP interaction ----
  // "discuss" triggers agent immediately; other interactions are ignored when idle
  bridge.on("interaction", (_mupId: string, _action: string, summary: string) => {
    const name = manager.get(_mupId)?.manifest.name ?? _mupId;
    const content = `[${name}] User: ${summary}`;

    if (_action === "discuss") {
      agent.prompt({ role: "user", content, timestamp: Date.now() } as AgentMessage).catch(() => {});
    } else if (agent.state.isStreaming) {
      agent.steer({ role: "user", content, timestamp: Date.now() } as AgentMessage);
    }
    // Other interactions when idle: ignored (user must chat to trigger agent)
  });

  // ---- Chat ----

  bridge.on("user-message", async (text: string) => {
    if (!text.trim()) return;
    try {
      await agent.prompt(text);
    } catch (err) {
      bridge.sendChat({ type: "chat-message", role: "system", content: `Error: ${(err as Error).message}` });
    }
  });

  bridge.on("user-reset", () => {
    agent.clearMessages();
    agent.clearAllQueues();
  });

  // ---- MUP activation (from browser UI) ----

  bridge.on("activate-mup", (mupId: string) => doActivateMup(mupId));

  bridge.on("deactivate-mup", (mupId: string) => {
    manager.deactivate(mupId);
    refreshAgentTools();
  });

  bridge.on("register-and-activate", (mupId: string, html: string, fileName: string) => {
    try {
      manager.loadFromHtml(html, fileName);
      // loadFromHtml already activates it, so send load-mup directly
      const loaded = manager.get(mupId);
      if (loaded) {
        bridge.sendRaw({ type: "load-mup", mupId: loaded.manifest.id, html: loaded.html, manifest: loaded.manifest });
        refreshAgentTools();
      }
    } catch (err) {
      console.error(`[mup-agent] Failed to register: ${(err as Error).message}`);
    }
  });

  // ---- System requests from MUPs ----

  bridge.on("system-request", async (mupId: string, requestId: string, action: string, params: any) => {
    try {
      let result: unknown;
      switch (action) {
        case "webSearch":
          result = await webSearch(params?.query || "");
          break;
        case "fetchUrl":
          result = await fetchUrl(params?.url || "", params?.maxBytes);
          break;
        default:
          bridge.sendRaw({ type: "system-response", requestId, error: `Unknown system action: ${action}` });
          return;
      }
      bridge.sendRaw({ type: "system-response", requestId, result });
    } catch (err) {
      bridge.sendRaw({ type: "system-response", requestId, error: (err as Error).message });
    }
  });

  // ---- Folder scanning ----

  bridge.on("scan-folder", (folderPath: string) => {
    try {
      const resolved = path.resolve(folderPath);
      if (!fs.existsSync(resolved)) {
        bridge.sendRaw({ type: "folder-contents", path: resolved, tree: [], error: "Folder not found" });
        return;
      }
      const tree = scanDir(resolved, manager);
      const catalog = manager.getCatalog().map(e => ({
        id: e.manifest.id, name: e.manifest.name, description: e.manifest.description,
        functions: e.manifest.functions.length, active: e.active, grid: e.manifest.grid,
      }));
      bridge.sendRaw({ type: "folder-contents", path: resolved, tree });
      bridge.sendRaw({ type: "mup-catalog", catalog });
    } catch (err) {
      bridge.sendRaw({ type: "folder-contents", path: folderPath, tree: [], error: (err as Error).message });
    }
  });

  // ---- Settings ----

  bridge.on("get-settings", () => {
    const settings = loadSettings();
    settings.provider = model.provider;
    settings.model = model.name;
    if (apiKey) settings.apiKey = apiKey;
    bridge.sendRaw({ type: "settings", settings });
  });

  bridge.on("update-settings", (newSettings: any) => {
    const settings = newSettings as AgentSettings;
    saveSettings(settings);
    try {
      const newModel = resolveModel(settings.provider, settings.model, settings.apiKey);
      agent.setModel(newModel);
      if (settings.apiKey) apiKey = settings.apiKey;
      console.error(`[mup-agent] Settings updated: ${settings.provider}/${settings.model}`);
      bridge.sendRaw({ type: "settings-saved", success: true });
    } catch (err) {
      bridge.sendRaw({ type: "settings-saved", success: false, error: (err as Error).message });
    }
  });

  // ---- Session management (delegated) ----

  setupSessionHandler({
    agent, manager, bridge, model,
    getApiKey: () => apiKey || getEnvApiKey(model.provider as KnownProvider),
  });

  return agent;
}

// ---- Web search (DuckDuckGo HTML scrape, no API key) ----

async function webSearch(query: string): Promise<{ results: Array<{ title: string; url: string; description: string }> }> {
  if (!query.trim()) return { results: [] };

  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const resp = await fetch(url, {
    headers: { "User-Agent": "MUP-Agent/0.1" },
  });
  const html = await resp.text();

  const results: Array<{ title: string; url: string; description: string }> = [];
  // Parse DuckDuckGo HTML results
  const resultBlocks = html.split('class="result__body"');
  for (let i = 1; i < resultBlocks.length && results.length < 8; i++) {
    const block = resultBlocks[i];
    const titleMatch = block.match(/class="result__a"[^>]*>([^<]+)</);
    const urlMatch = block.match(/class="result__url"[^>]*href="([^"]*)"/) || block.match(/class="result__a"[^>]*href="([^"]*)"/);
    const descMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\//);

    if (titleMatch) {
      let href = urlMatch?.[1] || "";
      // DuckDuckGo wraps URLs in redirect
      const uddg = href.match(/uddg=([^&]+)/);
      if (uddg) href = decodeURIComponent(uddg[1]);

      results.push({
        title: titleMatch[1].trim(),
        url: href,
        description: (descMatch?.[1] || "").replace(/<[^>]+>/g, "").trim(),
      });
    }
  }

  return { results };
}

async function fetchUrl(url: string, maxBytes?: number): Promise<any> {
  if (!url) throw new Error("URL required");
  const resp = await fetch(url, {
    headers: { "User-Agent": "MUP-Agent/0.1" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);

  const contentType = resp.headers.get("content-type") || "";
  const isText = contentType.includes("text") || contentType.includes("json") || contentType.includes("csv") || contentType.includes("xml");

  if (isText) {
    let text = await resp.text();
    const max = maxBytes || 100_000;
    const truncated = text.length > max;
    if (truncated) text = text.slice(0, max);
    return { content: text, contentType, size: text.length, truncated };
  } else {
    // Binary: return metadata (browser-side workspace handles saving)
    const buffer = Buffer.from(await resp.arrayBuffer());
    return { content: buffer.toString("base64"), contentType, size: buffer.length, encoding: "base64" };
  }
}

// ---- Context pruning ----

const MAX_CONTEXT_TOKENS = 80_000; // conservative limit for most models
const KEEP_RECENT_MESSAGES = 10; // always keep the last N messages

function estimateTokens(messages: AgentMessage[]): number {
  let chars = 0;
  for (const m of messages) {
    const msg = m as any;
    if (typeof msg.content === "string") {
      chars += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (const c of msg.content) {
        if (c.text) chars += c.text.length;
        if (c.arguments) chars += JSON.stringify(c.arguments).length;
      }
    }
  }
  return Math.ceil(chars / 4); // rough token estimate
}

function pruneContext(messages: AgentMessage[], maxTokens: number): AgentMessage[] {
  const tokens = estimateTokens(messages);
  if (tokens <= maxTokens) return messages;

  // Keep the last KEEP_RECENT_MESSAGES, drop from the front
  if (messages.length <= KEEP_RECENT_MESSAGES) return messages;

  // Binary search: find how many messages from the end fit within budget
  let keep = KEEP_RECENT_MESSAGES;
  while (keep < messages.length) {
    const tail = messages.slice(-keep);
    if (estimateTokens(tail) > maxTokens) break;
    keep++;
  }
  keep = Math.max(KEEP_RECENT_MESSAGES, keep - 1);

  const pruned = messages.slice(-keep);
  console.error(`[mup-agent] Context pruned: ${messages.length} → ${pruned.length} messages (est. ${estimateTokens(pruned)} tokens)`);
  return pruned;
}

// ---- Helpers ----

function scanDir(dir: string, manager: MupManager): TreeNode[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const items: TreeNode[] = [];
  for (const e of entries) {
    if (e.isDirectory() && !e.name.startsWith(".")) {
      const children = scanDir(path.join(dir, e.name), manager);
      if (children.length > 0) items.push({ type: "folder", name: e.name, children });
    }
  }
  for (const e of entries) {
    if (e.isFile() && e.name.endsWith(".html")) {
      try {
        const manifest = manager.scanFile(path.join(dir, e.name));
        items.push({ type: "file", name: e.name, id: manifest.id, valid: true, manifestName: manifest.name, functions: manifest.functions.length, active: manager.isActive(manifest.id) });
      } catch (err) {
        items.push({ type: "file", name: e.name, id: null, valid: false, error: (err as Error).message });
      }
    }
  }
  return items;
}
