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
        this.#emit();
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
  get instructions(): string {
    const names = this.#definitions.map((tool) => tool.name).join(", ");
    const hasRequestPermissions = this.#definitions.some(
      (tool) => tool.name.toLowerCase() === "request_permissions",
    );
    const lines = [
      `Tool policy for MCP server ${this.name}:`,
      `Available Codex tools: ${names || "none"}.`,
      "For every file, terminal, shell, browser, network, or other side-effecting operation, you MUST use an available tool from this MCP server.",
      "Never use Cursor built-in file, shell, terminal, edit, browser, or system tools.",
      "Prefer MCP tools so Codex can execute them directly after approval.",
      "Native Cursor tool permission requests are intentionally blocked and are never forwarded as approvals.",
      "If you receive native_tool_blocked, immediately retry the requested operation with the equivalent tool from this MCP server.",
      "If no suitable MCP tool is available, explain that the required Codex tool is unavailable instead of attempting a built-in operation.",
    ];
    if (hasRequestPermissions) {
      lines.push(
        "Codex approval workflow:",
        "If a file, delete, edit, or terminal tool reports permission denied, sandbox denied, approval required, or a similar permission error, you MUST call request_permissions with the needed filesystem or network permissions and a concrete reason.",
        "Wait for request_permissions to complete, then retry the original Codex tool once when permission is granted.",
        "Do not only tell the user to click Allow: an actual request_permissions tool call must be pending for Codex to show the approval dialog.",
      );
    }
    return lines.join("\n");
  }
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

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }
}
