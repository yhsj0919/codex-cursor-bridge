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

  it("normalizes mixed newlines without leaving isolated carriage returns", () => {
    let output = 'service_tier = "default"\nmodel = "official"\n\n[profile.work]\r\nmodel = "profile"\r\n';
    output = setTop(output, "model_catalog_json", "C:/Users/Admin/.codex/cursor-models.json");
    output = setTop(output, "model", "auto");
    output = setTop(output, "model_provider", "cursor");
    output = setTop(output, "sandbox_mode", "read-only");
    output = setTop(output, "approval_policy", "on-request");
    expect(output).not.toMatch(/\r(?!\n)/);
    expect(output).not.toContain('\r');
    expect(output).toContain('model_catalog_json = "C:/Users/Admin/.codex/cursor-models.json"\n');
    expect(output).toContain('service_tier = "default"\n');
    expect(output).toContain('[profile.work]\nmodel = "profile"\n');
  });

  it("replaces the Cursor provider without damaging following sections", () => {
    const input = '[model_providers.cursor]\nname = "old"\nbase_url = "old"\n\n[projects."E:/demo"]\ntrust_level = "trusted"\n';
    const output = setCursorProvider(input);
    expect(output).toContain('base_url = "http://127.0.0.1:8765/v1"');
    expect(output).toContain('[projects."E:/demo"]');
    expect(output).toContain('trust_level = "trusted"');
    expect(output).not.toContain('name = "old"');
    expect(output).not.toContain('base_url = "old"');
    expect(output.match(/^base_url\s*=/gm)).toHaveLength(1);
    expect(output.match(/^wire_api\s*=/gm)).toHaveLength(1);
    expect(output.match(/^requires_openai_auth\s*=/gm)).toHaveLength(1);
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
