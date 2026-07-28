type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanLabel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const label = value.replace(/\u3002+\s*$/u, "").trim();
  return label || undefined;
}

function normalizedTarget(value: string): string {
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString();
}

function githubRepositoryName(targetUrl: string): string | undefined {
  const url = new URL(targetUrl);
  if (url.hostname.replace(/^www\./, "").toLowerCase() !== "github.com") return undefined;
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length < 2) return undefined;
  return decodeURIComponent(segments[1]).replace(/\.git$/i, "");
}

function readableHostName(targetUrl: string): string {
  const hostname = new URL(targetUrl).hostname.replace(/^www\./, "");
  if (hostname === "github.com") return "GitHub";
  const [label] = hostname.split(".");
  return label
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function primarySourceTitle(payload: JsonRecord, targetUrl: string): string | undefined {
  if (!Array.isArray(payload.sources)) return undefined;
  const target = normalizedTarget(targetUrl);
  const sources = payload.sources.filter(isRecord);
  const primary =
    sources.find((source) => {
      if (typeof source.url !== "string") return false;
      try {
        return normalizedTarget(source.url) === target;
      } catch {
        return false;
      }
    }) ?? sources[0];
  return primary ? cleanLabel(primary.title) : undefined;
}

function extractedSkills(payload: JsonRecord): string[] {
  const labels: string[] = [];
  const framework = isRecord(payload.framework) ? cleanLabel(payload.framework.name) : undefined;
  if (framework) labels.push(framework);

  if (Array.isArray(payload.professionalDelta)) {
    for (const value of payload.professionalDelta) {
      if (!isRecord(value) || value.manifestation !== "author_specific_extension") continue;
      const competency = isRecord(value.competency)
        ? cleanLabel(value.competency.label)
        : undefined;
      if (competency) labels.push(competency);
    }
  }

  return [...new Set(labels)].slice(0, 3);
}

export function historyPresentation(
  targetUrl: string,
  reportPayloadJson?: string | null
): {
  displayName: string;
  sourceHost: string;
  skillLabels: string[];
} {
  const sourceHost = new URL(targetUrl).hostname.replace(/^www\./, "");
  let report: JsonRecord | undefined;
  if (reportPayloadJson) {
    try {
      const parsed = JSON.parse(reportPayloadJson) as unknown;
      if (isRecord(parsed)) report = parsed;
    } catch {
      // A malformed or older report must not prevent history from loading
    }
  }

  return {
    displayName:
      githubRepositoryName(targetUrl) ??
      (report ? primarySourceTitle(report, targetUrl) : undefined) ??
      readableHostName(targetUrl),
    sourceHost,
    skillLabels: report ? extractedSkills(report) : []
  };
}
