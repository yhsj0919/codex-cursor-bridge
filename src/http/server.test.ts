import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import type { BridgeConfig } from "../config.js";
import type { ToolOutput } from "../tools/types.js";
import { createBridgeServer } from "./server.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "codex-cursor-bridge-"));
  roots.push(root);
  const child = join(root, "project");
  mkdirSync(child);
  const calls: Array<Record<string, unknown>> = [];
  const pool = {
    stats: { size: 1, busy: 0, idle: 1, waiting: 0 },
    async runSession(request: Record<string, unknown>) {
      calls.push(request);
      (request.onText as ((text: string) => void) | undefined)?.("OK");
      return { text: "OK" };
    },
  };
  const config: BridgeConfig = { host: "127.0.0.1", port: 8765, workspace: root, poolSize: 2 };
  const server = createBridgeServer({
    config,
    pool,
    models: [
      { id: "auto", name: "Auto" },
      { id: "gpt-test-high", name: "GPT Test High" },
    ],
  });
  return { root, child, calls, server };
}

async function serve(server: ReturnType<typeof createBridgeServer>) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("Responses server", () => {
  it("routes a request to a validated workspace", async () => {
    const value = fixture();
    const live = await serve(value.server);
    try {
      const response = await fetch(`${live.url}/v1/responses`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-cursor-workspace": value.child },
        body: JSON.stringify({ model: "auto", input: "hello" }),
      });
      expect(response.status).toBe(200);
      expect((await response.json() as { output_text: string }).output_text).toBe("OK");
      expect(value.calls[0]?.cwd).toBe(value.child);
    } finally {
      await live.close();
    }
  });

  it("rejects a workspace outside the configured root", async () => {
    const value = fixture();
    const live = await serve(value.server);
    try {
      const response = await fetch(`${live.url}/v1/responses`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-cursor-workspace": tmpdir() },
        body: JSON.stringify({ model: "auto", input: "hello" }),
      });
      expect(response.status).toBe(400);
      expect((await response.json() as { error: { code: string } }).error.code).toBe("invalid_workspace");
    } finally {
      await live.close();
    }
  });

  it("emits the complete text SSE event sequence", async () => {
    const value = fixture();
    const live = await serve(value.server);
    try {
      const response = await fetch(`${live.url}/v1/responses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "auto", input: "hello", stream: true }),
      });
      const text = await response.text();
      expect(text).toContain("event: response.created");
      expect(text).toContain("event: response.output_text.delta");
      expect(text).toContain("event: response.output_text.done");
      expect(text).toContain("event: response.completed");
      expect(text).toMatch(/response\.created[\s\S]*response\.output_text\.delta[\s\S]*response\.completed/);
    } finally {
      await live.close();
    }
  });

  it("accepts a tool output turn with no ordinary input text", async () => {
    const value = fixture();
    let phase = 0;
    const pending = { callId: "call_test", itemId: "fc_test", name: "run", arguments: "{}", responseType: "function" as const };
    const session = {
      async start() { phase = 1; },
      async collect() { return { status: "tool_calls" as const, text: "", calls: [pending] }; },
      async resume(outputs: ToolOutput[]) { phase = 2; expect(outputs[0]?.output).toBe("done"); return { status: "completed" as const, text: "finished", calls: [] as [] }; },
      has(callId: string) { return callId === pending.callId; },
      async close() { /* nothing */ },
    };
    const server = createBridgeServer({
      config: { host: "127.0.0.1", port: 8765, workspace: value.root, poolSize: 2 },
      pool: { stats: {}, async runSession() { return { text: "unused" }; } },
      models: [{ id: "auto", name: "Auto" }],
      createToolSession: () => session,
    });
    const live = await serve(server);
    try {
      const first = await fetch(`${live.url}/v1/responses`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "auto", input: "use tool", tools: [{ type: "function", name: "run", parameters: { type: "object" } }] }),
      });
      expect(first.status).toBe(200);
      const second = await fetch(`${live.url}/v1/responses`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "auto", input: [{ type: "function_call_output", call_id: "call_test", output: "done" }] }),
      });
      expect(second.status).toBe(200);
      expect((await second.json() as { output_text: string }).output_text).toBe("finished");
      expect(phase).toBe(2);
    } finally {
      await live.close();
      await new Promise<void>((resolve) => value.server.close(() => resolve()));
    }
  });

  it("continues a tool session when the desktop session header changes", async () => {
    const value = fixture();
    const pending = { callId: "call_header_change", itemId: "fc_header_change", name: "run", arguments: "{}", responseType: "function" as const };
    const session = {
      async start() { /* nothing */ },
      async collect() { return { status: "tool_calls" as const, text: "", calls: [pending] }; },
      async resume(outputs: ToolOutput[]) {
        expect(outputs.map((output) => output.callId)).toEqual([pending.callId]);
        return { status: "completed" as const, text: "continued", calls: [] as [] };
      },
      has(callId: string) { return callId === pending.callId; },
      async close() { /* nothing */ },
    };
    const server = createBridgeServer({
      config: { host: "127.0.0.1", port: 8765, workspace: value.root, poolSize: 2 },
      pool: { stats: {}, async runSession() { return { text: "unused" }; } },
      models: [{ id: "auto", name: "Auto" }],
      createToolSession: () => session,
    });
    const live = await serve(server);
    try {
      const first = await fetch(`${live.url}/v1/responses`, {
        method: "POST", headers: { "content-type": "application/json", "x-codex-session-id": "before-approval" },
        body: JSON.stringify({ model: "auto", input: "use tool", tools: [{ type: "function", name: "run", parameters: { type: "object" } }] }),
      });
      expect(first.status).toBe(200);
      const second = await fetch(`${live.url}/v1/responses`, {
        method: "POST", headers: { "content-type": "application/json", "x-codex-session-id": "after-approval" },
        body: JSON.stringify({ model: "auto", input: [{ type: "function_call_output", call_id: pending.callId, output: "done" }] }),
      });
      expect(second.status).toBe(200);
      expect((await second.json() as { output_text: string }).output_text).toBe("continued");
    } finally {
      await live.close();
      await new Promise<void>((resolve) => value.server.close(() => resolve()));
    }
  });

  it("starts a new turn when historical tool outputs precede a new user message", async () => {
    const value = fixture();
    let startedWith = "";
    const session = {
      async start(prompt: string) { startedWith = prompt; },
      async collect() { return { status: "completed" as const, text: "new turn completed", calls: [] as [] }; },
      async resume() { throw new Error("must not resume an expired historical call"); },
      has() { return false; },
      async close() { /* nothing */ },
    };
    const server = createBridgeServer({
      config: { host: "127.0.0.1", port: 8765, workspace: value.root, poolSize: 2 },
      pool: { stats: {}, async runSession() { return { text: "unused" }; } },
      models: [{ id: "auto", name: "Auto" }],
      createToolSession: () => session,
    });
    const live = await serve(server);
    try {
      const response = await fetch(`${live.url}/v1/responses`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "auto",
          tools: [{ type: "function", name: "run", parameters: { type: "object" } }],
          input: [
            { type: "function_call_output", call_id: "call_expired", output: "old result" },
            { type: "message", role: "assistant", content: [{ type: "output_text", text: "old response" }] },
            { type: "message", role: "user", content: [{ type: "input_text", text: "retry deletion" }] },
          ],
        }),
      });
      expect(response.status).toBe(200);
      expect((await response.json() as { output_text: string }).output_text).toBe("new turn completed");
      expect(startedWith).toBe("retry deletion");
    } finally {
      await live.close();
      await new Promise<void>((resolve) => value.server.close(() => resolve()));
    }
  });

  it("ignores historical tool outputs during a multi-step tool session", async () => {
    const value = fixture();
    let phase = 0;
    const firstCall = { callId: "call_first", itemId: "fc_first", name: "run", arguments: "{}", responseType: "function" as const };
    const secondCall = { callId: "call_second", itemId: "fc_second", name: "run", arguments: "{}", responseType: "function" as const };
    const session = {
      async start() { phase = 1; },
      async collect() { return { status: "tool_calls" as const, text: "", calls: [firstCall] }; },
      async resume(outputs: ToolOutput[]) {
        if (phase === 1) {
          expect(outputs.map((output) => output.callId)).toEqual([firstCall.callId]);
          phase = 2;
          return { status: "tool_calls" as const, text: "", calls: [secondCall] };
        }
        expect(outputs.map((output) => output.callId)).toEqual([secondCall.callId]);
        phase = 3;
        return { status: "completed" as const, text: "verified", calls: [] as [] };
      },
      has(callId: string) {
        return phase === 1 ? callId === firstCall.callId : callId === secondCall.callId;
      },
      async close() { /* nothing */ },
    };
    const server = createBridgeServer({
      config: { host: "127.0.0.1", port: 8765, workspace: value.root, poolSize: 2 },
      pool: { stats: {}, async runSession() { return { text: "unused" }; } },
      models: [{ id: "auto", name: "Auto" }],
      createToolSession: () => session,
    });
    const live = await serve(server);
    try {
      const first = await fetch(`${live.url}/v1/responses`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "auto", input: "use tools", tools: [{ type: "function", name: "run", parameters: { type: "object" } }] }),
      });
      expect(first.status).toBe(200);
      const second = await fetch(`${live.url}/v1/responses`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "auto", input: [{ type: "function_call_output", call_id: firstCall.callId, output: "deleted" }] }),
      });
      expect(second.status).toBe(200);
      const third = await fetch(`${live.url}/v1/responses`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "auto", input: [
          { type: "function_call_output", call_id: firstCall.callId, output: "deleted" },
          { type: "function_call_output", call_id: secondCall.callId, output: "missing" },
        ] }),
      });
      expect(third.status).toBe(200);
      expect((await third.json() as { output_text: string }).output_text).toBe("verified");
      expect(phase).toBe(3);
    } finally {
      await live.close();
      await new Promise<void>((resolve) => value.server.close(() => resolve()));
    }
  });
});
