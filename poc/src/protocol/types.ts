// PoC types — mirrors spec/schema/types.ts for the protocol contract,
// plus host-internal types (GridAllocation, GridState, MupState) that
// the PoC host needs but are NOT part of the MUP spec.

export type JSONSchema = Record<string, unknown>;

// ---- MUP Manifest (matches spec) ----

export interface MupManifest {
  protocol?: string;
  id?: string;
  name: string;
  version?: string;
  description: string;
  grid?: GridRequirements;
  functions?: MupFunction[];
  permissions?: string[];
  author?: string;
  icon?: string;
}

export interface GridRequirements {
  minWidth: number;
  minHeight: number;
  maxWidth?: number;
  maxHeight?: number;
  preferredWidth?: number;
  preferredHeight?: number;
  resizable?: boolean;
}

export interface MupFunction {
  name: string;
  description: string;
  inputSchema: JSONSchema;
}

// ---- Host → MUP Messages (matches spec) ----

export interface InitializeParams {
  protocolVersion: string;
  hostInfo: { name: string; version: string };
  gridAllocation: { width: number; height: number };
  theme?: { mode: "light" | "dark"; primaryColor?: string };
}

export interface FunctionCallParams {
  name: string;
  arguments: Record<string, unknown>;
  source: "llm" | "user";
}

export interface GridResizeNotificationParams {
  width: number;
  height: number;
}

export interface ShutdownNotificationParams {
  reason: string;
  gracePeriodMs: number;
}

// ---- MUP → Host Messages (matches spec) ----

export interface InitializeResult {
  protocolVersion: string;
  mupInfo: { name: string; version: string };
}

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

export interface StateUpdateParams {
  summary: string;
  data?: Record<string, unknown>;
}

export interface UserInteractionParams {
  action: string;
  summary: string;
  data?: Record<string, unknown>;
}

export interface GridResizeRequestParams {
  width: number;
  height: number;
  reason: string;
}

// ---- Protocol Method Names (matches spec) ----

export const Methods = {
  Initialize: "initialize",
  FunctionCall: "functions/call",
  GridResize: "notifications/grid/resize",
  Shutdown: "notifications/shutdown",
  StateUpdate: "notifications/state/update",
  UserInteraction: "notifications/interaction",
  GridResizeRequest: "grid/resize",
  ShutdownComplete: "notifications/shutdown/complete",
} as const;

// ---- JSON-RPC 2.0 (matches spec) ----

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

// ==============================================================
// Host-internal types below — NOT part of the MUP spec.
// ==============================================================

/** MupManifest after host applies defaults (id, protocol, version, grid, functions guaranteed) */
export type ResolvedManifest = MupManifest & {
  protocol: string;
  id: string;
  version: string;
  grid: GridRequirements;
  functions: MupFunction[];
};

// ==============================================================
// These exist only for the PoC host implementation.
// ==============================================================

export interface GridAllocation {
  mupId: string;
  x: number;
  y: number;
  widthSpan: number;
  heightSpan: number;
}

export interface GridState {
  totalColumns: number;
  totalRows: number;
  allocations: GridAllocation[];
}

export type MupState =
  | "discovered"
  | "registered"
  | "activating"
  | "active"
  | "deactivating"
  | "destroyed";
