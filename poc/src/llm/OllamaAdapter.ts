import { OpenAICompatibleAdapter } from "./OpenAICompatibleAdapter";

/**
 * Ollama adapter — uses Ollama's OpenAI-compatible endpoint.
 * No API key required. Default endpoint: http://localhost:11434
 */
export class OllamaAdapter extends OpenAICompatibleAdapter {
  constructor(endpoint = "http://localhost:11434", model = "llama3") {
    super(`${endpoint}/v1/chat/completions`, "", model, {});
  }
}
