import { HostRuntime } from "./host/HostRuntime";
import { MockLLMAdapter } from "./llm/MockLLMAdapter";
import { OpenAIAdapter } from "./llm/OpenAIAdapter";
import type { LLMAdapter } from "./llm/LLMAdapter";
import hostCss from "./styles/host.css?inline";

function getEnvAdapter(): LLMAdapter | null {
  const key = import.meta.env.VITE_OPENAI_API_KEY;
  const model = import.meta.env.VITE_OPENAI_MODEL || "gpt-4o";
  if (key) return new OpenAIAdapter(key, model);
  return null;
}

function createSetupUI(): Promise<LLMAdapter> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    // Setup overlay lives outside Shadow DOM — inline all styles
    overlay.innerHTML = `
      <style>
        .setup-overlay { position:fixed;inset:0;background:#f5f5f5;display:flex;align-items:center;justify-content:center;z-index:2000;font-family:'Inter',-apple-system,sans-serif; }
        .setup-card { text-align:center;max-width:360px;width:100%;padding:48px 40px; }
        .setup-title { font-size:44px;font-weight:700;letter-spacing:-2px;color:#1a1a1a;margin-bottom:6px; }
        .setup-subtitle { font-size:13px;color:rgba(0,0,0,0.25);margin-bottom:36px;letter-spacing:0.5px; }
        .setup-options { display:flex;flex-direction:column;gap:10px;margin-bottom:16px; }
        .setup-btn { padding:13px 24px;border-radius:9999px;font-size:14px;font-weight:500;font-family:inherit;cursor:pointer;border:none; }
        .setup-btn:hover { opacity:0.85; }
        .setup-btn--primary { background:#1a1a1a;color:white; }
        .setup-btn--secondary { background:transparent;color:rgba(0,0,0,0.5);border:1.5px solid rgba(0,0,0,0.08); }
        .setup-apikey { display:flex;flex-direction:column;gap:10px;margin-top:20px; }
        .setup-input { background:#fff;border:1.5px solid rgba(0,0,0,0.08);color:#1a1a1a;padding:12px 14px;border-radius:9999px;font-size:14px;font-family:inherit;outline:none; }
        .setup-input:focus { border-color:rgba(0,0,0,0.2); }
        .setup-select { appearance:none;cursor:pointer; }
      </style>
      <div class="setup-overlay">
        <div class="setup-card">
          <h1 class="setup-title">Model UI Protocol</h1>
          <p class="setup-subtitle">MUP</p>
          <div class="setup-options">
            <button class="setup-btn setup-btn--primary" id="btn-openai">
              Connect OpenAI API
            </button>
            <button class="setup-btn setup-btn--secondary" id="btn-mock">
              Demo Mode (no API key)
            </button>
          </div>
          <div class="setup-apikey" id="apikey-section" style="display:none;">
            <input type="password" class="setup-input" id="apikey-input"
                   placeholder="sk-..." autocomplete="off" />
            <select class="setup-input setup-select" id="model-select">
              <option value="gpt-4o">GPT-4o</option>
              <option value="o4-mini">o4-mini</option>
              <option value="gpt-4.1">GPT-4.1</option>
            </select>
            <button class="setup-btn setup-btn--primary" id="btn-connect">
              Connect
            </button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById("btn-mock")!.addEventListener("click", () => {
      overlay.remove();
      resolve(new MockLLMAdapter());
    });

    document.getElementById("btn-openai")!.addEventListener("click", () => {
      document.getElementById("apikey-section")!.style.display = "flex";
      document.getElementById("apikey-input")!.focus();
    });

    document.getElementById("btn-connect")!.addEventListener("click", () => {
      const key = (document.getElementById("apikey-input") as HTMLInputElement).value.trim();
      const model = (document.getElementById("model-select") as HTMLSelectElement).value;
      if (!key) return;
      overlay.remove();
      resolve(new OpenAIAdapter(key, model));
    });

    document.getElementById("apikey-input")!.addEventListener("keydown", (e) => {
      if (e.key === "Enter") document.getElementById("btn-connect")!.click();
    });
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

  const welcomeMessage = "Welcome to the MUP demo! Drag and drop a .html MUP file to activate it, or try the built-in examples from the menu.";

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
