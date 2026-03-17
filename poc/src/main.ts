import { HostRuntime } from "./host/HostRuntime";
import { MockLLMAdapter } from "./llm/MockLLMAdapter";
import { OpenAIAdapter } from "./llm/OpenAIAdapter";
import { AnthropicAdapter } from "./llm/AnthropicAdapter";
import { GeminiAdapter } from "./llm/GeminiAdapter";
import { OllamaAdapter } from "./llm/OllamaAdapter";
import type { LLMAdapter } from "./llm/LLMAdapter";
import hostCss from "./styles/host.css?inline";

function getEnvAdapter(): LLMAdapter | null {
  // New unified env vars
  const provider = import.meta.env.VITE_LLM_PROVIDER as string | undefined;
  const key = import.meta.env.VITE_LLM_API_KEY as string | undefined;
  const model = import.meta.env.VITE_LLM_MODEL as string | undefined;

  if (provider) {
    switch (provider) {
      case "openai":
        if (key) return new OpenAIAdapter(key, model || "gpt-4o");
        break;
      case "anthropic":
        if (key) return new AnthropicAdapter(key, model || "claude-sonnet-4-6");
        break;
      case "gemini":
        if (key) return new GeminiAdapter(key, model || "gemini-2.5-flash");
        break;
      case "ollama":
        return new OllamaAdapter(
          import.meta.env.VITE_OLLAMA_ENDPOINT || "http://localhost:11434",
          model || "llama3"
        );
    }
  }

  // Backward compat: VITE_OPENAI_API_KEY still works
  const legacyKey = import.meta.env.VITE_OPENAI_API_KEY as string | undefined;
  const legacyModel = import.meta.env.VITE_OPENAI_MODEL as string | undefined;
  if (legacyKey) return new OpenAIAdapter(legacyKey, legacyModel || "gpt-4o");

  return null;
}

type ProviderConfig = {
  id: string;
  label: string;
  needsKey: boolean;
  keyPlaceholder: string;
  models: { value: string; label: string }[];
  freeformModel?: boolean;
  endpointInput?: boolean;
  endpointDefault?: string;
  create: (key: string, model: string, endpoint?: string) => LLMAdapter;
};

const PROVIDERS: ProviderConfig[] = [
  {
    id: "openai",
    label: "OpenAI",
    needsKey: true,
    keyPlaceholder: "sk-...",
    models: [
      { value: "gpt-4o", label: "GPT-4o" },
      { value: "o4-mini", label: "o4-mini" },
      { value: "gpt-4.1", label: "GPT-4.1" },
    ],
    create: (key, model) => new OpenAIAdapter(key, model),
  },
  {
    id: "anthropic",
    label: "Anthropic",
    needsKey: true,
    keyPlaceholder: "sk-ant-...",
    models: [
      { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
      { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
    ],
    create: (key, model) => new AnthropicAdapter(key, model),
  },
  {
    id: "gemini",
    label: "Google Gemini",
    needsKey: true,
    keyPlaceholder: "AIza...",
    models: [
      { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
      { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    ],
    create: (key, model) => new GeminiAdapter(key, model),
  },
  {
    id: "ollama",
    label: "Ollama (Local)",
    needsKey: false,
    keyPlaceholder: "",
    models: [],
    freeformModel: true,
    endpointInput: true,
    endpointDefault: "http://localhost:11434",
    create: (_key, model, endpoint) =>
      new OllamaAdapter(endpoint || "http://localhost:11434", model || "llama3"),
  },
];

function createSetupUI(): Promise<LLMAdapter> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.innerHTML = `
      <style>
        .setup-overlay { position:fixed;inset:0;background:#f5f5f5;display:flex;align-items:center;justify-content:center;z-index:2000;font-family:'Inter',-apple-system,sans-serif; }
        .setup-card { text-align:center;max-width:360px;width:100%;padding:48px 40px; }
        .setup-title { font-size:44px;font-weight:700;letter-spacing:-2px;color:#1a1a1a;margin-bottom:6px; }
        .setup-subtitle { font-size:13px;color:rgba(0,0,0,0.25);margin-bottom:36px;letter-spacing:0.5px; }
        .setup-options { display:flex;flex-direction:column;gap:10px;margin-bottom:16px; }
        .setup-btn { padding:13px 24px;border-radius:9999px;font-size:14px;font-weight:500;font-family:inherit;cursor:pointer;border:none;transition:opacity 0.15s; }
        .setup-btn:hover { opacity:0.85; }
        .setup-btn--primary { background:#1a1a1a;color:white; }
        .setup-btn--secondary { background:transparent;color:rgba(0,0,0,0.5);border:1.5px solid rgba(0,0,0,0.08); }
        .setup-form { display:flex;flex-direction:column;gap:10px;margin-top:20px; }
        .setup-input { background:#fff;border:1.5px solid rgba(0,0,0,0.08);color:#1a1a1a;padding:12px 14px;border-radius:9999px;font-size:14px;font-family:inherit;outline:none; }
        .setup-input:focus { border-color:rgba(0,0,0,0.2); }
        .setup-select { appearance:none;cursor:pointer; }
      </style>
      <div class="setup-overlay">
        <div class="setup-card">
          <h1 class="setup-title">Model UI Protocol</h1>
          <p class="setup-subtitle">MUP</p>
          <div class="setup-options" id="provider-buttons"></div>
          <div class="setup-form" id="provider-form" style="display:none;"></div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const buttonsEl = overlay.querySelector("#provider-buttons")!;
    const formEl = overlay.querySelector("#provider-form")! as HTMLElement;

    // Demo mode button
    const demoBtn = document.createElement("button");
    demoBtn.className = "setup-btn setup-btn--secondary";
    demoBtn.textContent = "Demo Mode (no API key)";
    demoBtn.addEventListener("click", () => {
      overlay.remove();
      resolve(new MockLLMAdapter());
    });

    // Provider buttons
    for (const provider of PROVIDERS) {
      const btn = document.createElement("button");
      btn.className = "setup-btn setup-btn--primary";
      btn.textContent = provider.label;
      btn.addEventListener("click", () => showProviderForm(provider));
      buttonsEl.appendChild(btn);
    }
    buttonsEl.appendChild(demoBtn);

    function showProviderForm(provider: ProviderConfig) {
      formEl.innerHTML = "";
      formEl.style.display = "flex";

      // API key input
      if (provider.needsKey) {
        const keyInput = document.createElement("input");
        keyInput.type = "password";
        keyInput.className = "setup-input";
        keyInput.id = "setup-key";
        keyInput.placeholder = provider.keyPlaceholder;
        keyInput.autocomplete = "off";
        formEl.appendChild(keyInput);
      }

      // Endpoint input (Ollama)
      if (provider.endpointInput) {
        const endpointInput = document.createElement("input");
        endpointInput.type = "text";
        endpointInput.className = "setup-input";
        endpointInput.id = "setup-endpoint";
        endpointInput.placeholder = provider.endpointDefault || "";
        endpointInput.value = provider.endpointDefault || "";
        formEl.appendChild(endpointInput);
      }

      // Model selector
      if (provider.freeformModel) {
        const modelInput = document.createElement("input");
        modelInput.type = "text";
        modelInput.className = "setup-input";
        modelInput.id = "setup-model";
        modelInput.placeholder = "Model name (e.g. llama3)";
        modelInput.value = "llama3";
        formEl.appendChild(modelInput);
      } else if (provider.models.length > 0) {
        const select = document.createElement("select");
        select.className = "setup-input setup-select";
        select.id = "setup-model";
        for (const m of provider.models) {
          const opt = document.createElement("option");
          opt.value = m.value;
          opt.textContent = m.label;
          select.appendChild(opt);
        }
        formEl.appendChild(select);
      }

      // Connect button
      const connectBtn = document.createElement("button");
      connectBtn.className = "setup-btn setup-btn--primary";
      connectBtn.textContent = "Connect";
      connectBtn.addEventListener("click", () => {
        const key =
          (document.getElementById("setup-key") as HTMLInputElement | null)
            ?.value.trim() ?? "";
        const model =
          (
            document.getElementById("setup-model") as
              | HTMLInputElement
              | HTMLSelectElement
              | null
          )?.value ?? "";
        const endpoint =
          (document.getElementById("setup-endpoint") as HTMLInputElement | null)
            ?.value.trim() ?? undefined;

        if (provider.needsKey && !key) return;
        overlay.remove();
        resolve(provider.create(key, model, endpoint));
      });
      formEl.appendChild(connectBtn);

      // Enter key support
      formEl.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter") connectBtn.click();
      });

      // Focus first input
      const firstInput = formEl.querySelector("input");
      if (firstInput) firstInput.focus();
    }
  });
}

async function main() {
  const envAdapter = getEnvAdapter();
  const llm = envAdapter || (await createSetupUI());
  // Create Shadow DOM for style isolation
  const hostEl = document.getElementById("mup-host")!;
  const shadow = hostEl.attachShadow({ mode: "open" });

  // Inject CSS into shadow (scoped — cannot leak out)
  const style = document.createElement("style");
  style.textContent = hostCss;
  shadow.appendChild(style);

  // Build DOM inside shadow
  const app = document.createElement("div");
  app.id = "app";
  const chatContainer = document.createElement("div");
  chatContainer.id = "chat";
  const gridContainer = document.createElement("div");
  gridContainer.id = "mup-grid";
  app.appendChild(chatContainer);
  app.appendChild(gridContainer);
  shadow.appendChild(app);

  const runtime = new HostRuntime(chatContainer, gridContainer, llm, app);

  const welcomeMessage =
    "Welcome to the MUP demo! Drag and drop a .html MUP file to activate it, or try the built-in examples from the menu.";

  const showWelcome = () => {
    runtime.getChatPanel().addMessage({
      role: "assistant",
      content: welcomeMessage,
      timestamp: Date.now(),
    });
  };

  showWelcome();
  runtime.getChatPanel().onReset(showWelcome);
}

main();
