import { access, readdir } from "node:fs/promises";
import { join } from "node:path";

export type CursorAgentCommand = {
  command: string;
  prefixArgs: string[];
  env: NodeJS.ProcessEnv;
};

export async function findCursorAgent(
  env: NodeJS.ProcessEnv = process.env,
): Promise<CursorAgentCommand> {
  const explicit = env.CURSOR_AGENT_BIN?.trim();
  if (explicit) return { command: explicit, prefixArgs: [], env };
  if (process.platform === "win32" && env.LOCALAPPDATA) {
    const root = join(env.LOCALAPPDATA, "cursor-agent");
    try {
      const versionsRoot = join(root, "versions");
      const versions = (await readdir(versionsRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
        .reverse();
      for (const version of versions) {
        const directory = join(versionsRoot, version);
        const node = join(directory, "node.exe");
        const script = join(directory, "index.js");
        try {
          await Promise.all([access(node), access(script)]);
          return {
            command: node,
            prefixArgs: [script],
            env: { ...env, CURSOR_INVOKED_AS: "agent.cmd" },
          };
        } catch {
          // Try the next installed version.
        }
      }
      const candidate = join(root, "agent.cmd");
      await access(candidate);
      return { command: candidate, prefixArgs: [], env };
    } catch {
      // Fall through to PATH lookup.
    }
  }
  return { command: "agent", prefixArgs: [], env };
}
