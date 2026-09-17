import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import type { AcpPool } from "../acp/pool.js";
import type { BridgeConfig } from "../config.js";
import type { CursorModel } from "../cursor/models.js";
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

export function createBridgeServer(options: {
  config: BridgeConfig;
  pool: AcpPool;
  models: CursorModel[];
}) {
  const { config, pool, models } = options;
  const catalog = buildModelCatalog(models);
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      if (req.method === "GET" && url.pathname === "/healthz") {
        json(res, 200, { status: "ok", pool: pool.stats });
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
      if (req.method !== "POST" || url.pathname !== "/v1/responses") {
        json(res, 404, { error: { message: "Not found", code: "not_found" } });
        return;
      }

      const body = await readJson(req);
      const prompt = inputText(body.input);
      if (!prompt) {
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
          model: resolved.cursorId,
          mode: "agent",
          onText: (text) =>
            sse(res, "response.output_text.delta", {
              type: "response.output_text.delta",
              ...baseEvent,
              delta: text,
            }),
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
        model: resolved.cursorId,
        mode: "agent",
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
  });
}
