import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { ToolSession } from "./session.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "..", "..", "test", "fixtures", "fake-acp.mjs");
const sessions: ToolSession[] = [];

afterEach(async () => {
  await Promise.allSettled(sessions.splice(0).map((session) => session.close()));
});

describe("ToolSession native permissions", () => {
  it("blocks native ACP tools and reports an actionable reason", async () => {
    const session = new ToolSession(
      {
        command: process.execPath,
        args: [fixture],
        cwd: process.cwd(),
        skipAuthenticate: true,
        requestTimeoutMs: 5_000,
      },
      [{
        name: "shell_command",
        inputSchema: { type: "object" },
        responseType: "function",
      }],
    );
    sessions.push(session);

    await session.start("native-delete", process.cwd(), "auto");
    const turn = await session.collect();

    expect(turn.status).toBe("completed");
    expect(turn.text).toContain("[native_tool_blocked]");
    expect(turn.text).toContain('Cursor native tool "Delete" was blocked');
    expect(turn.text).toContain('"path":"current-model.txt"');
    expect(turn.text).toContain("equivalent Codex tool");
  });
});
