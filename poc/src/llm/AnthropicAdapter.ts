import type { LLMAdapter, LLMMessage, LLMResponse } from "./LLMAdapter";
import type { ToolDefinition } from "../host/LLMBridge";

interface AnthropicMessage {
  role: "user" | "assistant";
  content: AnthropicContent[];
}

type AnthropicContent =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string };

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/**
 * Anthropic Messages API adapter.
 * Supports tool use and vision (base64 images).
 */
export class AnthropicAdapter implements LLMAdapter {
  private conversationHistory: AnthropicMessage[] = [];
  private systemPrompt = "";

  constructor(
    private apiKey: string,
    private model = "claude-sonnet-4-6"
  ) {}

  async chat(messages: LLMMessage[], tools: ToolDefinition[]): Promise<LLMResponse> {
    this.conversationHistory = [];
    this.systemPrompt = "";

    for (const m of messages) {
      if (m.role === "system") {
        this.systemPrompt += (this.systemPrompt ? "\n" : "") + m.content;
      } else {
        this.conversationHistory.push({
          role: m.role === "assistant" ? "assistant" : "user",
          content: [{ type: "text", text: m.content }],
        });
      }
    }

    return this.callAPI(tools);
  }

  async feedToolResult(
    _messages: LLMMessage[],
    tools: ToolDefinition[],
    toolName: string,
    result: unknown
  ): Promise<LLMResponse> {
    // Find the tool_use block to get the ID
    const lastAssistant = [...this.conversationHistory]
      .reverse()
      .find((m) => m.role === "assistant");

    const toolUseBlock = lastAssistant?.content.find(
      (c): c is Extract<AnthropicContent, { type: "tool_use" }> =>
        c.type === "tool_use" && c.name === toolName
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

    const userContent: AnthropicContent[] = [
      {
        type: "tool_result",
        tool_use_id: toolUseBlock?.id ?? "unknown",
        content: texts || JSON.stringify(result),
      },
    ];

    // Append images as separate image blocks in a follow-up
    if (images.length > 0) {
      userContent.push({ type: "text", text: "Here is the photo from the camera:" });
      for (const img of images) {
        userContent.push({
          type: "image",
          source: {
            type: "base64",
            media_type: img.mimeType || "image/jpeg",
            data: img.data!,
          },
        });
      }
    }

    this.conversationHistory.push({ role: "user", content: userContent });

    return this.callAPI(tools);
  }

  private async callAPI(tools: ToolDefinition[]): Promise<LLMResponse> {
    const anthropicTools = this.convertTools(tools);

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: 4096,
      messages: this.conversationHistory,
    };

    if (this.systemPrompt) {
      body.system = this.systemPrompt;
    }

    if (anthropicTools.length > 0) {
      body.tools = anthropicTools;
    }

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Anthropic API error (${res.status}): ${err}`);
    }

    const data = await res.json();

    // Store assistant response in history
    this.conversationHistory.push({
      role: "assistant",
      content: data.content,
    });

    // Parse response
    const response: LLMResponse = {};

    const textBlocks = data.content.filter(
      (c: { type: string }) => c.type === "text"
    );
    if (textBlocks.length > 0) {
      response.text = textBlocks
        .map((c: { text: string }) => c.text)
        .join("\n");
    }

    const toolUseBlocks = data.content.filter(
      (c: { type: string }) => c.type === "tool_use"
    );
    if (toolUseBlocks.length > 0) {
      response.toolCalls = toolUseBlocks.map(
        (c: { name: string; input: Record<string, unknown> }) => ({
          toolName: c.name,
          arguments: c.input,
        })
      );
    }

    return response;
  }

  private convertTools(tools: ToolDefinition[]): AnthropicTool[] {
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
    }));
  }
}
