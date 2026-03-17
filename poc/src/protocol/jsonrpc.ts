import type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
  JsonRpcError,
  JsonRpcMessage,
} from "./types";

let _nextId = 1;

export function createRequest(
  method: string,
  params?: Record<string, unknown>
): JsonRpcRequest {
  return {
    jsonrpc: "2.0",
    id: _nextId++,
    method,
    params,
  };
}

export function createResponse(
  id: string | number,
  result: unknown
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

export function createErrorResponse(
  id: string | number,
  code: number,
  message: string,
  data?: unknown
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message, data },
  };
}

export function createNotification(
  method: string,
  params?: Record<string, unknown>
): JsonRpcNotification {
  return { jsonrpc: "2.0", method, params };
}

export function isRequest(msg: JsonRpcMessage): msg is JsonRpcRequest {
  return "method" in msg && "id" in msg;
}

export function isResponse(msg: JsonRpcMessage): msg is JsonRpcResponse {
  return "id" in msg && !("method" in msg);
}

export function isNotification(
  msg: JsonRpcMessage
): msg is JsonRpcNotification {
  return "method" in msg && !("id" in msg);
}
