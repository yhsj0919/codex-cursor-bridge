import readline from "node:readline";

let sessionCounter = 0;
const input = readline.createInterface({ input: process.stdin });

function send(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

input.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: 1 } });
    return;
  }
  if (message.method === "authenticate") {
    send({ jsonrpc: "2.0", id: message.id, result: {} });
    return;
  }
  if (message.method === "session/new") {
    sessionCounter += 1;
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: { sessionId: `session-${sessionCounter}` },
    });
    return;
  }
  if (message.method === "session/set_config_option") {
    send({ jsonrpc: "2.0", id: message.id, result: {} });
    return;
  }
  if (message.method === "session/prompt") {
    const sessionId = message.params.sessionId;
    send({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { text: `reply:${sessionId}` },
        },
      },
    });
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: { stopReason: "end_turn" },
    });
  }
});
