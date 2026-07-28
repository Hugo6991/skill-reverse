export type PublicationStatus = "unpublished" | "published" | "hidden";

export function normalizeTargetUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString().replace(/\/$/, "");
}

export function targetKey(value: string): string {
  return normalizeTargetUrl(value);
}

interface HistoryCursor {
  publishedAt: string;
  jobId: string;
}

function base64url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function decodeBase64url(value: string): string {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

export function encodeHistoryCursor(cursor: HistoryCursor): string {
  return base64url(JSON.stringify(cursor));
}

export function decodeHistoryCursor(value?: string): HistoryCursor | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(decodeBase64url(value)) as Partial<HistoryCursor>;
    if (
      typeof parsed.publishedAt !== "string" ||
      !Number.isFinite(Date.parse(parsed.publishedAt)) ||
      typeof parsed.jobId !== "string" ||
      !parsed.jobId
    ) {
      return undefined;
    }
    return { publishedAt: parsed.publishedAt, jobId: parsed.jobId };
  } catch {
    return undefined;
  }
}
