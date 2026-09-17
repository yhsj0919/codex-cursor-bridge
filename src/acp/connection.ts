import { spawn, type ChildProcess } from "node:child_process";
import { createInterface, type Interface } from "node:readline";

import type {
  AcpPromptResult,
  AcpSessionResult,
  JsonRpcId,
  JsonRpcMessage,
  SessionRunResult,
  SessionUpdate,
} from "./types.js";

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type ActiveSession = {
  id: string;
  text: string;
  reasoning: string;
  startedAt: number;
  firstTextAt?: number;
  onText?: (text: string) => void;
};

export type AcpConnectionOptions = {
  command: string;
  args?: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  requestTimeoutMs?: number;
  skipAuthenticate?: boolean;
  onDiagnostic?: (message: string) => void;
  onPermission?: (
    request: Record<string, unknown>,
  ) => string | undefined | Promise<string | undefined>;
};

function textFromContent(content: unknown): string {
  if (!content || typeof content !== "object") return "";
  if (!Array.isArray(content)) {
    const value = (content as { text?: unknown }).text;
    return typeof value === "string" ? value : "";
  }
  return content
    .map((part) => textFromContent(part))
    .join("");
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export class AcpConnection {
  readonly #options: AcpConnectionOptions;
  readonly #pending = new Map<number, PendingRequest>();
  #child?: ChildProcess;
  #reader?: Interface;
  #nextId = 1;
  #initialized = false;
  #closed = false;
  #stderr = "";
  #active: ActiveSession | undefined;
  #queue: Promise<void> = Promise.resolve();

  constructor(options: AcpConnectionOptions) {
    this.#options = options;
  }

  get running(): boolean {
    return !!this.#child && !this.#closed;
  }

  get stderrTail(): string {
    return this.#stderr.slice(-2_000).trim();
  }

  async start(): Promise<void> {
    if (this.#initialized && this.running) return;
    if (this.#child) throw new Error("ACP connection cannot be restarted");

    const child = spawn(this.#options.command, this.#options.args ?? ["acp"], {
      cwd: this.#options.cwd,
      env: this.#options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.#child = child;

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      this.#stderr += chunk;
      if (this.#stderr.length > 16_000) this.#stderr = this.#stderr.slice(-8_000);
    });

    this.#reader = createInterface({ input: child.stdout! });
    this.#reader.on("line", (line) => this.#handleLine(line));
    child.once("error", (error) => this.#fail(error));
    child.once("close", (code) => {
      this.#closed = true;
      this.#fail(
        new Error(
          `Cursor ACP exited with code ${code ?? 1}${
            this.stderrTail ? `: ${this.stderrTail}` : ""
          }`,
        ),
      );
    });

    await this.#request("initialize", {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
      clientInfo: { name: "codex-cursor-bridge", version: "0.1.0" },
    });
    if (!this.#options.skipAuthenticate) {
      await this.#request("authenticate", { methodId: "cursor_login" });
    }
    this.#initialized = true;
  }

  runSession(options: {
    prompt: string;
    cwd?: string;
    model?: string;
    mode?: "agent" | "plan" | "ask";
    onText?: (text: string) => void;
  }): Promise<SessionRunResult> {
    const queuedAt = Date.now();
    const task = this.#queue.then(async () => {
      await this.start();
      const startedAt = Date.now();
      const sessionStart = Date.now();
      const session = (await this.#request("session/new", {
        cwd: options.cwd ?? this.#options.cwd,
        mcpServers: [],
      })) as AcpSessionResult;
      const sessionNewMs = Date.now() - sessionStart;
      if (!session.sessionId) throw new Error("ACP session/new returned no sessionId");

      if (options.model && options.model.toLowerCase() !== "auto") {
        await this.#request("session/set_config_option", {
          sessionId: session.sessionId,
          configId: "model",
          value: options.model,
        });
      }
      if (options.mode && options.mode !== "agent") {
        await this.#request("session/set_config_option", {
          sessionId: session.sessionId,
          configId: "mode",
          value: options.mode,
        });
      }

      this.#active = {
        id: session.sessionId,
        text: "",
        reasoning: "",
        startedAt,
        ...(options.onText ? { onText: options.onText } : {}),
      };
      const result = (await this.#request("session/prompt", {
        sessionId: session.sessionId,
        prompt: [{ type: "text", text: options.prompt }],
      })) as AcpPromptResult;
      const active = this.#active;
      this.#active = undefined;
      if (!active || active.id !== session.sessionId) {
        throw new Error("ACP active session routing state was lost");
      }
      return {
        sessionId: session.sessionId,
        text: active.text,
        reasoning: active.reasoning,
        ...(result.stopReason ? { stopReason: result.stopReason } : {}),
        timings: {
          queuedMs: startedAt - queuedAt,
          sessionNewMs,
          ...(active.firstTextAt
            ? { firstTextMs: active.firstTextAt - startedAt }
            : {}),
          totalMs: Date.now() - startedAt,
        },
      };
    });
    this.#queue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    this.#reader?.close();
    this.#fail(new Error("ACP connection closed"));
    this.#child?.stdin?.end();
    this.#child?.kill();
  }

  #request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.#closed) return Promise.reject(new Error("ACP connection is closed"));
    const stdin = this.#child?.stdin;
    if (!stdin) return Promise.reject(new Error("ACP process is not running"));
    const id = this.#nextId++;
    const timeoutMs = this.#options.requestTimeoutMs ?? 120_000;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`ACP ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  #respond(id: JsonRpcId, result: unknown): void {
    this.#child?.stdin?.write(
      `${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`,
    );
  }

  #handleLine(line: string): void {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      this.#options.onDiagnostic?.(`Ignored non-JSON ACP output: ${line}`);
      return;
    }

    if (message.id != null && message.method === undefined) {
      const numericId = Number(message.id);
      const pending = this.#pending.get(numericId);
      if (!pending) return;
      this.#pending.delete(numericId);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(new Error(message.error.message ?? "ACP request failed"));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.method === "session/update") {
      const params = message.params ?? {};
      const update = (params.update ?? params) as SessionUpdate;
      const sessionId =
        typeof params.sessionId === "string"
          ? params.sessionId
          : typeof update.sessionId === "string"
            ? update.sessionId
            : undefined;
      if (!this.#active) return;
      if (sessionId && sessionId !== this.#active.id) {
        this.#options.onDiagnostic?.(
          `Ignored update for inactive session ${sessionId}`,
        );
        return;
      }
      const text = textFromContent(update.content);
      if (!text) return;
      if (update.sessionUpdate === "agent_message_chunk") {
        this.#active.text += text;
        this.#active.firstTextAt ??= Date.now();
        this.#active.onText?.(text);
      } else if (update.sessionUpdate === "agent_thought_chunk") {
        this.#active.reasoning += text;
      }
      return;
    }

    if (message.method === "session/request_permission" && message.id != null) {
      const options = Array.isArray(message.params?.options)
        ? (message.params.options as Array<{ optionId?: string; kind?: string }>)
        : [];
      void Promise.resolve(this.#options.onPermission?.(message.params ?? {}))
        .then((requested) => {
          const selected =
            requested ??
            options.find((item) => item.kind === "reject_once")?.optionId ??
            options.find((item) => item.optionId === "reject-once")?.optionId ??
            "reject-once";
          this.#respond(message.id!, {
            outcome: { outcome: "selected", optionId: selected },
          });
        })
        .catch((error) => {
          this.#options.onDiagnostic?.(
            `Permission handler failed: ${errorMessage(error)}`,
          );
          this.#respond(message.id!, {
            outcome: { outcome: "selected", optionId: "reject-once" },
          });
        });
      return;
    }

    if (message.id != null && message.method === "cursor/ask_question") {
      this.#respond(message.id, { outcome: { outcome: "skipped" } });
      return;
    }
    if (message.id != null && message.method === "cursor/create_plan") {
      this.#respond(message.id, { outcome: { outcome: "accepted" } });
    }
  }

  #fail(error: unknown): void {
    const failure = new Error(errorMessage(error));
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(failure);
    }
    this.#pending.clear();
  }
}
