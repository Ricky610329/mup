import type { Agent } from "@mariozechner/pi-agent-core";
import type { AgentEvent } from "@mariozechner/pi-agent-core";
import type { Model, KnownProvider } from "@mariozechner/pi-ai";
import { completeSimple, getEnvApiKey } from "@mariozechner/pi-ai";
import { listSessions, loadSession, saveSession, deleteSession, createSession, type SessionData } from "./sessions.js";
import type { MupManager } from "./manager.js";
import type { UiBridge } from "./bridge.js";
import { buildMupTools, buildSystemPrompt } from "./agent.js";
import type { ServerMessage } from "./types.js";

export interface SessionHandlerDeps {
  agent: Agent;
  manager: MupManager;
  bridge: UiBridge;
  model: Model<any>;
  getApiKey: () => string | undefined;
}

export function setupSessionHandler(deps: SessionHandlerDeps) {
  const { agent, manager, bridge } = deps;
  let currentSession: SessionData = createSession();

  function send(msg: ServerMessage) {
    bridge.sendRaw(msg as Record<string, unknown>);
  }

  function sendSessionList() {
    send({
      type: "session-list",
      sessions: listSessions(),
      currentId: currentSession.id,
    });
  }

  function autoSave() {
    currentSession.messages = [...agent.state.messages] as any[];
    currentSession.activeMups = manager.getAll().map(m => m.manifest.id);
    currentSession.mupStates = manager.getStateSnapshot();
    if (currentSession.messages.length === 0) return;
    saveSession(currentSession);
    send({ type: "session-saved" });
  }

  // Auto-save + title generation after each agent response
  agent.subscribe((event: AgentEvent) => {
    if (event.type === "agent_end") {
      autoSave();
      sendSessionList();

      if (currentSession.title === "New chat" && agent.state.messages.length >= 2) {
        generateTitle().catch(err => {
          console.error("[mup-agent] Title generation failed:", err);
        });
      }
    }
  });

  async function generateTitle() {
    const msgs = agent.state.messages as any[];
    const userMsg = msgs.find((m: any) => m.role === "user");
    if (!userMsg) return;

    const userText = Array.isArray(userMsg.content)
      ? userMsg.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("")
      : String(userMsg.content);

    const assistantMsg = msgs.find((m: any) => m.role === "assistant");
    const assistantText = assistantMsg && Array.isArray(assistantMsg.content)
      ? assistantMsg.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("")
      : "";

    try {
      const result = await completeSimple(deps.model, {
        systemPrompt: "Generate a short title (3-6 words, no quotes) for this conversation.",
        messages: [{ role: "user" as const, content: `User: ${userText.slice(0, 200)}\nAssistant: ${assistantText.slice(0, 200)}`, timestamp: Date.now() }],
        tools: [],
      }, { apiKey: deps.getApiKey() });

      const title = (result.content as any[])
        ?.filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join("")
        .trim()
        .slice(0, 60);

      if (title) {
        currentSession.title = title;
        saveSession(currentSession);
        sendSessionList();
        send({ type: "session-title", title });
      }
    } catch {
      // Fallback to first user message
      currentSession.title = userText.slice(0, 50) || "New chat";
      saveSession(currentSession);
      sendSessionList();
    }
  }

  // ---- Bridge event handlers ----

  bridge.on("list-sessions", () => sendSessionList());

  bridge.on("new-session", () => {
    if (currentSession.messages.length > 0) autoSave();
    currentSession = createSession();
    agent.clearMessages();
    agent.clearAllQueues();
    for (const mup of manager.getAll()) manager.deactivate(mup.manifest.id);
    agent.setTools([]);
    agent.setSystemPrompt(buildSystemPrompt(manager));
    sendSessionList();
    send({ type: "session-loaded", session: currentSession });
  });

  bridge.on("load-session", (sessionId: string) => {
    autoSave();
    const data = loadSession(sessionId);
    if (!data) return;
    currentSession = data;

    agent.clearMessages();
    agent.clearAllQueues();
    for (const msg of data.messages) agent.appendMessage(msg);

    for (const mup of manager.getAll()) manager.deactivate(mup.manifest.id);

    // Send session-loaded first (clears browser UI), then load MUPs
    sendSessionList();
    send({ type: "session-loaded", session: data });

    for (const mupId of data.activeMups) {
      const loaded = manager.activate(mupId);
      if (loaded) {
        const savedState = data.mupStates?.[mupId] ?? null;
        send({
          type: "load-mup",
          mupId: loaded.manifest.id,
          html: loaded.html,
          manifest: loaded.manifest,
          savedState,
        });
      }
    }
    agent.setTools(buildMupTools(manager, bridge));
    agent.setSystemPrompt(buildSystemPrompt(manager));
  });

  bridge.on("delete-session", (sessionId: string) => {
    deleteSession(sessionId);
    if (currentSession.id === sessionId) {
      currentSession = createSession();
      agent.clearMessages();
      agent.clearAllQueues();
    }
    sendSessionList();
  });

  bridge.on("save-session", (data: any) => {
    if (data.gridLayout) currentSession.gridLayout = data.gridLayout;
    if (data.folder) currentSession.folder = data.folder;
    saveSession(currentSession);
  });

  bridge.on("rename-session", (title: string) => {
    currentSession.title = title;
    saveSession(currentSession);
    sendSessionList();
  });

  // Send initial session list after connection
  setTimeout(() => sendSessionList(), 500);

  return { autoSave, getCurrentSession: () => currentSession };
}
