import { isBilingualReportBundle, resolveReport } from "../src/bilingual";
import type {
  GameAxisId,
  GameBadgeId,
  HistoryAnalysisAxis,
  HistoryAnalysisPreview,
  Locale,
  ReportPayload
} from "../src/types";

type JsonRecord = Record<string, unknown>;

const GAME_AXIS_IDS: GameAxisId[] = [
  "money",
  "spectacle",
  "potency",
  "activation",
  "renown",
  "ascension"
];
const GAME_BADGE_IDS = new Set<GameBadgeId>([
  "evidence_rich",
  "low_dependency",
  "portable",
  "field_tested",
  "well_maintained"
]);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isGameAxisId(value: unknown): value is GameAxisId {
  return typeof value === "string" && GAME_AXIS_IDS.includes(value as GameAxisId);
}

function boundedScore(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    return undefined;
  }
  return Math.round(value);
}

function localizedReportRecord(
  reportPayloadJson: string | null | undefined,
  locale: Locale
): JsonRecord | undefined {
  if (!reportPayloadJson) return undefined;
  try {
    const parsed = JSON.parse(reportPayloadJson) as ReportPayload;
    const localized = isBilingualReportBundle(parsed) ? resolveReport(parsed, locale) : parsed;
    return isRecord(localized) ? localized : undefined;
  } catch {
    return undefined;
  }
}

function cleanLabel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const label = value
    .replace(/\u3002+\s*$/u, "")
    .replace(/的「/gu, "的")
    .replace(/「/gu, " ")
    .replace(/」/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
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
  reportPayloadJson?: string | null,
  locale: Locale = "zh-TW"
): {
  displayName: string;
  sourceHost: string;
  skillLabels: string[];
} {
  const sourceHost = new URL(targetUrl).hostname.replace(/^www\./, "");
  const report = localizedReportRecord(reportPayloadJson, locale);

  return {
    displayName:
      githubRepositoryName(targetUrl) ??
      (report ? primarySourceTitle(report, targetUrl) : undefined) ??
      readableHostName(targetUrl),
    sourceHost,
    skillLabels: report ? extractedSkills(report) : []
  };
}

export function historyAnalysisPreview(
  reportPayloadJson: string | null | undefined,
  locale: Locale = "zh-TW"
): HistoryAnalysisPreview | undefined {
  const report = localizedReportRecord(reportPayloadJson, locale);
  const profile = report && isRecord(report.gameProfile) ? report.gameProfile : undefined;
  if (profile?.rubricVersion !== "game-profile-v2" || !Array.isArray(profile.axes)) {
    return undefined;
  }

  const storedAxes = new Map<GameAxisId, HistoryAnalysisAxis>();
  for (const candidate of profile.axes) {
    if (!isRecord(candidate) || !isGameAxisId(candidate.id)) continue;
    const value = boundedScore(candidate.value);
    const coverage = boundedScore(candidate.coverage) ?? 0;
    storedAxes.set(candidate.id, {
      id: candidate.id,
      ...(value === undefined ? {} : { value }),
      coverage
    });
  }
  if (storedAxes.size === 0) return undefined;

  const axes = GAME_AXIS_IDS.map(
    (id): HistoryAnalysisAxis => storedAxes.get(id) ?? { id, coverage: 0 }
  );
  const scoredIds = [...axes]
    .filter((axis): axis is HistoryAnalysisAxis & { value: number } => axis.value !== undefined)
    .sort((left, right) => right.value - left.value)
    .map((axis) => axis.id);
  const highlightAxisId = isGameAxisId(profile.highlightAxisId)
    ? profile.highlightAxisId
    : scoredIds.find((id) => id !== "activation") ?? scoredIds[0] ?? "potency";
  const requestedRisk = isGameAxisId(profile.riskAxisId) ? profile.riskAxisId : "activation";
  const riskAxisId =
    requestedRisk !== highlightAxisId
      ? requestedRisk
      : GAME_AXIS_IDS.find((id) => id !== highlightAxisId && id === "activation") ??
        GAME_AXIS_IDS.find((id) => id !== highlightAxisId) ??
        requestedRisk;
  const requestedSecondary = isGameAxisId(profile.accentAxisId)
    ? profile.accentAxisId
    : undefined;
  const secondaryAxisId =
    scoredIds.find((id) => id !== highlightAxisId && id !== riskAxisId) ??
    (requestedSecondary !== highlightAxisId && requestedSecondary !== riskAxisId
      ? requestedSecondary
      : undefined) ??
    GAME_AXIS_IDS.find((id) => id !== highlightAxisId && id !== riskAxisId) ??
    highlightAxisId;
  const badges = Array.isArray(profile.badges)
    ? profile.badges
        .filter(
          (badge): badge is GameBadgeId =>
            typeof badge === "string" && GAME_BADGE_IDS.has(badge as GameBadgeId)
        )
        .slice(0, 2)
    : [];

  return {
    axes,
    highlightAxisId,
    secondaryAxisId,
    riskAxisId,
    badges
  };
}

export function historyOccupationTitle(
  reportPayloadJson: string | null | undefined,
  locale: Locale,
  fallback: string
): string {
  if (!reportPayloadJson) return fallback;
  const report = localizedReportRecord(reportPayloadJson, locale);
  const occupation = report && isRecord(report.occupation) ? report.occupation : undefined;
  return typeof occupation?.title === "string" && occupation.title ? occupation.title : fallback;
}
