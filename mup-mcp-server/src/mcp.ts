import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { MupManager } from "./manager.js";
import type { UiBridge } from "./bridge.js";

export class McpServer {
  private server: Server;
  private manager: MupManager;
  private bridge: UiBridge;

  constructor(manager: MupManager, bridge: UiBridge) {
    this.manager = manager;
    this.bridge = bridge;

    this.server = new Server(
      { name: "mup-mcp-server", version: "0.1.0" },
      {
        capabilities: {
          tools: {},
          resources: { subscribe: true },
        },
      }
    );

    this.setupHandlers();

    // Notify MCP client when MUP state/interactions change
    bridge.on("interaction", (mupId: string) => {
      this.server
        .notification({
          method: "notifications/resources/updated",
          params: { uri: `mup://${mupId}/events` },
        })
        .catch(() => {});
    });

    bridge.on("state-update", (mupId: string) => {
      this.server
        .notification({
          method: "notifications/resources/updated",
          params: { uri: `mup://${mupId}/state` },
        })
        .catch(() => {});
    });
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("[mup-mcp] MCP server connected via stdio");
  }

  private setupHandlers(): void {
    // ---- Tools ----

    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = this.manager.getToolDefinitions().map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));

      // Meta tool: check for user interactions
      tools.push({
        name: "mup__check_events",
        description:
          "Check for recent user interactions with MUP UI panels. Call this to see what the user has been doing in the MUP interface.",
        inputSchema: { type: "object" as const, properties: {} },
      });

      return { tools };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      // Meta tool
      if (name === "mup__check_events") {
        return this.handleCheckEvents();
      }

      // Route to MUP function
      const parsed = this.manager.parseToolName(name);
      if (!parsed) {
        return {
          content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
          isError: true,
        };
      }

      const result = await this.bridge.callFunction(
        parsed.mupId,
        parsed.functionName,
        (args ?? {}) as Record<string, unknown>
      );

      // Convert MUP content → MCP content
      const content = result.content.map(
        (c: {
          type: string;
          text?: string;
          data?: unknown;
          mimeType?: string;
        }) => {
          if (c.type === "text")
            return { type: "text" as const, text: c.text || "" };
          if (c.type === "image")
            return {
              type: "image" as const,
              data: (c.data as string) || "",
              mimeType: c.mimeType || "image/png",
            };
          if (c.type === "data")
            return { type: "text" as const, text: JSON.stringify(c.data) };
          return { type: "text" as const, text: String(c) };
        }
      );

      // Append any pending user interactions
      const events = this.manager.drainEvents();
      if (events.length > 0) {
        const lines = events.map((e) => `[${e.mupName}] ${e.summary}`);
        content.push({
          type: "text" as const,
          text: `\n--- Recent user interactions ---\n${lines.join("\n")}`,
        });
      }

      return { content, isError: result.isError };
    });

    // ---- Resources ----

    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      const resources = this.manager.getAll().map((mup) => ({
        uri: `mup://${mup.manifest.id}/state`,
        name: `${mup.manifest.name} state`,
        description: `Current state of the ${mup.manifest.name} MUP panel`,
        mimeType: "text/plain",
      }));
      return { resources };
    });

    this.server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
      const { uri } = req.params;
      const match = uri.match(/^mup:\/\/([^/]+)\/state$/);
      if (!match) throw new Error(`Unknown resource: ${uri}`);

      const mup = this.manager.get(match[1]);
      if (!mup) throw new Error(`MUP not found: ${match[1]}`);

      return {
        contents: [
          {
            uri,
            mimeType: "text/plain",
            text:
              mup.stateSummary ||
              `${mup.manifest.name}: no state reported yet`,
          },
        ],
      };
    });
  }

  private handleCheckEvents() {
    const events = this.manager.drainEvents();
    if (events.length === 0) {
      const states = this.manager
        .getAll()
        .filter((m) => m.stateSummary)
        .map((m) => `[${m.manifest.name}] ${m.stateSummary}`);

      return {
        content: [
          {
            type: "text" as const,
            text: states.length
              ? `No new interactions.\n\nCurrent state:\n${states.join("\n")}`
              : "No new interactions and no active MUP state.",
          },
        ],
      };
    }

    const lines = events.map((e) => `[${e.mupName}] ${e.summary}`);
    return {
      content: [
        {
          type: "text" as const,
          text: `User interactions:\n${lines.join("\n")}`,
        },
      ],
    };
  }
}
