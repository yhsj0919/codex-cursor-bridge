import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { AcpConnection } from "./connection.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "..", "..", "test", "fixtures", "fake-acp.mjs");
const connections: AcpConnection[] = [];

afterEach(async () => {
  await Promise.all(connections.splice(0).map((connection) => connection.close()));
});

describe("AcpConnection", () => {
  it("reuses one process while creating isolated sessions", async () => {
    const connection = new AcpConnection({
      command: process.execPath,
      args: [fixture],
      cwd: process.cwd(),
      skipAuthenticate: true,
      requestTimeoutMs: 5_000,
    });
    connections.push(connection);

    const first = await connection.runSession({ prompt: "one", model: "auto" });
    const second = await connection.runSession({ prompt: "two", model: "auto" });

    expect(first.sessionId).toBe("session-1");
    expect(first.text).toBe("reply:session-1");
    expect(second.sessionId).toBe("session-2");
    expect(second.text).toBe("reply:session-2");
    expect(connection.running).toBe(true);
  });

  it("serializes concurrent calls on one connection", async () => {
    const connection = new AcpConnection({
      command: process.execPath,
      args: [fixture],
      cwd: process.cwd(),
      skipAuthenticate: true,
      requestTimeoutMs: 5_000,
    });
    connections.push(connection);

    const [first, second] = await Promise.all([
      connection.runSession({ prompt: "one" }),
      connection.runSession({ prompt: "two" }),
    ]);

    expect(first.text).toBe("reply:session-1");
    expect(second.text).toBe("reply:session-2");
  });
});
