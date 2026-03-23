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
  activeMups: string[];
  gridLayout: GridLayoutItem[];
  customNames: Record<string, string>;
}

// ---- Per-MUP State File (written individually on state changes) ----

export interface MupStateFile {
  mupId: string;
  savedAt: number;
  data: unknown;
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
  | { type: "rename-workspace"; name: string };

// ---- Server → Browser Messages ----

export type ServerMessage =
  | { type: "mup-catalog"; catalog: CatalogSummary[] }
  | { type: "folder-tree"; tree: FolderTreeNode[]; path: string }
  | { type: "load-mup"; mupId: string; html: string; manifest: MupManifest; savedState?: unknown }
  | { type: "call"; callId: string; mupId: string; fn: string; args: Record<string, unknown> }
  | { type: "error"; message: string }
  | { type: "auto-saved" }
  | { type: "workspace-restored"; name?: string; customNames: Record<string, string>; gridLayout?: GridLayoutItem[] };

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
  "flush-save": () => void;
  "rename-workspace": (name: string) => void;
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
