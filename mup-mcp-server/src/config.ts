// ---- Centralized Configuration ----

export const CONFIG = {
  /** Default HTTP/WebSocket port */
  defaultPort: 3200,
  /** Number of ports to scan when default is taken */
  portScanRange: 20,
  /** Auto-save debounce interval (ms) */
  autoSaveDebounceMs: 2000,
  /** Periodic auto-save interval (ms) */
  autoSaveIntervalMs: 30_000,
  /** Max time to wait for a function call response (ms) */
  functionCallTimeoutMs: 30_000,
  /** Max length of a tool response text before truncation */
  maxResponseLength: 2000,
  /** Max length of a data content item (JSON) before truncation */
  maxDataResponseLength: 8000,
  /** Delay before auto-opening browser (ms) */
  browserOpenDelayMs: 3000,
  /** Max pending interaction events per MUP */
  maxPendingEvents: 50,
  /** Max call history entries per MUP */
  maxCallHistory: 30,
  /** Number of recent history entries shown in detail */
  recentHistoryCount: 5,
  /** Max result string length stored in call history */
  maxHistoryResultLength: 200,
  /** WebSocket max payload size (bytes) */
  wsMaxPayloadBytes: 10 * 1024 * 1024,
  /** Channel notification debounce (ms) */
  channelDebounceMs: 500,
  /** Heartbeat ping interval (ms) */
  heartbeatIntervalMs: 30_000,
  /** Heartbeat pong timeout — terminate if no response (ms) */
  heartbeatTimeoutMs: 10_000,
  /** Max age for queued messages before they're discarded (ms) */
  messageQueueTtlMs: 60_000,
} as const;
