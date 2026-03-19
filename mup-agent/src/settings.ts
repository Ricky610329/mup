import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export interface AgentSettings {
  provider: string;
  model: string;
  apiKey: string;
  systemPromptPrefix: string; // user-defined prefix added before auto-generated prompt
}

const SETTINGS_PATH = path.join(os.homedir(), ".mup-agent", "settings.json");

const DEFAULTS: AgentSettings = {
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  apiKey: "",
  systemPromptPrefix: "",
};

export function loadSettings(): AgentSettings {
  try {
    fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
    if (fs.existsSync(SETTINGS_PATH)) {
      const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf-8"));
      return { ...DEFAULTS, ...raw };
    }
  } catch {}
  return { ...DEFAULTS };
}

export function saveSettings(settings: AgentSettings): void {
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), "utf-8");
}
