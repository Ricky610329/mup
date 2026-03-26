// MUP Protocol — Canonical TypeScript Type Definitions
// Protocol Version: mup/2026-03-17
//
// This file defines the MUP format and message contracts.
// Host-internal types (grid allocation, lifecycle states) are NOT here —
// those are implementation details for the host to decide.

// ============================================================
// JSON Schema Reference (for inputSchema fields)
// ============================================================
export type JSONSchema = Record<string, unknown>;

// ============================================================
// MUP Manifest
// ============================================================

export interface MupManifest {
  /** Protocol version, e.g. "mup/2026-03-17" */
  protocol?: string;
  /** Unique mup identifier (reverse-domain recommended) */
  id?: string;
  /** Human-readable display name */
  name: string;
  /** Semantic version */
  version?: string;
  /** Description for both humans and LLMs */
  description: string;
  /** Grid layout requirements (optional — host uses default if omitted) */
  grid?: GridRequirements;
  /** Functions exposed by this mup */
  functions?: MupFunction[];
  /** Browser Permissions Policy directives (e.g., ["camera", "microphone"]) */
  permissions?: string[];
  /** Whether this MUP supports dark mode theme switching */
  darkMode?: boolean;
  /** Whether multiple instances of this MUP can be opened simultaneously */
  multiInstance?: boolean;
  /** Default notification level configuration */
  notifications?: NotificationConfig;
  /** Optional author name */
  author?: string;
  /** Optional icon URL */
  icon?: string;
}

export interface NotificationConfig {
  /** Default level: "immediate" (channel push), "notify" (queued for polling), "silent" (suppressed) */
  level?: "immediate" | "notify" | "silent";
  /** Whether the LLM can change the notification level at runtime */
  overridable?: boolean;
}

export interface GridRequirements {
  /** Minimum width in grid cells (≥0, 0 = headless) */
  minWidth: number;
  /** Minimum height in grid cells (≥0, 0 = headless) */
  minHeight: number;
  /** Maximum width in grid cells (defaults to minWidth) */
  maxWidth?: number;
  /** Maximum height in grid cells (defaults to minHeight) */
  maxHeight?: number;
  /** Preferred/ideal width in grid cells */
  preferredWidth?: number;
  /** Preferred/ideal height in grid cells */
  preferredHeight?: number;
  /** Whether the user can resize this mup's area */
  resizable?: boolean;
}

export interface MupFunction {
  /** Function name (unique within mup). Pattern: ^[a-zA-Z][a-zA-Z0-9_]*$ */
  name: string;
  /** Human/LLM-readable description */
  description: string;
  /** JSON Schema for parameters */
  inputSchema: JSONSchema;
}

// ============================================================
// JSON-RPC 2.0 Base Types
// ============================================================

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

// ============================================================
// Host → MUP Messages
// ============================================================

/** Sent by host to initialize the mup after container loads */
export interface InitializeParams {
  protocolVersion: string;
  hostInfo: { name: string; version: string };
  gridAllocation: { width: number; height: number };
  theme?: { mode: "light" | "dark"; primaryColor?: string };
}

/** Sent by host to invoke a mup function */
export interface FunctionCallParams {
  /** Function name */
  name: string;
  /** Function arguments */
  arguments: Record<string, unknown>;
  /** Who triggered this call */
  source: "llm" | "user";
}

/** Sent by host when grid allocation changes */
export interface GridResizeNotificationParams {
  width: number;
  height: number;
}

/** Sent by host before destroying the mup */
export interface ShutdownNotificationParams {
  reason: string;
  gracePeriodMs: number;
}

// ============================================================
// MUP → Host Messages
// ============================================================

/** MUP's response to initialize */
export interface InitializeResult {
  protocolVersion: string;
  mupInfo: { name: string; version: string };
}

/** Result of a function call */
export interface FunctionCallResult {
  content: ContentItem[];
  isError: boolean;
}

export interface ContentItem {
  type: "text" | "image" | "data";
  text?: string;
  data?: unknown;
  mimeType?: string;
}

/** MUP notifies host of its current state (for LLM context) */
export interface StateUpdateParams {
  /** Human/LLM-readable summary */
  summary: string;
  /** Structured state data */
  data?: Record<string, unknown>;
}

/** MUP notifies host when user interacts with its UI */
export interface UserInteractionParams {
  /** What the user did */
  action: string;
  /** LLM-readable summary */
  summary: string;
  /** Structured interaction data */
  data?: Record<string, unknown>;
}

/** MUP requests more/less grid space */
export interface GridResizeRequestParams {
  width: number;
  height: number;
  reason: string;
}

// ============================================================
// Protocol Method Names
// ============================================================

export const Methods = {
  // Host → MUP
  Initialize: "initialize",
  FunctionCall: "functions/call",
  GridResize: "notifications/grid/resize",
  Shutdown: "notifications/shutdown",
  // MUP → Host
  StateUpdate: "notifications/state/update",
  UserInteraction: "notifications/interaction",
  ShutdownComplete: "notifications/shutdown/complete",
} as const;
