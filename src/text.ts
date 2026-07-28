export function withoutTerminalFullStop(value: string): string {
  return value.replace(/\u3002+\s*$/u, "").trimEnd();
}
