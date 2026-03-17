import type { LLMAdapter, LLMMessage, LLMResponse } from "./LLMAdapter";
import type { ToolDefinition } from "../host/LLMBridge";

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: { content: unknown } } };

interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * Google Gemini (Generative Language API) adapter.
 * Supports tool use and vision (inline base64 images).
 */
export class GeminiAdapter implements LLMAdapter {
  private conversationHistory: GeminiContent[] = [];
  private systemInstruction = "";

  constructor(
    private apiKey: string,
    private model = "gemini-2.5-flash"
  ) {}

  async chat(messages: LLMMessage[], tools: ToolDefinition[]): Promise<LLMResponse> {
    this.conversationHistory = [];
    this.systemInstruction = "";

    for (const m of messages) {
      if (m.role === "system") {
        this.systemInstruction += (this.systemInstruction ? "\n" : "") + m.content;
      } else {
        this.conversationHistory.push({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
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

    const parts: GeminiPart[] = [
      {
        functionResponse: {
          name: toolName,
          response: { content: texts || JSON.stringify(result) },
        },
      },
    ];

    this.conversationHistory.push({ role: "user", parts });

    // Append images as a follow-up user message
    if (images.length > 0) {
      const imageParts: GeminiPart[] = [
        { text: "Here is the photo from the camera:" },
      ];
      for (const img of images) {
        imageParts.push({
          inlineData: {
            mimeType: img.mimeType || "image/jpeg",
            data: img.data!,
          },
        });
      }
      this.conversationHistory.push({ role: "user", parts: imageParts });
    }

    return this.callAPI(tools);
  }

  private async callAPI(tools: ToolDefinition[]): Promise<LLMResponse> {
    const functionDeclarations = this.convertTools(tools);

    const body: Record<string, unknown> = {
      contents: this.conversationHistory,
    };

    if (this.systemInstruction) {
      body.systemInstruction = { parts: [{ text: this.systemInstruction }] };
    }

    if (functionDeclarations.length > 0) {
      body.tools = [{ functionDeclarations }];
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gemini API error (${res.status}): ${err}`);
    }

    const data = await res.json();
    const candidate = data.candidates?.[0];
    if (!candidate) throw new Error("No response from Gemini");

    const parts: GeminiPart[] = candidate.content?.parts ?? [];

    // Store model response in history
    this.conversationHistory.push({
      role: "model",
      parts,
    });

    // Parse response
    const response: LLMResponse = {};

    const textParts = parts.filter(
      (p): p is { text: string } => "text" in p
    );
    if (textParts.length > 0) {
      response.text = textParts.map((p) => p.text).join("\n");
    }

    const funcCalls = parts.filter(
      (p): p is { functionCall: { name: string; args: Record<string, unknown> } } =>
        "functionCall" in p
    );
    if (funcCalls.length > 0) {
      response.toolCalls = funcCalls.map((p) => ({
        toolName: p.functionCall.name,
        arguments: p.functionCall.args,
      }));
    }

    return response;
  }

  private convertTools(tools: ToolDefinition[]): GeminiFunctionDeclaration[] {
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    }));
  }
}
