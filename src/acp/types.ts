export type JsonRpcId = number | string;

export type JsonRpcMessage = {
  jsonrpc?: "2.0";
  id?: JsonRpcId | null;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
};

export type AcpSessionResult = {
  sessionId: string;
  models?: {
    availableModels?: Array<{ modelId: string; name: string }>;
  };
};

export type AcpPromptResult = {
  stopReason?: string;
};

export type SessionUpdate = {
  sessionId?: string;
  sessionUpdate?: string;
  content?: unknown;
  [key: string]: unknown;
};

export type SessionRunResult = {
  sessionId: string;
  text: string;
  reasoning: string;
  stopReason?: string;
  timings: {
    queuedMs: number;
    sessionNewMs: number;
    firstTextMs?: number;
    totalMs: number;
  };
};
