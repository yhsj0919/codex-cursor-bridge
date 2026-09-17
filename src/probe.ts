import { AcpConnection } from "./acp/connection.js";
import { findCursorAgent } from "./cursor/discovery.js";

const agent = await findCursorAgent();
const cwd = process.env.CURSOR_BRIDGE_WORKSPACE ?? process.cwd();
const connection = new AcpConnection({
  command: agent.command,
  args: [...agent.prefixArgs, "acp"],
  cwd,
  env: agent.env,
  skipAuthenticate: true,
  onDiagnostic: (message) => console.error(`[ACP] ${message}`),
});

try {
  await connection.start();
  for (let index = 1; index <= 3; index += 1) {
    const result = await connection.runSession({
      prompt: "Reply with exactly OK.",
      model: "auto",
      mode: "agent",
    });
    console.log(
      JSON.stringify(
        {
          request: index,
          text: result.text,
          stopReason: result.stopReason,
          timings: result.timings,
        },
        null,
        2,
      ),
    );
  }
} finally {
  await connection.close();
}
