import { describe, expect, it } from "vitest";

import { buildCursorModelCache } from "./catalog.js";

describe("buildCursorModelCache", () => {
  it("forces full Responses requests so Codex tools reach the Bridge", () => {
    const source = {
      fetched_at: "old",
      models: [{
        slug: "gpt-5.6-sol",
        display_name: "GPT-5.6-Sol",
        use_responses_lite: true,
        tool_mode: "code_mode_only",
      }],
    };
    const result = buildCursorModelCache(source, [{
      id: "auto",
      name: "Auto (Cursor)",
      efforts: [],
      variants: {},
      exactId: "auto",
    }], "2026-09-18T00:00:00.000Z");

    expect(result.models?.[0]).toMatchObject({
      slug: "auto",
      display_name: "Auto (Cursor)",
      use_responses_lite: false,
      tool_mode: "code_mode_only",
    });
    expect(result.fetched_at).toBe("2026-09-18T00:00:00.000Z");
    expect(source.models[0]?.use_responses_lite).toBe(true);
  });
});
