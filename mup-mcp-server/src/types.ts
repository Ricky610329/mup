// ---- Shared Types for MUP MCP Server ----

import type { MupManifest, LoadedMup } from "./manager.js";

// ---- Function Call Result ----

export interface FunctionResult {
  content: Array<{
    type: string;
    text?: string;
    data?: unknown;
    mimeType?: string;
  }>;
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

// ---- Workspace List Item ----

export interface WorkspaceListItem {
  name: string;
  displayName: string;
  description: string;
  savedAt: number;
  activeMups: string[];
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
  | { type: "list-workspaces" }
  | { type: "save-workspace"; name: string; description?: string }
  | { type: "load-workspace"; name: string }
  | { type: "delete-workspace"; name: string; isCurrent?: boolean }
  | { type: "save-grid-layout"; layout: GridLayoutItem[] }
  | { type: "rename-mup"; mupId: string; customName: string };

// ---- Server → Browser Messages ----

export type ServerMessage =
  | { type: "mup-catalog"; catalog: CatalogSummary[] }
  | { type: "folder-tree"; tree: FolderTreeNode[]; path: string }
  | { type: "load-mup"; mupId: string; html: string; manifest: MupManifest; savedState?: unknown }
  | { type: "call"; callId: string; mupId: string; fn: string; args: Record<string, unknown> }
  | { type: "error"; message: string }
  | { type: "auto-saved" }
  | { type: "workspace-list"; workspaces: WorkspaceListItem[] }
  | { type: "workspace-saved"; name: string }
  | { type: "workspace-loaded"; name: string; customNames: Record<string, string>; gridLayout?: GridLayoutItem[]; description?: string }
  | { type: "workspace-cleared" };

// ---- Typed Event Emitter for UiBridge ----

export interface BridgeEvents {
  "browser-connected": () => void;
  "browser-disconnected": () => void;
  "activate-mup": (mupId: string) => void;
  "deactivate-mup": (mupId: string) => void;
  "new-instance": (baseMupId: string, customName?: string) => void;
  "register-and-activate": (mupId: string, html: string, fileName: string) => void;
  "load-folder": (mups: Array<{ mupId: string; html: string; fileName: string }>) => void;
  "mup-loaded": (mupId: string) => void;
  "state-update": (mupId: string, summary: string, data?: unknown) => void;
  "interaction": (mupId: string, action: string, summary: string) => void;
  "save-grid-layout": (layout: GridLayoutItem[]) => void;
  "rename-mup": (mupId: string, newName: string) => void;
  "list-workspaces": () => void;
  "save-workspace": (name: string, description?: string) => void;
  "load-workspace": (name: string) => void;
  "delete-workspace": (name: string, isCurrent?: boolean) => void;
}

// ---- Call History ----

export interface CallHistoryEntry {
  functionName: string;
  args: Record<string, unknown>;
  result: string;
  timestamp: number;
}

// ---- Workspace Data ----

export interface WorkspaceData {
  name: string;
  description: string;
  savedAt: number;
  activeMups: string[];
  mupStates: Record<string, unknown>;
  callHistory: Record<string, CallHistoryEntry[]>;
  customNames: Record<string, string>;
  gridLayout?: GridLayoutItem[];
}

// ---- Helper: sendLoadMup callback type ----

export type SendLoadMupFn = (mupId: string, mup: LoadedMup) => void;
