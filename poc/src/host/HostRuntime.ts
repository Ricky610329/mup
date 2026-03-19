import { MupRegistry } from "./MupRegistry";
import { GridLayoutManager } from "./GridLayoutManager";
import { MessageRouter } from "./MessageRouter";
import { LLMBridge } from "./LLMBridge";
import { ChatPanel } from "./ChatPanel";
import { MupContainer } from "./MupContainer";
import { Methods } from "../protocol/types";
import type { LLMAdapter } from "../llm/LLMAdapter";

import "./MupContainer"; // ensure custom element is registered

export class HostRuntime {
  private registry: MupRegistry;
  private grid: GridLayoutManager;
  private router: MessageRouter;
  private bridge: LLMBridge;
  private chat: ChatPanel;
  private llm: LLMAdapter;
  private gridContainer: HTMLElement;
  private containers = new Map<string, MupContainer>();
  private appEl: HTMLElement;

  // Agent loop state
  private agentRunning = false;
  private pendingRerun = false;
  private interactionDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly MAX_TOOL_ROUNDS = 15;
  private static readonly INTERACTION_DEBOUNCE_MS = 2000;

  constructor(
    chatContainer: HTMLElement,
    gridContainer: HTMLElement,
    llmAdapter: LLMAdapter,
    appEl: HTMLElement
  ) {
    this.registry = new MupRegistry();
    this.grid = new GridLayoutManager(gridContainer, 4, 3);
    this.router = new MessageRouter();
    this.bridge = new LLMBridge(this.registry, this.router);
    this.chat = new ChatPanel(chatContainer);
    this.llm = llmAdapter;
    this.gridContainer = gridContainer;
    this.appEl = appEl;

    this.setupChatHandler();
    this.setupNotificationHandlers();
    this.setupRequestHandler();
    this.setupFileDrop();
    this.setupFileUpload();
    this.setupMupClose();
  }

  /** Load and activate a MUP from a single HTML file */
  async activateMupFromHtml(htmlContent: string, fileName: string): Promise<void> {
    let manifest;
    try {
      const parsed = this.registry.parseFromHtml(htmlContent);
      manifest = parsed.manifest;
    } catch (err) {
      this.chat.addMessage({
        role: "system",
        content: `"${fileName}" is not a valid MUP: ${(err as Error).message}`,
        timestamp: Date.now(),
      });
      return;
    }

    this.registry.setState(manifest.id, "activating");

    const allocation = this.grid.allocate(manifest.id, manifest.grid);
    if (!allocation) {
      this.registry.setState(manifest.id, "registered");
      this.chat.addMessage({
        role: "system",
        content: `Not enough grid space for "${manifest.name}".`,
        timestamp: Date.now(),
      });
      return;
    }

    const container = document.createElement("mup-container") as MupContainer;
    this.gridContainer.appendChild(container);
    this.containers.set(manifest.id, container);

    try {
      await container.initializeFromHtml(manifest, htmlContent, allocation, this.router, this.grid);
      this.registry.setState(manifest.id, "active");
      this.updateLayoutMode();

      const funcCount = (manifest.functions ?? []).length;
      this.chat.addMessage({
        role: "system",
        content: `MUP "${manifest.name}" loaded! ${funcCount > 0 ? `${funcCount} function${funcCount > 1 ? "s" : ""} available.` : "Display-only MUP."}`,
        timestamp: Date.now(),
      });
    } catch (err) {
      this.cleanupFailedMup(manifest.id, container);
      this.chat.addMessage({
        role: "system",
        content: `Failed to activate "${manifest.name}": ${(err as Error).message}`,
        timestamp: Date.now(),
      });
    }
  }

  /** Deactivate and remove a MUP */
  async deactivateMup(mupId: string): Promise<void> {
    this.registry.setState(mupId, "deactivating");

    this.router.notify(mupId, Methods.Shutdown, {
      reason: "User requested deactivation",
      gracePeriodMs: 1000,
    });

    await new Promise((r) => setTimeout(r, 500));

    this.router.unregisterMup(mupId);
    this.grid.deallocate(mupId);

    const container = this.containers.get(mupId);
    if (container) {
      container.remove();
      this.containers.delete(mupId);
    }

    this.registry.setState(mupId, "destroyed");
    this.updateLayoutMode();
  }

  getChatPanel(): ChatPanel {
    return this.chat;
  }

  /** Toggle layout between full-screen chat and grid+chat mode */
  private updateLayoutMode(): void {
    const app = this.appEl;
    if (!app) return;

    const hasActiveMups = this.containers.size > 0;
    const chatEl = app.querySelector(".chat-panel") as HTMLElement | null;

    if (hasActiveMups) {
      app.classList.add("mup-active");
      if (chatEl) { chatEl.style.width = ""; chatEl.style.minWidth = ""; }
      this.ensureResizeHandle(app);
    } else {
      app.classList.remove("mup-active");
      app.querySelector(".mup-separator-handle")?.remove();
      if (chatEl) { chatEl.style.width = ""; chatEl.style.minWidth = ""; }
    }
  }

  /** Add a draggable resize handle between chat and grid */
  private ensureResizeHandle(app: HTMLElement): void {
    if (app.querySelector(".mup-separator-handle")) return;

    const handle = document.createElement("div");
    handle.className = "mup-separator-handle";

    const chatEl = app.querySelector(".chat-panel");
    const gridEl = app.querySelector("#mup-grid");
    if (chatEl && gridEl) {
      app.insertBefore(handle, gridEl);
    }

    let startX = 0;
    let startChatW = 0;

    const onMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startX;
      const newW = Math.max(220, Math.min(startChatW + delta, window.innerWidth * 0.5));
      (chatEl as HTMLElement).style.width = newW + "px";
      (chatEl as HTMLElement).style.minWidth = newW + "px";
    };

    const onMouseUp = () => {
      handle.classList.remove("dragging");
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    handle.addEventListener("mousedown", (e) => {
      e.preventDefault();
      handle.classList.add("dragging");
      startX = e.clientX;
      startChatW = (chatEl as HTMLElement).offsetWidth;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });
  }

  private cleanupFailedMup(mupId: string, container: MupContainer): void {
    this.registry.setState(mupId, "destroyed");
    this.router.unregisterMup(mupId);
    container.remove();
    this.containers.delete(mupId);
    this.grid.deallocate(mupId);
  }

  /** Listen for MUP close button clicks */
  private setupMupClose(): void {
    this.gridContainer.addEventListener("mup-close", async (e) => {
      const mupId = (e as CustomEvent).detail?.mupId;
      if (mupId) {
        await this.deactivateMup(mupId);
        this.chat.addMessage({
          role: "system",
          content: `MUP removed.`,
          timestamp: Date.now(),
        });
      }
    });
  }

  /** Set up drag-and-drop for .html MUP files */
  private setupFileDrop(): void {
    const dropTarget = this.appEl!;

    dropTarget.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropTarget.classList.add("drag-over");
    });

    dropTarget.addEventListener("dragleave", (e) => {
      e.preventDefault();
      dropTarget.classList.remove("drag-over");
    });

    dropTarget.addEventListener("drop", async (e) => {
      e.preventDefault();
      dropTarget.classList.remove("drag-over");

      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;

      for (const file of Array.from(files)) {
        if (file.name.endsWith(".html") || file.name.endsWith(".htm")) {
          const content = await file.text();
          await this.activateMupFromHtml(content, file.name);
        } else {
          this.chat.addMessage({
            role: "system",
            content: `"${file.name}" is not an HTML file. Drop a .html MUP file.`,
            timestamp: Date.now(),
          });
        }
      }
    });
  }

  /** Set up the + button file upload in chat panel */
  private setupFileUpload(): void {
    this.chat.onFileUpload(async (file) => {
      if (file.name.endsWith(".html") || file.name.endsWith(".htm")) {
        const content = await file.text();
        await this.activateMupFromHtml(content, file.name);
      } else {
        this.chat.addMessage({
          role: "system",
          content: `"${file.name}" is not an HTML file.`,
          timestamp: Date.now(),
        });
      }
    });
  }

  private setupChatHandler(): void {
    this.chat.onMessage(async (_text) => {
      await this.runAgentLoop();
    });
  }

  /**
   * Core agent loop: send conversation to LLM, execute any tool calls,
   * feed results back, repeat until LLM has nothing left to do.
   *
   * If called while already running, marks a pending rerun so that when
   * the current run finishes it immediately starts again — picking up
   * any messages/interactions that arrived in the meantime.
   */
  private async runAgentLoop(): Promise<void> {
    if (this.agentRunning) {
      this.pendingRerun = true;
      return;
    }
    this.agentRunning = true;
    this.chat.setLoading(true);

    try {
      const tools = this.bridge.getToolDefinitions();
      const messages = this.chat.getMessages().map((m) => ({
        role: m.role,
        content: m.content,
      }));

      let response = await this.llm.chat(messages, tools);
      let rounds = 0;

      while (rounds < HostRuntime.MAX_TOOL_ROUNDS) {
        if (response.text) {
          this.chat.addMessage({
            role: "assistant",
            content: response.text,
            timestamp: Date.now(),
          });
        }

        if (!response.toolCalls || response.toolCalls.length === 0) break;

        for (const call of response.toolCalls) {
          this.chat.addMessage({
            role: "system",
            content: `Calling ${call.toolName}...`,
            timestamp: Date.now(),
          });

          const result = await this.bridge.routeToolCall(call.toolName, call.arguments);
          response = await this.llm.feedToolResult(messages, tools, call.toolName, result);
        }

        rounds++;
      }

      if (rounds >= HostRuntime.MAX_TOOL_ROUNDS) {
        this.chat.addMessage({
          role: "system",
          content: `Agent stopped: reached ${HostRuntime.MAX_TOOL_ROUNDS} tool rounds.`,
          timestamp: Date.now(),
        });
      }
    } catch (err) {
      this.chat.addMessage({
        role: "system",
        content: `Error: ${(err as Error).message}`,
        timestamp: Date.now(),
      });
    } finally {
      this.agentRunning = false;
      this.chat.setLoading(false);

      // If new signals arrived while we were running, start another round
      if (this.pendingRerun) {
        this.pendingRerun = false;
        this.runAgentLoop();
      }
    }
  }

  /**
   * When a MUP reports a user interaction, debounce and auto-trigger
   * the agent loop so the LLM can react without waiting for user to type.
   */
  private scheduleAgentFromInteraction(): void {
    if (this.interactionDebounceTimer) clearTimeout(this.interactionDebounceTimer);
    this.interactionDebounceTimer = setTimeout(() => {
      this.interactionDebounceTimer = null;
      // Only auto-trigger if there are messages (conversation started)
      if (this.chat.getMessages().length > 0) {
        this.runAgentLoop();
      }
    }, HostRuntime.INTERACTION_DEBOUNCE_MS);
  }

  /** Handle requests from MUPs */
  private setupRequestHandler(): void {
    this.router.onRequest(async (_mupId, method, _params) => {
      const err = new Error(`Method not found: ${method}`);
      (err as any).code = -32601;
      throw err;
    });
  }

  private setupNotificationHandlers(): void {
    this.router.onNotification(Methods.StateUpdate, (mupId, params) => {
      const mup = this.registry.get(mupId);
      const name = mup?.manifest.name ?? mupId;
      this.chat.addMessage({
        role: "system",
        content: `[${name}] ${(params as { summary: string }).summary}`,
        timestamp: Date.now(),
      });
    });

    this.router.onNotification(Methods.UserInteraction, (mupId, params) => {
      const mup = this.registry.get(mupId);
      const name = mup?.manifest.name ?? mupId;
      const interaction = params as { action: string; summary: string };
      this.chat.addEventBadge(name, interaction.summary);
      // Auto-trigger agent loop so LLM can react to user interaction
      this.scheduleAgentFromInteraction();
    });
  }
}
