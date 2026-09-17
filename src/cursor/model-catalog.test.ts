import { describe, expect, it } from "vitest";
import {
  buildModelCatalog,
  resolveCatalogModel,
  UnsupportedReasoningEffortError,
} from "./model-catalog.js";

describe("model catalog", () => {
  const catalog = buildModelCatalog([
    { id: "auto", name: "Auto (current, default)" },
    { id: "gpt-5.6-sol-low", name: "GPT-5.6 Sol Low" },
    { id: "gpt-5.6-sol-high", name: "GPT-5.6 Sol High" },
    { id: "gpt-5.6-sol-high-fast", name: "GPT-5.6 Sol High Fast" },
    { id: "claude-opus-5-high-thinking", name: "Claude Opus 5 High Thinking" },
    { id: "composer-2.5", name: "Composer 2.5" },
  ]);

  it("groups efforts and keeps fast separate", () => {
    expect(catalog.find((model) => model.id === "gpt-5.6-sol")?.efforts).toEqual([
      "low",
      "high",
    ]);
    expect(catalog.find((model) => model.id === "gpt-5.6-sol-fast")?.efforts).toEqual([
      "high",
    ]);
    expect(catalog.find((model) => model.id === "claude-opus-5-thinking")?.variants.high).toBe(
      "claude-opus-5-high-thinking",
    );
  });

  it("maps Auto to ACP session default semantics", () => {
    expect(resolveCatalogModel(catalog, "auto", "low")).toEqual({
      catalogId: "auto",
      cursorId: "auto",
    });
  });

  it("resolves an effort to the raw Cursor id", () => {
    expect(resolveCatalogModel(catalog, "gpt-5.6-sol", "high").cursorId).toBe(
      "gpt-5.6-sol-high",
    );
  });

  it("rejects unsupported effort instead of falling back", () => {
    expect(() => resolveCatalogModel(catalog, "gpt-5.6-sol", "max")).toThrow(
      UnsupportedReasoningEffortError,
    );
  });

  it("uses an exact non-reasoning model", () => {
    expect(resolveCatalogModel(catalog, "composer-2.5", "low").cursorId).toBe(
      "composer-2.5",
    );
  });
});
