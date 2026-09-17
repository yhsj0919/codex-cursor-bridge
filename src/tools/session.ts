import { AcpConnection } from "../acp/connection.js";
import type { AcpConnectionOptions } from "../acp/connection.js";
import { ToolBridge } from "./bridge.js";
import type { PendingToolCall, ToolDefinition, ToolOutput } from "./types.js";

export type ToolTurn =
  | { status: "tool_calls"; text: string; calls: PendingToolCall[] }
  | { status: "completed"; text: string; calls: [] };

export class ToolSession {
  readonly bridge: ToolBridge;
  readonly #connection: AcpConnection;
  #sessionId?: string;
  #prompt?: Promise<unknown>;
  #text = "";
  #closed = false;

  constructor(options: AcpConnectionOptions, tools: ToolDefinition[]) {
    this.bridge = new ToolBridge(tools);
    this.#connection = new AcpConnection({
      ...options,
      onText: (text) => (this.#text += text),
      onPermission: (request) => {
        const payload = JSON.stringify(request).toLowerCase();
        return this.bridge.listed && payload.includes(this.bridge.name.toLowerCase())
          ? "allow-once"
          : "reject-once";
      },
    });
  }

  get closed(): boolean { return this.#closed; }
  has(callId: string): boolean { return this.bridge.has(callId); }

  async start(prompt: string, cwd: string, model: string): Promise<void> {
    await this.bridge.start();
    const session = await this.#connection.createSession(cwd, [this.bridge.descriptor]);
    this.#sessionId = session.sessionId;
    if (!this.#sessionId) throw new Error("ACP tool session returned no sessionId");
    if (model.toLowerCase() !== "auto") {
      await this.#connection.setSessionOption(this.#sessionId, "model", model);
    }
    this.#prompt = this.#connection.promptSession(this.#sessionId, prompt);
  }

  async collect(): Promise<ToolTurn> {
    if (!this.#prompt) throw new Error("Tool session not started");
    const toolReady = new Promise<"tools">((resolve) => {
      const stop = this.bridge.onCall(() => {
        setTimeout(() => { stop(); resolve("tools"); }, 40);
      });
    });
    const winner = await Promise.race([
      this.#prompt.then(() => "done" as const),
      toolReady,
    ]);
    const text = this.#text;
    this.#text = "";
    if (winner === "tools") return { status: "tool_calls", text, calls: this.bridge.pending() };
    await this.close();
    return { status: "completed", text, calls: [] };
  }

  async resume(outputs: ToolOutput[]): Promise<ToolTurn> {
    this.bridge.resolve(outputs);
    return this.collect();
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#sessionId) this.#connection.cancelSession(this.#sessionId);
    await this.bridge.close();
    await this.#connection.close();
  }
}
