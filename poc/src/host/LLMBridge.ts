import type { FunctionCallResult } from "../protocol/types";
import { Methods } from "../protocol/types";
import { MessageRouter } from "./MessageRouter";
import { MupRegistry } from "./MupRegistry";

/** A tool definition in the format LLMs expect */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** The MUP this tool belongs to */
  _mupId: string;
  /** The original function name within the MUP */
  _functionName: string;
}

export class LLMBridge {
  constructor(
    private registry: MupRegistry,
    private router: MessageRouter
  ) {}

  /** Convert all active MUP functions into LLM tool definitions */
  getToolDefinitions(): ToolDefinition[] {
    const tools: ToolDefinition[] = [];

    for (const { manifest, state } of this.registry.getAll()) {
      if (state !== "active") continue;

      for (const fn of manifest.functions ?? []) {
        tools.push({
          name: `${manifest.id.replace(/[^a-zA-Z0-9]/g, "_")}__${fn.name}`,
          description: `[${manifest.name}] ${fn.description}`,
          inputSchema: fn.inputSchema,
          _mupId: manifest.id,
          _functionName: fn.name,
        });
      }
    }

    return tools;
  }

  /** Route an LLM tool call to the correct MUP function */
  async routeToolCall(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<FunctionCallResult> {
    // Tool names use __ as separator: "mup_id__functionName"
    const sepIndex = toolName.indexOf("__");
    if (sepIndex === -1) {
      return {
        content: [{ type: "text", text: `Invalid tool name: ${toolName}` }],
        isError: true,
      };
    }

    const mupIdSanitized = toolName.substring(0, sepIndex);
    const functionName = toolName.substring(sepIndex + 2);

    // Find MUP by matching sanitized ID
    const allMups = this.registry.getAll();
    const match = allMups.find(
      (s) => s.manifest.id.replace(/[^a-zA-Z0-9]/g, "_") === mupIdSanitized && s.state === "active"
    );
    if (!match) {
      return {
        content: [{ type: "text", text: `MUP not active: ${mupIdSanitized}` }],
        isError: true,
      };
    }

    const mup = this.registry.get(match.manifest.id);
    if (!mup) {
      return {
        content: [{ type: "text", text: `MUP not found` }],
        isError: true,
      };
    }

    const fn = (mup.manifest.functions ?? []).find((f) => f.name === functionName);
    if (!fn) {
      return {
        content: [{ type: "text", text: `Function not found: ${functionName}` }],
        isError: true,
      };
    }

    try {
      const result = await this.router.request(match.manifest.id, Methods.FunctionCall, {
        name: functionName,
        arguments: args,
        source: "llm",
      });

      return result as FunctionCallResult;
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
}
