import type { CatalogModel } from "../cursor/model-catalog.js";
import { defaultEffort } from "./config.js";

type ModelCache = {
  models?: Record<string, unknown>[];
  [key: string]: unknown;
};

export function buildCursorModelCache(
  source: ModelCache,
  catalog: CatalogModel[],
  fetchedAt = new Date().toISOString(),
): ModelCache {
  const cache = structuredClone(source);
  const template = cache.models?.find((model) => model.slug === "gpt-5.6-sol")
    ?? cache.models?.[0];
  if (!template) throw new Error("Codex models_cache.json has no model template");

  cache.models = catalog.map((model, index) => ({
    ...structuredClone(template),
    slug: model.id,
    display_name: model.name,
    description: "Cursor model through local Codex Cursor Bridge.",
    priority: index + 1,
    visibility: "list",
    default_reasoning_level: defaultEffort(model.efforts),
    supported_reasoning_levels: model.efforts.map((effort) => ({
      effort,
      description: `${effort} reasoning`,
    })),
    additional_speed_tiers: [],
    service_tiers: [],
    availability_nux: null,
    upgrade: null,
    // Responses Lite deliberately omits the local Codex tool definitions.
    // The Bridge needs the full Responses request so it can expose those
    // tools to Cursor over the per-turn MCP server.
    use_responses_lite: false,
  }));
  cache.fetched_at = fetchedAt;
  return cache;
}
