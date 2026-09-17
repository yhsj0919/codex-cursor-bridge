import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import type { PendingToolCall, ToolDefinition, ToolOutput } from "./types.js";

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };
type Parked = PendingToolCall & {
  resolve: (result: ToolResult) => void;
  reject: (error: Error) => void;
};

export class ToolBridge {
  readonly name = `codex-tools-${randomUUID().slice(0, 8)}`;
  readonly #token = randomBytes(32).toString("base64url");
  readonly #path = `/mcp/${randomUUID()}`;
  readonly #definitions: ToolDefinition[];
  readonly #pending = new Map<string, Parked>();
  readonly #listeners = new Set<() => void>();
  readonly #mcp: Server;
  readonly #transport: StreamableHTTPServerTransport;
  readonly #http;
  #url?: string;
  #listed = false;

  constructor(definitions: ToolDefinition[]) {
    this.#definitions = definitions;
    this.#mcp = new Server({ name: this.name, version: "0.1.0" }, { capabilities: { tools: {} } });
    this.#transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
    });
    this.#mcp.setRequestHandler(ListToolsRequestSchema, async () => {
      this.#listed = true;
      return { tools: this.#definitions.map((tool) => ({
        name: tool.name,
        ...(tool.description ? { description: tool.description } : {}),
        inputSchema: tool.inputSchema,
      })) };
    });
    this.#mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
      const definition = this.#definitions.find((tool) => tool.name === request.params.name);
      if (!definition) throw new Error(`Unknown tool: ${request.params.name}`);
      const callId = `call_${randomUUID().replaceAll("-", "")}`;
      const itemId = `${definition.responseType === "custom" ? "ct" : "fc"}_${randomUUID().replaceAll("-", "")}`;
      const args = request.params.arguments ?? {};
      const argumentsText = definition.responseType === "custom" && typeof args.input === "string"
        ? args.input
        : JSON.stringify(args);
      return new Promise<ToolResult>((resolve, reject) => {
        this.#pending.set(callId, {
          callId, itemId, name: definition.name, arguments: argumentsText,
          responseType: definition.responseType, resolve, reject,
        });
        for (const listener of this.#listeners) listener();
      });
    });
    this.#http = createServer((req, res) => {
      const remote = req.socket.remoteAddress ?? "";
      const local = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const actual = Buffer.from(req.headers.authorization ?? "");
      const expected = Buffer.from(`Bearer ${this.#token}`);
      const authorized = actual.length === expected.length && timingSafeEqual(actual, expected);
      if (!local) res.writeHead(403).end();
      else if (url.pathname !== this.#path || !authorized) res.writeHead(404).end();
      else void this.#transport.handleRequest(req, res).catch((error: unknown) => {
        if (!res.headersSent) res.writeHead(500).end();
        else res.end();
        for (const listener of this.#listeners) listener();
        void error;
      });
    });
  }

  async start(): Promise<void> {
    if (this.#url) return;
    // The SDK packages currently publish mutually incompatible optional
    // callback declarations under exactOptionalPropertyTypes.
    await this.#mcp.connect(
      this.#transport as unknown as Parameters<Server["connect"]>[0],
    );
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      this.#http.once("error", onError);
      this.#http.listen(0, "127.0.0.1", () => {
        this.#http.off("error", onError);
        resolve();
      });
    });
    const address = this.#http.address();
    if (!address || typeof address === "string") throw new Error("MCP bridge bind failed");
    this.#url = `http://127.0.0.1:${address.port}${this.#path}`;
  }

  get descriptor() {
    if (!this.#url) throw new Error("Tool bridge is not started");
    return { type: "http" as const, name: this.name, url: this.#url,
      headers: [{ name: "Authorization", value: `Bearer ${this.#token}` }] };
  }
  get listed(): boolean { return this.#listed; }
  pending(): PendingToolCall[] {
    return [...this.#pending.values()].map(({ resolve: _r, reject: _j, ...call }) => call);
  }
  has(callId: string): boolean { return this.#pending.has(callId); }
  onCall(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  resolve(outputs: ToolOutput[]): void {
    for (const output of outputs) if (!this.#pending.has(output.callId)) throw new Error(`Unknown tool call: ${output.callId}`);
    for (const output of outputs) {
      const call = this.#pending.get(output.callId)!;
      this.#pending.delete(output.callId);
      call.resolve({ content: [{ type: "text", text: output.output }], ...(output.isError ? { isError: true } : {}) });
    }
  }
  async close(): Promise<void> {
    for (const call of this.#pending.values()) call.reject(new Error("Tool bridge closed"));
    this.#pending.clear();
    this.#listeners.clear();
    await this.#transport.close().catch(() => undefined);
    await this.#mcp.close().catch(() => undefined);
    this.#http.closeAllConnections?.();
    if (this.#http.listening) await new Promise<void>((resolve) => this.#http.close(() => resolve()));
  }
}
