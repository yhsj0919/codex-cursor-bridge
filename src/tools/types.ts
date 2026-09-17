export type ToolDefinition = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  responseType: "function" | "custom";
};

export type PendingToolCall = {
  callId: string;
  itemId: string;
  name: string;
  arguments: string;
  responseType: "function" | "custom";
};

export type ToolOutput = { callId: string; output: string; isError?: boolean };
