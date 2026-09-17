import type { SessionRunResult } from "./types.js";

export type SessionRequest = {
  prompt: string;
  cwd?: string;
  model?: string;
  mode?: "agent" | "plan" | "ask";
  onText?: (text: string) => void;
};

export type AcpSessionRunner = {
  readonly running: boolean;
  runSession(request: SessionRequest): Promise<SessionRunResult>;
  close(): Promise<void>;
};

type PoolEntry = {
  connection: AcpSessionRunner;
  busy: boolean;
  lastUsedAt: number;
};

type Waiter = {
  resolve: (entry: PoolEntry) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type AcpPoolOptions = {
  maxConnections?: number;
  acquireTimeoutMs?: number;
  idleTimeoutMs?: number;
  createConnection: () => AcpSessionRunner | Promise<AcpSessionRunner>;
};

export type AcpPoolStats = {
  size: number;
  busy: number;
  idle: number;
  waiting: number;
};

export class AcpPool {
  readonly #maxConnections: number;
  readonly #acquireTimeoutMs: number;
  readonly #idleTimeoutMs: number;
  readonly #createConnection: AcpPoolOptions["createConnection"];
  readonly #entries: PoolEntry[] = [];
  readonly #waiters: Waiter[] = [];
  #creating = 0;
  #closed = false;

  constructor(options: AcpPoolOptions) {
    this.#maxConnections = Math.max(1, options.maxConnections ?? 2);
    this.#acquireTimeoutMs = Math.max(1, options.acquireTimeoutMs ?? 30_000);
    this.#idleTimeoutMs = Math.max(0, options.idleTimeoutMs ?? 5 * 60_000);
    this.#createConnection = options.createConnection;
  }

  get stats(): AcpPoolStats {
    const busy = this.#entries.filter((entry) => entry.busy).length;
    return {
      size: this.#entries.length,
      busy,
      idle: this.#entries.length - busy,
      waiting: this.#waiters.length,
    };
  }

  async runSession(request: SessionRequest): Promise<SessionRunResult> {
    const entry = await this.#acquire();
    try {
      return await entry.connection.runSession(request);
    } finally {
      await this.#release(entry);
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    const error = new Error("ACP pool closed");
    for (const waiter of this.#waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    await Promise.allSettled(
      this.#entries.splice(0).map((entry) => entry.connection.close()),
    );
  }

  async #acquire(): Promise<PoolEntry> {
    if (this.#closed) throw new Error("ACP pool is closed");
    await this.#pruneIdle();

    const idle = this.#entries.find(
      (entry) => !entry.busy && entry.connection.running,
    );
    if (idle) {
      idle.busy = true;
      return idle;
    }

    if (this.#entries.length + this.#creating < this.#maxConnections) {
      this.#creating += 1;
      try {
        const connection = await this.#createConnection();
        if (this.#closed) {
          await connection.close();
          throw new Error("ACP pool closed while creating a connection");
        }
        const entry: PoolEntry = {
          connection,
          busy: true,
          lastUsedAt: Date.now(),
        };
        this.#entries.push(entry);
        return entry;
      } finally {
        this.#creating -= 1;
      }
    }

    return new Promise<PoolEntry>((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = this.#waiters.indexOf(waiter);
          if (index >= 0) this.#waiters.splice(index, 1);
          reject(
            new Error(
              `Timed out waiting ${this.#acquireTimeoutMs}ms for an ACP connection`,
            ),
          );
        }, this.#acquireTimeoutMs),
      };
      this.#waiters.push(waiter);
    });
  }

  async #release(entry: PoolEntry): Promise<void> {
    entry.lastUsedAt = Date.now();
    if (this.#closed || !entry.connection.running) {
      this.#remove(entry);
      await entry.connection.close().catch(() => undefined);
      this.#serveWaiterWithNewConnection();
      return;
    }

    const waiter = this.#waiters.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      entry.busy = true;
      waiter.resolve(entry);
      return;
    }
    entry.busy = false;
  }

  async #pruneIdle(): Promise<void> {
    if (this.#idleTimeoutMs === 0) return;
    const cutoff = Date.now() - this.#idleTimeoutMs;
    const expired = this.#entries.filter(
      (entry) => !entry.busy && entry.lastUsedAt < cutoff,
    );
    for (const entry of expired) this.#remove(entry);
    await Promise.allSettled(
      expired.map((entry) => entry.connection.close()),
    );
  }

  #remove(entry: PoolEntry): void {
    const index = this.#entries.indexOf(entry);
    if (index >= 0) this.#entries.splice(index, 1);
  }

  #serveWaiterWithNewConnection(): void {
    const waiter = this.#waiters.shift();
    if (!waiter) return;
    clearTimeout(waiter.timer);
    void this.#acquire().then(waiter.resolve, waiter.reject);
  }
}
