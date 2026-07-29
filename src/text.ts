export function withoutTerminalFullStop(value: string): string {
  return value.replace(/\u3002+\s*$/u, "").trimEnd();
}

export function cleanDisplayTitle(value: string): string {
  return withoutTerminalFullStop(value)
    .replace(/「/gu, " ")
    .replace(/」/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}
