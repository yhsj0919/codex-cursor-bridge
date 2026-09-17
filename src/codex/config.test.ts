import { describe, expect, it } from "vitest";

import { defaultEffort, isCursorConfig, setCursorProvider, setTop } from "./config.js";

describe("Codex TOML editing", () => {
  it("only edits top-level keys", () => {
    const input = 'model = "official"\n[profile.work]\nmodel = "profile-model"\n';
    const output = setTop(input, "model", "auto");
    expect(output).toContain('model = "auto"');
    expect(output).toContain('model = "profile-model"');
    expect(output).not.toContain('model = "official"');
  });

  it("replaces the Cursor provider without damaging following sections", () => {
    const input = '[model_providers.cursor]\nname = "old"\nbase_url = "old"\n\n[projects."E:/demo"]\ntrust_level = "trusted"\n';
    const output = setCursorProvider(input);
    expect(output).toContain('base_url = "http://127.0.0.1:8765/v1"');
    expect(output).toContain('[projects."E:/demo"]');
    expect(output).toContain('trust_level = "trusted"');
    expect(output).not.toContain('name = "old"');
  });

  it("detects Cursor only from the top-level provider", () => {
    expect(isCursorConfig('model_provider = "cursor"\n[profile.x]\n')).toBe(true);
    expect(isCursorConfig('[profile.x]\nmodel_provider = "cursor"\n')).toBe(false);
  });

  it("chooses a supported default reasoning effort", () => {
    expect(defaultEffort(["low", "high"])).toBe("high");
    expect(defaultEffort([])).toBe("low");
  });
});
