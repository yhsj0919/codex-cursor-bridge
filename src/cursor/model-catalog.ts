import type { CursorModel } from "./models.js";

export type ReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export type CatalogModel = {
  id: string;
  name: string;
  efforts: ReasoningEffort[];
  variants: Partial<Record<ReasoningEffort, string>>;
  exactId?: string;
};

const EFFORT_ORDER: ReasoningEffort[] = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

const EFFORT_PATTERN =
  "none|minimal|low|medium|high|xhigh|max|extra-high";

function variant(model: CursorModel): {
  baseId: string;
  effort?: ReasoningEffort;
  rawId: string;
} {
  let core = model.id;
  let fast = false;
  if (core.toLowerCase().endsWith("-fast")) {
    core = core.slice(0, -5);
    fast = true;
  }
  let base = core;
  let effort: ReasoningEffort | undefined;
  const thinking = core.match(
    new RegExp(`^(.*)-(${EFFORT_PATTERN})-thinking$`, "i"),
  );
  const normal = core.match(new RegExp(`^(.*)-(${EFFORT_PATTERN})$`, "i"));
  const match = thinking ?? normal;
  if (match) {
    base = thinking ? `${match[1]}-thinking` : match[1]!;
    const rawEffort = match[2]!.toLowerCase();
    effort = rawEffort === "extra-high" ? "xhigh" : (rawEffort as ReasoningEffort);
  }
  return {
    baseId: `${base}${fast ? "-fast" : ""}`,
    ...(effort ? { effort } : {}),
    rawId: model.id,
  };
}

function displayName(id: string, names: string[]): string {
  if (id === "auto") return "Auto (Cursor)";
  let name = names[0] ?? id;
  name = name
    .replace(
      /\s+(extra high|none|minimal|low|medium|high|xhigh|max)(?=(\s+thinking)?(\s+fast)?$)/i,
      "",
    )
    .trim();
  if (/^(gpt[- ]|codex\b|o\d)/i.test(name) && !/^OpenAI\b/i.test(name)) {
    name = `OpenAI ${name}`;
  }
  return name || id;
}

export function buildModelCatalog(models: CursorModel[]): CatalogModel[] {
  const groups = new Map<
    string,
    { names: string[]; variants: Partial<Record<ReasoningEffort, string>>; exactId?: string }
  >();
  for (const model of models) {
    const parsed = variant(model);
    const group = groups.get(parsed.baseId) ?? { names: [], variants: {} };
    group.names.push(model.name);
    if (parsed.effort) group.variants[parsed.effort] = parsed.rawId;
    else group.exactId = parsed.rawId;
    groups.set(parsed.baseId, group);
  }
  return [...groups.entries()]
    .map(([id, group]) => ({
      id,
      name: displayName(id, group.names),
      efforts: EFFORT_ORDER.filter((effort) => !!group.variants[effort]),
      variants: group.variants,
      ...(group.exactId ? { exactId: group.exactId } : {}),
    }))
    .sort((a, b) => (a.id === "auto" ? -1 : b.id === "auto" ? 1 : a.name.localeCompare(b.name)));
}

export class UnsupportedReasoningEffortError extends Error {
  readonly code = "unsupported_reasoning_effort";
  constructor(readonly model: string, readonly effort: string) {
    super(`Cursor model "${model}" does not offer reasoning effort "${effort}"`);
  }
}

function normalizeEffort(value: string | undefined): ReasoningEffort | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase().replace("extra-high", "xhigh");
  return EFFORT_ORDER.includes(normalized as ReasoningEffort)
    ? (normalized as ReasoningEffort)
    : undefined;
}

export function resolveCatalogModel(
  catalog: CatalogModel[],
  requested: string | undefined,
  requestedEffort?: string,
): { catalogId: string; cursorId: string; effort?: ReasoningEffort } {
  const id = requested?.trim() || "auto";
  const model = catalog.find((entry) => entry.id.toLowerCase() === id.toLowerCase());
  if (!model) throw new Error(`Unknown Cursor model "${id}"`);
  const effort = normalizeEffort(requestedEffort);
  if (requestedEffort && !effort) {
    throw new UnsupportedReasoningEffortError(id, requestedEffort);
  }
  if (model.id === "auto") return { catalogId: model.id, cursorId: "auto" };
  if (effort) {
    if (model.exactId && model.efforts.length === 0) {
      return { catalogId: model.id, cursorId: model.exactId };
    }
    const cursorId = model.variants[effort];
    if (!cursorId) throw new UnsupportedReasoningEffortError(id, effort);
    return { catalogId: model.id, cursorId, effort };
  }
  if (model.exactId) return { catalogId: model.id, cursorId: model.exactId };
  const preferred = ["medium", "high", "low", "xhigh", "max", "none", "minimal"] as const;
  for (const candidate of preferred) {
    const cursorId = model.variants[candidate];
    if (cursorId) return { catalogId: model.id, cursorId, effort: candidate };
  }
  throw new Error(`Cursor model "${id}" has no executable variant`);
}
