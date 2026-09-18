import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { buildModelCatalog } from "../cursor/model-catalog.js";
import { findCursorAgent } from "../cursor/discovery.js";
import { listAcpModels } from "../cursor/models.js";
import { buildCursorModelCache } from "./catalog.js";
import { isCursorConfig, setCursorProvider, setTop } from "./config.js";

const provider = process.argv[2];
if (provider !== "cursor" && provider !== "codex" && provider !== "status") {
  throw new Error("Usage: node dist/codex/switch.js cursor|codex|status");
}
const home = process.env.USERPROFILE ?? process.env.HOME;
if (!home) throw new Error("Cannot locate user profile");
const codexDir = join(home, ".codex");
const configPath = join(codexDir, "config.toml");
const catalogPath = join(codexDir, "cursor-models.json");
const templatePath = join(codexDir, "models_cache.json");
const officialPath = join(codexDir, "config.official.toml");
let config = await readFile(configPath, "utf8");

if (provider === "status") {
  console.log(isCursorConfig(config) ? "当前模型来源：Cursor" : "当前模型来源：Codex 官方");
  process.exit(0);
}

if (provider === "cursor") {
  const agent = await findCursorAgent();
  const raw = await listAcpModels(agent, process.cwd());
  const catalog = buildModelCatalog(raw);
  if (catalog.length === 0) throw new Error("Cursor model catalog is empty; config unchanged");
  const sourceCache = JSON.parse(await readFile(templatePath, "utf8")) as {
    models?: Record<string, unknown>[];
    [key: string]: unknown;
  };
  const cache = buildCursorModelCache(sourceCache, catalog);
  const temporary = `${catalogPath}.tmp`;
  await writeFile(temporary, JSON.stringify(cache, null, 2), "utf8");
  await rename(temporary, catalogPath);
  if (!isCursorConfig(config)) {
    await writeFile(officialPath, config, "utf8");
  }
  config = setTop(config, "model_reasoning_effort");
  config = setTop(config, "model_catalog_json", catalogPath.replaceAll("\\", "/"));
  config = setTop(config, "model", "auto");
  config = setTop(config, "model_provider", "cursor");
  config = setTop(config, "sandbox_mode", "read-only");
  config = setTop(config, "approval_policy", "on-request");
  config = setTop(config, "approvals_reviewer", "user");
  config = setCursorProvider(config);
} else {
  try {
    config = await readFile(officialPath, "utf8");
  } catch {
    config = setTop(config, "model_catalog_json");
    config = setTop(config, "model_provider");
    config = setTop(config, "model", "gpt-5.6-sol");
  }
}
await mkdir(codexDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
await copyFile(configPath, `${configPath}.${stamp}.bak`);
const temporaryConfig = `${configPath}.tmp`;
await writeFile(temporaryConfig, config, "utf8");
await rename(temporaryConfig, configPath);
console.log(provider === "cursor" ? "已切换到 Cursor 模型" : "已切换到 Codex 官方模型");
