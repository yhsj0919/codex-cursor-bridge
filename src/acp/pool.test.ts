import { describe, expect, it } from "vitest";

import { AcpPool, type AcpSessionRunner, type SessionRequest } from "./pool.js";
import type { SessionRunResult } from "./types.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class FakeConnection implements AcpSessionRunner {
  running = true;
  readonly calls: string[] = [];
  readonly gates: Array<ReturnType<typeof deferred<void>>> = [];

  async runSession(request: SessionRequest): Promise<SessionRunResult> {
    this.calls.push(request.prompt);
    const gate = this.gates.shift();
    if (gate) await gate.promise;
    return {
      sessionId: `${this.calls.length}`,
      text: request.prompt,
      reasoning: "",
      timings: { queuedMs: 0, sessionNewMs: 0, totalMs: 0 },
    };
  }

  async close(): Promise<void> {
    this.running = false;
  }
}

describe("AcpPool", () => {
  it("reuses an idle connection", async () => {
    const created: FakeConnection[] = [];
    const pool = new AcpPool({
      maxConnections: 2,
      createConnection: () => {
        const connection = new FakeConnection();
        created.push(connection);
        return connection;
      },
    });

    await pool.runSession({ prompt: "one" });
    await pool.runSession({ prompt: "two" });

    expect(created).toHaveLength(1);
    expect(created[0]?.calls).toEqual(["one", "two"]);
    expect(pool.stats).toEqual({ size: 1, busy: 0, idle: 1, waiting: 0 });
    await pool.close();
  });

  it("uses separate connections for concurrent sessions", async () => {
    const created: FakeConnection[] = [];
    const gates = [deferred<void>(), deferred<void>()];
    const pool = new AcpPool({
      maxConnections: 2,
      createConnection: () => {
        const connection = new FakeConnection();
        connection.gates.push(gates[created.length]!);
        created.push(connection);
        return connection;
      },
    });

    const first = pool.runSession({ prompt: "one" });
    const second = pool.runSession({ prompt: "two" });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(created).toHaveLength(2);
    expect(pool.stats.busy).toBe(2);
    gates[0]!.resolve();
    gates[1]!.resolve();
    await Promise.all([first, second]);
    await pool.close();
  });

  it("queues when the pool is full", async () => {
    const gate = deferred<void>();
    const connection = new FakeConnection();
    connection.gates.push(gate);
    const pool = new AcpPool({
      maxConnections: 1,
      createConnection: () => connection,
    });

    const first = pool.runSession({ prompt: "one" });
    const second = pool.runSession({ prompt: "two" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(pool.stats.waiting).toBe(1);

    gate.resolve();
    await Promise.all([first, second]);
    expect(connection.calls).toEqual(["one", "two"]);
    await pool.close();
  });

  it("replaces a connection that dies during a request", async () => {
    const created: FakeConnection[] = [];
    const pool = new AcpPool({
      maxConnections: 1,
      createConnection: () => {
        const connection = new FakeConnection();
        if (created.length === 0) {
          connection.runSession = async () => {
            connection.running = false;
            throw new Error("ACP crashed");
          };
        }
        created.push(connection);
        return connection;
      },
    });

    await expect(pool.runSession({ prompt: "first" })).rejects.toThrow("ACP crashed");
    await expect(pool.runSession({ prompt: "second" })).resolves.toMatchObject({ text: "second" });
    expect(created).toHaveLength(2);
    await pool.close();
  });
});
