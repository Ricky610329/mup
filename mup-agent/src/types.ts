/** WebSocket message types between Agent (server) and Browser (client) */

// ---- Server → Client ----

export type ServerMessage =
  | { type: "load-mup"; mupId: string; html: string; manifest: any; savedState?: unknown }
  | { type: "mup-catalog"; catalog: CatalogItem[] }
  | { type: "chat-message"; role: "assistant" | "system"; content: string }
  | { type: "chat-delta"; delta: string }
  | { type: "chat-stream-end" }
  | { type: "chat-loading"; loading: boolean }
  | { type: "chat-tool-call"; toolName: string; status: "start" | "end" }
  | { type: "session-list"; sessions: SessionMeta[]; currentId: string }
  | { type: "session-loaded"; session: any }
  | { type: "session-saved" }
  | { type: "session-title"; title: string }
  | { type: "settings"; settings: any }
  | { type: "settings-saved"; success: boolean; error?: string }
  | { type: "folder-contents"; path: string; tree: TreeNode[]; error?: string }
  | { type: "initial-folder"; path: string };

// ---- Client → Server ----

export type ClientMessage =
  | { type: "ready" }
  | { type: "mup-loaded"; mupId: string }
  | { type: "result"; callId: string; result: any }
  | { type: "state"; mupId: string; summary: string; data?: unknown }
  | { type: "interaction"; mupId: string; action: string; summary: string; data?: unknown }
  | { type: "user-message"; text: string }
  | { type: "user-reset" }
  | { type: "activate-mup"; mupId: string }
  | { type: "deactivate-mup"; mupId: string }
  | { type: "register-and-activate"; mupId: string; html: string; fileName: string }
  | { type: "load-folder"; mups: Array<{ mupId: string; html: string; fileName: string }> }
  | { type: "scan-folder"; path: string }
  | { type: "list-sessions" }
  | { type: "load-session"; sessionId: string }
  | { type: "save-session"; data: { gridLayout?: any[]; folder?: string } }
  | { type: "delete-session"; sessionId: string }
  | { type: "new-session" }
  | { type: "rename-session"; title: string }
  | { type: "get-settings" }
  | { type: "update-settings"; settings: any };

// ---- Shared types ----

export interface CatalogItem {
  id: string;
  name: string;
  description: string;
  functions: number;
  active: boolean;
  grid?: any;
}

export interface SessionMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface TreeNode {
  type: "folder" | "file";
  name: string;
  children?: TreeNode[];
  // file-specific
  id?: string | null;
  valid?: boolean;
  manifestName?: string;
  functions?: number;
  active?: boolean;
  error?: string;
}
