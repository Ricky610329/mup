import { OpenAICompatibleAdapter } from "./OpenAICompatibleAdapter";

/**
 * OpenAI Chat Completions adapter.
 */
export class OpenAIAdapter extends OpenAICompatibleAdapter {
  constructor(apiKey: string, model = "gpt-4o") {
    super(
      "https://api.openai.com/v1/chat/completions",
      apiKey,
      model,
      { Authorization: `Bearer ${apiKey}` }
    );
  }
}
