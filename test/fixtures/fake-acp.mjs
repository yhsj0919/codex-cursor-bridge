import readline from "node:readline";

let sessionCounter = 0;
let pendingPermissionPrompt;
const input = readline.createInterface({ input: process.stdin });

function send(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

input.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === 900 && message.method === undefined) {
    if (pendingPermissionPrompt) {
      send({
        jsonrpc: "2.0",
        id: pendingPermissionPrompt.id,
        result: { stopReason: "end_turn" },
      });
      pendingPermissionPrompt = undefined;
    }
    return;
  }
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
    const promptText = message.params.prompt?.[0]?.text ?? "";
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
    if (promptText === "permission") {
      pendingPermissionPrompt = message;
      send({
        jsonrpc: "2.0",
        id: 900,
        method: "session/request_permission",
        params: {
          sessionId,
          toolCall: { title: "shell" },
          options: [
            { optionId: "allow-once", kind: "allow_once" },
            { optionId: "reject-once", kind: "reject_once" },
          ],
        },
      });
      return;
    }
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: { stopReason: "end_turn" },
  });
}
});
