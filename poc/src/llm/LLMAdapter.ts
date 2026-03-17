import type { ToolDefinition } from "../host/LLMBridge";

export interface LLMMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface LLMToolCall {
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface LLMResponse {
  /** Text content to display to the user */
  text?: string;
  /** Tool calls the LLM wants to make */
  toolCalls?: LLMToolCall[];
}

export interface LLMAdapter {
  /** Send messages to the LLM and get a response */
  chat(messages: LLMMessage[], tools: ToolDefinition[]): Promise<LLMResponse>;

  /** Feed a tool result back to the LLM and get the next response */
  feedToolResult(
    messages: LLMMessage[],
    tools: ToolDefinition[],
    toolName: string,
    result: unknown
  ): Promise<LLMResponse>;
}
