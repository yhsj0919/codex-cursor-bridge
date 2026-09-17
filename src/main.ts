import { AcpConnection } from "./acp/connection.js";
import { AcpPool } from "./acp/pool.js";
import { loadConfig } from "./config.js";
import { findCursorAgent } from "./cursor/discovery.js";
import { listCursorModels } from "./cursor/models.js";
import { createBridgeServer } from "./http/server.js";

const config = loadConfig();
const agent = await findCursorAgent();
const models = await listCursorModels(agent);
const pool = new AcpPool({
  maxConnections: config.poolSize,
  createConnection: () =>
    new AcpConnection({
      command: agent.command,
      args: [...agent.prefixArgs, "--workspace", config.workspace, "acp"],
      cwd: config.workspace,
      env: agent.env,
      skipAuthenticate: true,
    }),
});
const server = createBridgeServer({ config, pool, models });

server.listen(config.port, config.host, () => {
  console.log(`codex-cursor-bridge listening on http://${config.host}:${config.port}`);
  console.log(`- models: ${models.length}`);
  console.log(`- ACP pool size: ${config.poolSize}`);
  console.log(`- workspace: ${config.workspace}`);
});

async function shutdown(): Promise<void> {
  server.close();
  await pool.close();
}

process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));
