import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { buildModelCatalog } from "../cursor/model-catalog.js";
import { findCursorAgent } from "../cursor/discovery.js";
import { listCursorModels } from "../cursor/models.js";
import { defaultEffort, isCursorConfig, setCursorProvider, setTop } from "./config.js";

const provider = process.argv[2];
if (provider !== "cursor" && provider !== "codex") {
  throw new Error("Usage: node dist/codex/switch.js cursor|codex");
}
const home = process.env.USERPROFILE ?? process.env.HOME;
if (!home) throw new Error("Cannot locate user profile");
const codexDir = join(home, ".codex");
const configPath = join(codexDir, "config.toml");
const catalogPath = join(codexDir, "cursor-models.json");
const templatePath = join(codexDir, "models_cache.json");
const officialPath = join(codexDir, "config.official.toml");
let config = await readFile(configPath, "utf8");

if (provider === "cursor") {
  const agent = await findCursorAgent();
  const raw = await listCursorModels(agent);
  const catalog = buildModelCatalog(raw);
  if (catalog.length === 0) throw new Error("Cursor model catalog is empty; config unchanged");
  const cache = JSON.parse(await readFile(templatePath, "utf8")) as { models?: Record<string, unknown>[]; [key: string]: unknown };
  const template = cache.models?.find((model) => model.slug === "gpt-5.6-sol") ?? cache.models?.[0];
  if (!template) throw new Error("Codex models_cache.json has no model template");
  cache.models = catalog.map((model, index) => ({
    ...structuredClone(template),
    slug: model.id,
    display_name: model.name,
    description: "Cursor model through local Codex Cursor Bridge.",
    priority: index + 1,
    visibility: "list",
    default_reasoning_level: defaultEffort(model.efforts),
    supported_reasoning_levels: model.efforts.map((effort) => ({ effort, description: `${effort} reasoning` })),
    additional_speed_tiers: [], service_tiers: [], availability_nux: null, upgrade: null,
  }));
  cache.fetched_at = new Date().toISOString();
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
