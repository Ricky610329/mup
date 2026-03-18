import type { LLMAdapter, LLMMessage, LLMResponse } from "./LLMAdapter";
import type { ToolDefinition } from "../host/LLMBridge";

/**
 * Minimal mock LLM for demo mode (no API key).
 * Just echoes available tools and returns generic responses.
 */
export class MockLLMAdapter implements LLMAdapter {
  async chat(messages: LLMMessage[], tools: ToolDefinition[]): Promise<LLMResponse> {
    if (tools.length === 0) {
      return { text: "No MUPs loaded. Drag a .html MUP file to get started." };
    }

    const toolNames = tools.map((t) => `\`${t.name}\``).join(", ");
    return {
      text: `Demo mode — I can see these tools: ${toolNames}\n\nConnect an LLM provider (OpenAI, Anthropic, Gemini, or Ollama) for real tool calling.`,
    };
  }

  async feedToolResult(
    _messages: LLMMessage[],
    _tools: ToolDefinition[],
    toolName: string,
    _result: unknown
  ): Promise<LLMResponse> {
    return { text: `Tool \`${toolName}\` executed.` };
  }
}
