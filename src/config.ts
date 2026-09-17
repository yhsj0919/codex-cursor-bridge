export type BridgeConfig = {
  host: string;
  port: number;
  workspace: string;
  poolSize: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  const port = Number(env.CURSOR_BRIDGE_PORT ?? 8765);
  const poolSize = Number(env.CURSOR_BRIDGE_POOL_SIZE ?? 2);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("CURSOR_BRIDGE_PORT must be an integer from 1 to 65535");
  }
  if (!Number.isInteger(poolSize) || poolSize < 1 || poolSize > 8) {
    throw new Error("CURSOR_BRIDGE_POOL_SIZE must be an integer from 1 to 8");
  }
  return {
    host: env.CURSOR_BRIDGE_HOST?.trim() || "127.0.0.1",
    port,
    workspace: env.CURSOR_BRIDGE_WORKSPACE?.trim() || process.cwd(),
    poolSize,
  };
}
