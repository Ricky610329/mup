// ---- Shared Types for MUP MCP Server ----

// ---- MUP Core Types ----

export interface MupFunction {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export type NotificationLevel = "immediate" | "notify" | "silent";

export interface MupNotifications {
  level: NotificationLevel;
  overridable: boolean;
}

export interface MupManifest {
  protocol: string;
  id: string;
  name: string;
  version: string;
  description: string;
  grid?: {
    minWidth?: number;
    minHeight?: number;
    maxWidth?: number;
    maxHeight?: number;
    preferredWidth?: number;
    preferredHeight?: number;
    resizable?: boolean;
  };
  functions: MupFunction[];
  permissions?: string[];
  multiInstance?: boolean;
  darkMode?: boolean;
  notifications?: MupNotifications;
}

export interface LoadedMup {
  manifest: MupManifest;
  html: string;
  filePath: string;
  stateSummary: string;
  pendingEvents: MupEvent[];
  _overflowWarned?: boolean;
}

export interface MupEvent {
  action: string;
  summary: string;
  data?: unknown;
  timestamp: number;
}

export interface CatalogEntry {
  manifest: MupManifest;
  html: string;
  filePath: string;
  active: boolean;
}

// ---- Function Call Result ----

export type FunctionContentItem =
  | { type: "text"; text: string; data?: never; mimeType?: never }
  | { type: "image"; data: string; mimeType: string; text?: never }
  | { type: "data"; data: unknown; text?: never; mimeType?: never };

export interface FunctionResult {
  content: FunctionContentItem[];
  isError: boolean;
}

// ---- Folder Tree ----

export interface FolderTreeNode {
  type: "folder" | "file";
  name: string;
  children?: FolderTreeNode[];
  id?: string;
  description?: string;
  active?: boolean;
  multiInstance?: boolean;
  isMup?: boolean;
  ext?: string;
}

// ---- Grid Layout ----

export interface GridLayoutItem {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

// ---- Catalog Summary ----

export interface CatalogSummary {
  id: string;
  name: string;
  description: string;
  functions: number;
  active: boolean;
  grid?: MupManifest["grid"];
  multiInstance: boolean;
}

// ---- Workspace Metadata (lightweight, written on structure changes) ----

export interface WorkspaceMetadata {
  version: number;
  name?: string;
  mupsPath?: string;
  activeMups: string[];
  gridLayout: GridLayoutItem[];
  customNames: Record<string, string>;
}

// ---- Browser → Server Messages ----

export type BrowserMessage =
  | { type: "ready" }
  | { type: "mup-loaded"; mupId: string }
  | { type: "result"; callId: string; result: FunctionResult }
  | { type: "state"; mupId: string; summary: string; data?: unknown }
  | { type: "interaction"; mupId: string; action: string; summary: string; data?: unknown }
  | { type: "activate-mup"; mupId: string }
  | { type: "deactivate-mup"; mupId: string }
  | { type: "register-and-activate"; mupId: string; html: string; fileName: string }
  | { type: "load-folder"; mups: Array<{ mupId: string; html: string; fileName: string }> }
  | { type: "new-instance"; mupId: string; customName?: string }
  | { type: "save-grid-layout"; layout: GridLayoutItem[] }
  | { type: "rename-mup"; mupId: string; customName: string }
  | { type: "flush-save" }
  | { type: "rename-workspace"; name: string }
  | { type: "set-mups-path"; path: string }
  | { type: "permission-verdict"; requestId: string; behavior: "allow" | "deny" };

// ---- Server → Browser Messages ----

export type ServerMessage =
  | { type: "mup-catalog"; catalog: CatalogSummary[] }
  | { type: "folder-tree"; tree: FolderTreeNode[]; path: string }
  | { type: "load-mup"; mupId: string; html: string; manifest: MupManifest }
  | { type: "call"; callId: string; mupId: string; fn: string; args: Record<string, unknown> }
  | { type: "error"; message: string }
  | { type: "auto-saved" }
  | { type: "workspace-restored"; name?: string; customNames: Record<string, string>; gridLayout?: GridLayoutItem[] }
  | { type: "mup-deactivated"; mupId: string }
  | { type: "mups-path-changed"; path: string }
  | { type: "mups-path-error"; errors: string[] }
  | { type: "mups-path-warnings"; warnings: string[] }
  | { type: "permission-request"; requestId: string; toolName: string; description: string; inputPreview: string }
  | { type: "thinking"; active: boolean }
  | { type: "set-layout"; layout: GridLayoutItem[] };

// ---- Typed Event Emitter for UiBridge ----

export interface BridgeEvents {
  "browser-connected": () => void;
  "browser-ready": () => void;
  "browser-disconnected": () => void;
  "activate-mup": (mupId: string) => void;
  "deactivate-mup": (mupId: string) => void;
  "new-instance": (baseMupId: string, customName?: string) => void;
  "register-and-activate": (mupId: string, html: string, fileName: string) => void;
  "load-folder": (mups: Array<{ mupId: string; html: string; fileName: string }>) => void;
  "mup-loaded": (mupId: string) => void;
  "state-update": (mupId: string, summary: string, data?: unknown) => void;
  "interaction": (mupId: string, action: string, summary: string, data?: unknown) => void;
  "save-grid-layout": (layout: GridLayoutItem[]) => void;
  "rename-mup": (mupId: string, newName: string) => void;
  "flush-save": () => void;
  "rename-workspace": (name: string) => void;
  "set-mups-path": (path: string) => void;
  "permission-verdict": (requestId: string, behavior: "allow" | "deny") => void;
}

// ---- Call History (session-only, not persisted) ----

export interface CallHistoryEntry {
  functionName: string;
  args: Record<string, unknown>;
  result: string;
  timestamp: number;
}

// ---- Helper: sendLoadMup callback type ----

export type SendLoadMupFn = (mupId: string, mup: LoadedMup) => void;
