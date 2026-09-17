export function splitTop(text: string): [string, string] {
  const match = /^\s*\[/m.exec(text);
  const index = match?.index ?? text.length;
  return [text.slice(0, index), text.slice(index)];
}

export function setTop(text: string, key: string, value?: string): string {
  let [top, rest] = splitTop(text);
  const pattern = new RegExp(`^\\s*${key}\\s*=.*(?:\\r?\\n|$)`, "m");
  top = top.replace(pattern, "");
  if (value !== undefined) top = `${key} = ${JSON.stringify(value)}\r\n${top.trimStart()}`;
  return top + rest;
}

export function setCursorProvider(text: string): string {
  const block = `[model_providers.cursor]\r\nname = "Cursor Bridge"\r\nbase_url = "http://127.0.0.1:8765/v1"\r\nwire_api = "responses"\r\nrequires_openai_auth = false\r\n`;
  const pattern = /^\[model_providers\.cursor\]\s*[\s\S]*?(?=^\[|\s*$)/m;
  return pattern.test(text) ? text.replace(pattern, block) : `${text.trimEnd()}\r\n\r\n${block}`;
}

export function isCursorConfig(text: string): boolean {
  return /^\s*model_provider\s*=\s*["']cursor["']/m.test(splitTop(text)[0]);
}

export function defaultEffort(efforts: string[]): string {
  return ["medium", "high", "low", "xhigh", "max", "none", "minimal"]
    .find((item) => efforts.includes(item)) ?? "low";
}
