import type { LLMAdapter, LLMMessage, LLMResponse } from "./LLMAdapter";
import type { ToolDefinition } from "../host/LLMBridge";

interface OAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null | unknown[];
  tool_calls?: OAIToolCall[];
  tool_call_id?: string;
}

interface OAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OAITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * Base adapter for any OpenAI-compatible Chat Completions API.
 * Works with OpenAI, Ollama, and other compatible providers.
 */
export class OpenAICompatibleAdapter implements LLMAdapter {
  protected conversationHistory: OAIMessage[] = [];

  constructor(
    protected endpoint: string,
    protected apiKey: string,
    protected model: string,
    protected extraHeaders: Record<string, string> = {}
  ) {}

  async chat(messages: LLMMessage[], tools: ToolDefinition[]): Promise<LLMResponse> {
    this.conversationHistory = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    return this.callAPI(tools);
  }

  async feedToolResult(
    _messages: LLMMessage[],
    tools: ToolDefinition[],
    toolName: string,
    result: unknown
  ): Promise<LLMResponse> {
    const lastAssistant = [...this.conversationHistory]
      .reverse()
      .find((m) => m.role === "assistant" && m.tool_calls);

    const toolCall = lastAssistant?.tool_calls?.find(
      (tc) => tc.function.name === toolName
    );

    const funcResult = result as {
      content?: { type: string; text?: string; data?: string; mimeType?: string }[];
      isError?: boolean;
    };
    const images = funcResult.content?.filter((c) => c.type === "image") ?? [];
    const texts =
      funcResult.content
        ?.filter((c) => c.type !== "image")
        .map((c) => c.text || JSON.stringify(c.data))
        .join("\n") ?? "";

    this.conversationHistory.push({
      role: "tool",
      content: texts || JSON.stringify(result),
      tool_call_id: toolCall?.id ?? "unknown",
    });

    if (images.length > 0) {
      const visionContent: unknown[] = [
        { type: "text", text: "Here is the photo from the camera:" },
      ];
      for (const img of images) {
        visionContent.push({
          type: "image_url",
          image_url: {
            url: `data:${img.mimeType || "image/jpeg"};base64,${img.data}`,
          },
        });
      }
      this.conversationHistory.push({
        role: "user",
        content: visionContent,
      });
    }

    return this.callAPI(tools);
  }

  protected async callAPI(tools: ToolDefinition[]): Promise<LLMResponse> {
    const oaiTools = this.convertTools(tools);

    const body: Record<string, unknown> = {
      model: this.model,
      messages: this.conversationHistory,
    };

    if (oaiTools.length > 0) {
      body.tools = oaiTools;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...this.extraHeaders,
    };

    const res = await fetch(this.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`API error (${res.status}): ${err}`);
    }

    const data = await res.json();
    const choice = data.choices?.[0];
    if (!choice) throw new Error("No response from API");

    const message = choice.message;
    this.conversationHistory.push(message);

    const response: LLMResponse = {};

    if (message.content) {
      response.text = message.content;
    }

    if (message.tool_calls && message.tool_calls.length > 0) {
      response.toolCalls = message.tool_calls.map((tc: OAIToolCall) => ({
        toolName: tc.function.name,
        arguments: JSON.parse(tc.function.arguments),
      }));
    }

    return response;
  }

  private convertTools(tools: ToolDefinition[]): OAITool[] {
    return tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));
  }
}
