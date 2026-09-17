import { spawn } from "node:child_process";

import type { CursorAgentCommand } from "./discovery.js";

export type CursorModel = { id: string; name: string };

export function parseCursorModels(output: string): CursorModel[] {
  const models = new Map<string, CursorModel>();
  for (const rawLine of output.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "").split(/\r?\n/)) {
    const match = rawLine.trim().match(/^([A-Za-z0-9][A-Za-z0-9._:/-]*)\s+-\s+(.+)$/);
    if (!match) continue;
    const id = match[1]!;
    const name = match[2]!.replace(/\s*\([^)]*\)\s*$/g, "").trim() || id;
    models.set(id, { id, name });
  }
  return [...models.values()];
}

export async function listCursorModels(
  agent: CursorAgentCommand,
  timeoutMs = 60_000,
): Promise<CursorModel[]> {
  const result = await run(agent, ["--list-models"], timeoutMs);
  if (result.code !== 0) {
    throw new Error(
      `Cursor Agent model check failed (exit ${result.code}): ${result.stderr || "no details"}`,
    );
  }
  const models = parseCursorModels(result.stdout);
  if (models.length === 0) {
    throw new Error("Cursor Agent returned an empty model catalog");
  }
  return models;
}

function run(
  agent: CursorAgentCommand,
  args: string[],
  timeoutMs: number,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(agent.command, [...agent.prefixArgs, ...args], {
      env: agent.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => (stdout += chunk));
    child.stderr?.on("data", (chunk: string) => (stderr += chunk));
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.once("error", reject);
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr: stderr.trim() });
    });
  });
}
