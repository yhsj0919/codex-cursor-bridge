import { spawn } from "node:child_process";

import type { CursorAgentCommand } from "./discovery.js";

export type CursorAccountInfo = {
  authentication: {
    status: string;
    authenticated: boolean;
  };
  user: {
    email?: string;
    id?: number;
    firstName?: string;
    lastName?: string;
    createdAt?: string;
  };
  subscription: {
    tier?: string;
  };
  cli: {
    version?: string;
    latestVersion?: string;
    latestStatus?: string;
  };
  defaultModel?: string;
  usage: {
    available: false;
    reason: string;
  };
};

export async function getCursorAccountInfo(agent: CursorAgentCommand): Promise<CursorAccountInfo> {
  const [status, about] = await Promise.all([
    runJson(agent, ["status", "--format", "json"]),
    runJson(agent, ["about", "--format", "json"]),
  ]);
  const user = object(status.userInfo);
  const email = string(user.email);
  const id = number(user.userId);
  const firstName = string(user.firstName);
  const lastName = string(user.lastName);
  const createdAt = string(user.createdAt);
  const tier = string(about.subscriptionTier);
  const version = string(about.cliVersion);
  const latestVersion = string(about.latestVersion);
  const latestStatus = string(about.latestStatus);
  const defaultModel = string(about.model);
  return {
    authentication: {
      status: string(status.status) ?? "unknown",
      authenticated: status.isAuthenticated === true,
    },
    user: {
      ...(email ? { email } : {}),
      ...(id !== undefined ? { id } : {}),
      ...(firstName ? { firstName } : {}),
      ...(lastName ? { lastName } : {}),
      ...(createdAt ? { createdAt } : {}),
    },
    subscription: {
      ...(tier ? { tier } : {}),
    },
    cli: {
      ...(version ? { version } : {}),
      ...(latestVersion ? { latestVersion } : {}),
      ...(latestStatus ? { latestStatus } : {}),
    },
    ...(defaultModel ? { defaultModel } : {}),
    usage: {
      available: false,
      reason: "Cursor Agent does not expose account usage totals or reset times",
    },
  };
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function string(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function runJson(agent: CursorAgentCommand, args: string[]): Promise<Record<string, unknown>> {
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
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Cursor account query failed (exit ${code ?? 1}): ${stderr.trim() || "no details"}`));
        return;
      }
      try {
        resolve(object(JSON.parse(stdout)));
      } catch {
        reject(new Error("Cursor account query returned invalid JSON"));
      }
    });
  });
}
