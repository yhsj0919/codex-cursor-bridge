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
  #nativePermissionBlocks: string[] = [];
  #closed = false;

  constructor(options: AcpConnectionOptions, tools: ToolDefinition[]) {
    this.bridge = new ToolBridge(tools);
    this.#connection = new AcpConnection({
      ...options,
      onText: (text) => (this.#text += text),
      onPermission: (request) => {
        const payload = JSON.stringify(request).toLowerCase();
        if (this.bridge.listed && payload.includes(this.bridge.name.toLowerCase())) {
          return "allow-once";
        }
        const toolCall = request.toolCall;
        const tool = toolCall && typeof toolCall === "object"
          ? toolCall as Record<string, unknown>
          : {};
        const title = typeof tool.title === "string" ? tool.title : "unknown Cursor tool";
        const details = tool.rawInput && typeof tool.rawInput === "object"
          ? `; request=${JSON.stringify(tool.rawInput)}`
          : "";
        this.#nativePermissionBlocks.push(
          `[native_tool_blocked] Cursor native tool "${title}" was blocked${details}. ` +
          "The operation was not approved or executed. Retry it with an equivalent Codex tool from the Bridge MCP server.",
        );
        return "reject-once";
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
    const guardedPrompt = `${this.bridge.instructions}\n\nUser request:\n${prompt}`;
    this.#prompt = this.#connection.promptSession(this.#sessionId, guardedPrompt);
  }

  async collect(): Promise<ToolTurn> {
    if (!this.#prompt) throw new Error("Tool session not started");
    let stop: () => void = () => undefined;
    let settleDelay: ReturnType<typeof setTimeout> | undefined;
    const toolReady = this.bridge.pending().length > 0
      ? Promise.resolve("tools" as const)
      : new Promise<"tools">((resolve) => {
          stop = this.bridge.onCall(() => {
            settleDelay ??= setTimeout(() => resolve("tools"), 40);
          });
        });
    const winner = await Promise.race([this.#prompt.then(() => "done" as const), toolReady]);
    stop();
    if (winner === "done" && settleDelay) clearTimeout(settleDelay);
    const notices = this.#nativePermissionBlocks.splice(0).join("\n");
    const text = [this.#text, notices].filter(Boolean).join("\n");
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
