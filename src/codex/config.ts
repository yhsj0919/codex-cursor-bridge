export function splitTop(text: string): [string, string] {
  const match = /^\s*\[/m.exec(text);
  const index = match?.index ?? text.length;
  return [text.slice(0, index), text.slice(index)];
}

export function setTop(text: string, key: string, value?: string): string {
  const normalized = text.replace(/\r\n?/g, "\n");
  let [top, rest] = splitTop(normalized);
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^[ \\t]*${escapedKey}[ \\t]*=`);
  top = top.split("\n").filter((line) => !pattern.test(line)).join("\n");
  if (value !== undefined) top = `${key} = ${JSON.stringify(value)}\n${top.replace(/^(?:[ \\t]*\n)+/, "")}`;
  return top + rest;
}

export function setCursorProvider(text: string): string {
  text = text.replace(/\r\n?/g, "\n");
  const block = `[model_providers.cursor]\nname = "Cursor Bridge"\nbase_url = "http://127.0.0.1:8765/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n`;
  const pattern = /^\[model_providers\.cursor\][^\r\n]*(?:\r?\n(?!\s*\[)[^\r\n]*)*/m;
  return pattern.test(text) ? text.replace(pattern, block) : `${text.trimEnd()}\n\n${block}`;
}

export function isCursorConfig(text: string): boolean {
  return /^\s*model_provider\s*=\s*["']cursor["']/m.test(splitTop(text)[0]);
}

export function defaultEffort(efforts: string[]): string {
  return ["medium", "high", "low", "xhigh", "max", "none", "minimal"]
    .find((item) => efforts.includes(item)) ?? "low";
}
