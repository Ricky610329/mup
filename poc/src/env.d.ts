/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Primary env vars
  readonly VITE_LLM_PROVIDER?: "openai" | "anthropic" | "gemini" | "ollama";
  readonly VITE_LLM_API_KEY?: string;
  readonly VITE_LLM_MODEL?: string;
  readonly VITE_OLLAMA_ENDPOINT?: string;
  // Legacy (backward compat)
  readonly VITE_OPENAI_API_KEY?: string;
  readonly VITE_OPENAI_MODEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
