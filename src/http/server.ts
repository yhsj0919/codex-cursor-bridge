import { randomUUID } from "node:crypto";
import { existsSync, realpathSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { isAbsolute, relative, resolve } from "node:path";

import type { AcpPool } from "../acp/pool.js";
import type { BridgeConfig } from "../config.js";
import type { CursorAccountInfo } from "../cursor/account.js";
import type { CursorModel } from "../cursor/models.js";
import type { ToolSession, ToolTurn } from "../tools/session.js";
import type { ToolDefinition, ToolOutput } from "../tools/types.js";
import {
  buildModelCatalog,
  resolveCatalogModel,
  UnsupportedReasoningEffortError,
} from "../cursor/model-catalog.js";

type ResponsesBody = {
  model?: string;
  input?: unknown;
  stream?: boolean;
  reasoning?: { effort?: string };
  tools?: unknown[];
};

type SessionRunner = {
  readonly stats: unknown;
  runSession(request: { prompt: string; cwd?: string; model?: string; mode?: "agent" | "plan" | "ask"; onText?: (text: string) => void; signal?: AbortSignal }): Promise<{ text: string }>;
};

type ToolSessionLike = Pick<ToolSession, "start" | "collect" | "resume" | "has" | "close">;

type StoredToolSession = { session: ToolSessionLike; expiresAt: number };

type ToolDiagnostics = {
  receivedAt: string;
  raw: Array<{ type: string; name?: string }>;
  bridged: Array<{ type: string; name: string }>;
};

function json(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function readJson(req: IncomingMessage): Promise<ResponsesBody> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 2 * 1024 * 1024) throw new Error("Request body exceeds 2 MiB");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as ResponsesBody;
}

function inputText(input: unknown): string {
  if (typeof input === "string") return input;
  if (!Array.isArray(input)) return "";
  const parts: string[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const record = item as { role?: unknown; content?: unknown };
    const role = typeof record.role === "string" ? record.role : "user";
    if (typeof record.content === "string") {
      parts.push(`${role}: ${record.content}`);
      continue;
    }
    if (!Array.isArray(record.content)) continue;
    const text = record.content
      .map((part) => {
        if (!part || typeof part !== "object") return "";
        const value = (part as { text?: unknown }).text;
        return typeof value === "string" ? value : "";
      })
      .join("");
    if (text) parts.push(`${role}: ${text}`);
  }
  return parts.join("\n\n");
}

function userTextAfterLastToolOutput(input: unknown): string {
  if (!Array.isArray(input)) return "";
  let lastOutputIndex = -1;
  for (let index = 0; index < input.length; index += 1) {
    const item = input[index];
    if (!item || typeof item !== "object") continue;
    const type = (item as { type?: unknown }).type;
    if (type === "function_call_output" || type === "custom_tool_call_output") lastOutputIndex = index;
  }
  return input.slice(lastOutputIndex + 1).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as { role?: unknown; content?: unknown };
    if (record.role !== "user") return [];
    if (typeof record.content === "string") return [record.content];
    if (!Array.isArray(record.content)) return [];
    return [record.content.map((part) => {
      if (!part || typeof part !== "object") return "";
      const text = (part as { text?: unknown }).text;
      return typeof text === "string" ? text : "";
    }).join("")];
  }).filter(Boolean).join("\n\n");
}

function responseObject(
  id: string,
  model: string,
  text: string,
  messageId = `msg_${randomUUID().replaceAll("-", "")}`,
) {
  return {
    id,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "completed",
    error: null,
    model,
    output: [
      {
        id: messageId,
        type: "message",
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text, annotations: [] }],
      },
    ],
    output_text: text,
    tools: [],
    tool_choice: "auto",
    parallel_tool_calls: true,
  };
}

function sse(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function requestWorkspace(req: IncomingMessage, root: string): string {
  const header = req.headers["x-cursor-workspace"];
  if (!header) return realpathSync(root);
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return realpathSync(root);
  const candidate = realpathSync(resolve(raw));
  const base = realpathSync(root);
  const child = relative(base, candidate);
  if (!existsSync(candidate) || !statSync(candidate).isDirectory() || child.startsWith("..") || isAbsolute(child)) {
    throw new Error(`Workspace must be an existing directory under ${base}`);
  }
  return candidate;
}

export function createBridgeServer(options: {
  config: BridgeConfig;
  pool: AcpPool | SessionRunner;
  models: CursorModel[];
  createToolSession?: (tools: ToolDefinition[]) => ToolSessionLike;
  toolSessionTtlMs?: number;
  maxToolSessions?: number;
  getCursorAccount?: () => Promise<CursorAccountInfo>;
}) {
  const { config, pool, models } = options;
  const catalog = buildModelCatalog(models);
  const toolSessions = new Map<string, StoredToolSession>();
  const toolSessionTtlMs = options.toolSessionTtlMs ?? 10 * 60_000;
  const maxToolSessions = options.maxToolSessions ?? 128;
  let lastToolDiagnostics: ToolDiagnostics | null = null;
  const cleanup = (): void => {
    const now = Date.now();
    const expired = new Set<ToolSessionLike>();
    for (const [callId, stored] of toolSessions) {
      if (stored.expiresAt <= now) {
        toolSessions.delete(callId);
        expired.add(stored.session);
      }
    }
    for (const session of expired) void session.close();
  };
  const cleanupTimer = setInterval(cleanup, Math.min(toolSessionTtlMs, 60_000));
  cleanupTimer.unref();

  const parseTools = (raw: unknown[] | undefined): ToolDefinition[] => (raw ?? []).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const tool = item as Record<string, unknown>;
    if ((tool.type !== "function" && tool.type !== "custom") || typeof tool.name !== "string") return [];
    return [{
      name: tool.name,
      ...(typeof tool.description === "string" ? { description: tool.description } : {}),
      inputSchema: tool.type === "function" && tool.parameters && typeof tool.parameters === "object"
        ? tool.parameters as Record<string, unknown>
        : { type: "object", properties: { input: { type: "string" } } },
      responseType: tool.type,
    } satisfies ToolDefinition];
  });

  const parseOutputs = (input: unknown): ToolOutput[] => !Array.isArray(input) ? [] : input.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const value = item as Record<string, unknown>;
    if ((value.type !== "function_call_output" && value.type !== "custom_tool_call_output") || typeof value.call_id !== "string") return [];
    return [{ callId: value.call_id, output: typeof value.output === "string" ? value.output : JSON.stringify(value.output ?? "") }];
  });

  const toolResponse = (id: string, model: string, turn: ToolTurn) => ({
    id, object: "response", created_at: Math.floor(Date.now() / 1000), status: "completed", error: null, model,
    output: [
      ...(turn.text ? [{ id: `msg_${randomUUID().replaceAll("-", "")}`, type: "message", status: "completed", role: "assistant", content: [{ type: "output_text", text: turn.text, annotations: [] }] }] : []),
      ...turn.calls.map((call) => call.responseType === "custom"
        ? { id: call.itemId, type: "custom_tool_call", status: "completed", call_id: call.callId, name: call.name, input: call.arguments }
        : { id: call.itemId, type: "function_call", status: "completed", call_id: call.callId, name: call.name, arguments: call.arguments }),
    ],
    output_text: turn.text, tools: [], tool_choice: "auto", parallel_tool_calls: true,
  });
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      if (req.method === "GET" && url.pathname === "/healthz") {
        json(res, 200, { status: "ok", pool: pool.stats, lastToolDiagnostics });
        return;
      }
      if (req.method === "GET" && url.pathname === "/v1/models") {
        json(res, 200, {
          object: "list",
          data: catalog.map((model) => ({
            id: model.id,
            object: "model",
            owned_by: "cursor",
            name: model.name,
          })),
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/v1/cursor/account") {
        if (!options.getCursorAccount) {
          json(res, 501, { error: { message: "Cursor account information is unavailable", code: "not_configured" } });
          return;
        }
        json(res, 200, await options.getCursorAccount());
        return;
      }
      if (req.method !== "POST" || url.pathname !== "/v1/responses") {
        json(res, 404, { error: { message: "Not found", code: "not_found" } });
        return;
      }

      const body = await readJson(req);
      const abort = new AbortController();
      res.once("close", () => {
        if (!res.writableEnded) abort.abort();
      });
      const prompt = inputText(body.input);
      const submittedOutputs = parseOutputs(body.input);
      if (!prompt && submittedOutputs.length === 0) {
        json(res, 400, {
          error: { message: "input must contain text", code: "invalid_input" },
        });
        return;
      }
      let resolved;
      try {
        resolved = resolveCatalogModel(catalog, body.model, body.reasoning?.effort);
      } catch (error) {
        const unsupported = error instanceof UnsupportedReasoningEffortError;
        json(res, unsupported ? 400 : 404, {
          error: {
            message: error instanceof Error ? error.message : String(error),
            code: unsupported ? error.code : "model_not_found",
          },
        });
        return;
      }
      const model = resolved.catalogId;
      const id = `resp_${randomUUID().replaceAll("-", "")}`;
      const definitions = parseTools(body.tools);
      lastToolDiagnostics = {
        receivedAt: new Date().toISOString(),
        raw: (body.tools ?? []).flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const tool = item as Record<string, unknown>;
          return [{
            type: typeof tool.type === "string" ? tool.type : "unknown",
            ...(typeof tool.name === "string" ? { name: tool.name } : {}),
          }];
        }),
        bridged: definitions.map((tool) => ({ type: tool.responseType, name: tool.name })),
      };
      console.log(`[tools] ${JSON.stringify(lastToolDiagnostics)}`);
      let workspace: string;
      try {
        workspace = requestWorkspace(req, config.workspace);
      } catch (error) {
        json(res, 400, { error: { message: error instanceof Error ? error.message : String(error), code: "invalid_workspace" } });
        return;
      }

      if (submittedOutputs.length > 0 || definitions.length > 0) {
        if (!options.createToolSession) throw new Error("Tool bridge is not configured");
        let session: ToolSessionLike;
        let turn: ToolTurn;
        if (submittedOutputs.length > 0) {
          cleanup();
          const currentOutputs = submittedOutputs.filter((output) => {
            const candidate = toolSessions.get(output.callId);
            return candidate?.session.has(output.callId);
          });
          const stored = currentOutputs.length > 0
            ? toolSessions.get(currentOutputs[0]!.callId)
            : undefined;
          if (stored) {
            session = stored.session;
            if (!currentOutputs.every((output) => toolSessions.get(output.callId)?.session === session)) {
              json(res, 409, { error: { message: "Tool session is missing or expired", code: "tool_session_expired" } });
              return;
            }
            for (const output of currentOutputs) toolSessions.delete(output.callId);
            turn = await session.resume(currentOutputs);
          } else {
            // Codex sends prior tool outputs again as conversation history. If
            // a new user message follows them, this is a new turn rather than
            // a continuation of the expired call.
            const freshPrompt = userTextAfterLastToolOutput(body.input);
            if (!freshPrompt || definitions.length === 0) {
              json(res, 409, { error: { message: "Tool session is missing or expired", code: "tool_session_expired" } });
              return;
            }
            if (new Set([...toolSessions.values()].map((entry) => entry.session)).size >= maxToolSessions) {
              json(res, 503, { error: { message: "Too many pending tool sessions", code: "tool_session_limit" } });
              return;
            }
            session = options.createToolSession(definitions);
            await session.start(freshPrompt, workspace, resolved.cursorId);
            turn = await session.collect();
          }
        } else {
          cleanup();
          if (new Set([...toolSessions.values()].map((entry) => entry.session)).size >= maxToolSessions) {
            json(res, 503, { error: { message: "Too many pending tool sessions", code: "tool_session_limit" } });
            return;
          }
          session = options.createToolSession(definitions);
          await session.start(prompt, workspace, resolved.cursorId);
          turn = await session.collect();
        }
        if (turn.status === "tool_calls") {
          // A Responses continuation may arrive with a different
          // x-codex-session-id after an approval UI round trip. The random
          // call_id is the stable continuation key; binding it to transient
          // request headers makes valid tool results look expired.
          const stored = { session, expiresAt: Date.now() + toolSessionTtlMs };
          for (const call of turn.calls) toolSessions.set(call.callId, stored);
        }
        const response = toolResponse(id, model, turn);
        if (body.stream) {
          res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" });
          sse(res, "response.created", { type: "response.created", response: { id, object: "response", status: "in_progress", model, output: [] } });
          for (let index = 0; index < response.output.length; index += 1) {
            const item = response.output[index]!;
            const eventItem = item as Record<string, unknown>;
            sse(res, "response.output_item.added", { type: "response.output_item.added", response_id: id, output_index: index, item });
            if (item.type === "function_call") {
              sse(res, "response.function_call_arguments.delta", { type: "response.function_call_arguments.delta", response_id: id, item_id: item.id, output_index: index, delta: eventItem.arguments });
              sse(res, "response.function_call_arguments.done", { type: "response.function_call_arguments.done", response_id: id, item_id: item.id, output_index: index, arguments: eventItem.arguments });
            } else if (item.type === "custom_tool_call") {
              sse(res, "response.custom_tool_call_input.delta", { type: "response.custom_tool_call_input.delta", response_id: id, item_id: item.id, output_index: index, delta: eventItem.input });
              sse(res, "response.custom_tool_call_input.done", { type: "response.custom_tool_call_input.done", response_id: id, item_id: item.id, output_index: index, input: eventItem.input });
            }
            sse(res, "response.output_item.done", { type: "response.output_item.done", response_id: id, output_index: index, item });
          }
          sse(res, "response.completed", { type: "response.completed", response });
          res.end("data: [DONE]\n\n");
        } else json(res, 200, response);
        return;
      }

      if (body.stream) {
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        sse(res, "response.created", {
          type: "response.created",
          response: { id, object: "response", status: "in_progress", model, output: [] },
        });
        const messageId = `msg_${randomUUID().replaceAll("-", "")}`;
        const baseEvent = {
          response_id: id,
          item_id: messageId,
          output_index: 0,
          content_index: 0,
        };
        sse(res, "response.output_item.added", {
          type: "response.output_item.added",
          response_id: id,
          output_index: 0,
          item: {
            id: messageId,
            type: "message",
            status: "in_progress",
            role: "assistant",
            content: [],
          },
        });
        sse(res, "response.content_part.added", {
          type: "response.content_part.added",
          ...baseEvent,
          part: { type: "output_text", text: "", annotations: [] },
        });
        const result = await pool.runSession({
          prompt,
          cwd: workspace,
          model: resolved.cursorId,
          mode: "agent",
          onText: (text) =>
            sse(res, "response.output_text.delta", {
              type: "response.output_text.delta",
              ...baseEvent,
              delta: text,
            }),
          signal: abort.signal,
        });
        sse(res, "response.output_text.done", {
          type: "response.output_text.done",
          ...baseEvent,
          text: result.text,
        });
        sse(res, "response.content_part.done", {
          type: "response.content_part.done",
          ...baseEvent,
          part: { type: "output_text", text: result.text, annotations: [] },
        });
        sse(res, "response.output_item.done", {
          type: "response.output_item.done",
          response_id: id,
          output_index: 0,
          item: {
            id: messageId,
            type: "message",
            status: "completed",
            role: "assistant",
            content: [
              { type: "output_text", text: result.text, annotations: [] },
            ],
          },
        });
        const response = responseObject(id, model, result.text, messageId);
        sse(res, "response.completed", { type: "response.completed", response });
        res.end("data: [DONE]\n\n");
        return;
      }

      const result = await pool.runSession({
        prompt,
        cwd: workspace,
        model: resolved.cursorId,
        mode: "agent",
        signal: abort.signal,
      });
      json(res, 200, responseObject(id, model, result.text));
    } catch (error) {
      if (res.headersSent) {
        sse(res, "error", {
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        });
        res.end();
        return;
      }
      json(res, 500, {
        error: {
          message: error instanceof Error ? error.message : String(error),
          code: "bridge_error",
        },
      });
    }
  }).on("close", () => {
    clearInterval(cleanupTimer);
    const sessions = new Set([...toolSessions.values()].map((entry) => entry.session));
    toolSessions.clear();
    for (const session of sessions) void session.close();
  });
}
