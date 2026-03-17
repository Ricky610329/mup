import type { LLMAdapter, LLMMessage, LLMResponse } from "./LLMAdapter";
import type { ToolDefinition } from "../host/LLMBridge";

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * OpenAI Chat Completions adapter.
 * Calls the API directly via fetch — no SDK needed.
 * Supports agentic tool-call loops.
 */
export class OpenAIAdapter implements LLMAdapter {
  private apiKey: string;
  private model: string;
  private conversationHistory: OpenAIMessage[] = [];

  constructor(apiKey: string, model = "gpt-4o") {
    this.apiKey = apiKey;
    this.model = model;
  }

  async chat(messages: LLMMessage[], tools: ToolDefinition[]): Promise<LLMResponse> {
    // Build conversation history from scratch
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
    // Find the pending tool call ID
    const lastAssistant = [...this.conversationHistory]
      .reverse()
      .find((m) => m.role === "assistant" && m.tool_calls);

    const toolCall = lastAssistant?.tool_calls?.find(
      (tc) => tc.function.name === toolName
    );

    // Check if result contains images
    const funcResult = result as { content?: { type: string; text?: string; data?: string; mimeType?: string }[]; isError?: boolean };
    const images = funcResult.content?.filter((c) => c.type === "image") ?? [];
    const texts = funcResult.content?.filter((c) => c.type !== "image").map((c) => c.text || JSON.stringify(c.data)).join("\n") ?? "";

    // Add tool result to history
    this.conversationHistory.push({
      role: "tool",
      content: texts || JSON.stringify(result),
      tool_call_id: toolCall?.id ?? "unknown",
    });

    // If there are images, add them as a user message with vision content
    if (images.length > 0) {
      const visionContent: unknown[] = [
        { type: "text", text: "Here is the photo from the camera:" },
      ];
      for (const img of images) {
        visionContent.push({
          type: "image_url",
          image_url: { url: `data:${img.mimeType || "image/jpeg"};base64,${img.data}` },
        });
      }
      this.conversationHistory.push({
        role: "user",
        content: visionContent as unknown as string,
      });
    }

    return this.callAPI(tools);
  }

  private async callAPI(tools: ToolDefinition[]): Promise<LLMResponse> {
    const openaiTools = this.convertTools(tools);

    const body: Record<string, unknown> = {
      model: this.model,
      messages: this.conversationHistory,
    };

    if (openaiTools.length > 0) {
      body.tools = openaiTools;
    }

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI API error (${res.status}): ${err}`);
    }

    const data = await res.json();
    const choice = data.choices?.[0];
    if (!choice) throw new Error("No response from OpenAI");

    const message = choice.message;

    // Add assistant message to history
    this.conversationHistory.push(message);

    // Parse response
    const response: LLMResponse = {};

    if (message.content) {
      response.text = message.content;
    }

    if (message.tool_calls && message.tool_calls.length > 0) {
      response.toolCalls = message.tool_calls.map((tc: OpenAIToolCall) => ({
        toolName: tc.function.name,
        arguments: JSON.parse(tc.function.arguments),
      }));
    }

    return response;
  }

  private convertTools(tools: ToolDefinition[]): OpenAITool[] {
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
