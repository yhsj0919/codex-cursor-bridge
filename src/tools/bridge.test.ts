import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";

import { ToolBridge } from "./bridge.js";

const bridges: ToolBridge[] = [];
const clients: Client[] = [];

afterEach(async () => {
  await Promise.allSettled(clients.splice(0).map((client) => client.close()));
  await Promise.allSettled(bridges.splice(0).map((bridge) => bridge.close()));
});

describe("ToolBridge", () => {
  it("parks a tool call until Codex supplies its output", async () => {
    const bridge = new ToolBridge([
      {
        name: "read_file",
        description: "Read a file",
        inputSchema: { type: "object", properties: { path: { type: "string" } } },
        responseType: "function",
      },
    ]);
    bridges.push(bridge);
    await bridge.start();

    const client = new Client({ name: "test", version: "1.0.0" });
    clients.push(client);
    const descriptor = bridge.descriptor;
    const transport = new StreamableHTTPClientTransport(new URL(descriptor.url), {
      requestInit: { headers: { Authorization: descriptor.headers[0]!.value } },
    });
    await client.connect(
      transport as unknown as Parameters<Client["connect"]>[0],
    );
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(["read_file"]);

    const called = new Promise<void>((resolve) => bridge.onCall(resolve));
    const resultPromise = client.callTool({ name: "read_file", arguments: { path: "a.txt" } });
    await called;
    const pending = bridge.pending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.arguments).toBe('{"path":"a.txt"}');

    bridge.resolve([{ callId: pending[0]!.callId, output: "contents" }]);
    const result = await resultPromise;
    expect(result.content).toEqual([{ type: "text", text: "contents" }]);
  });
});
