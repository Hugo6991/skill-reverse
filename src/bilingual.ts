import type {
  BilingualReportBundle,
  Locale,
  ReportBundleCore,
  ReportGenerationMetadata,
  ReportPayload,
  ReverseReport
} from "./types";

export function isBilingualReportBundle(value: unknown): value is BilingualReportBundle {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<BilingualReportBundle>;
  return (
    candidate.schemaVersion === 2 &&
    Boolean(candidate.core) &&
    Boolean(candidate.locales?.["zh-TW"]) &&
    Array.isArray(candidate.availableLocales)
  );
}

export function reportCore(report: ReverseReport): ReportBundleCore {
  return {
    id: report.id,
    targetUrl: report.targetUrl,
    generatedAt: report.generatedAt,
    sourceIds: report.sources.map((item) => item.id),
    frameworkStepIds: report.framework.steps.map((_, index) => `step-${index + 1}`),
    competencyIds: report.occupation.competencies.map(
      (item, index) => `${item.kind}-${index + 1}`
    ),
    professionalDeltaIds: report.professionalDelta.map((_, index) => `delta-${index + 1}`),
    observationIds: report.observations.map((item) => item.id),
    claimIds: report.claims.map((item) => item.id),
    evidenceEdgeIds: report.edges.map((item) => item.id),
    adoptionIds: report.adoption.map((_, index) => `adoption-${index + 1}`),
    caveatIds: report.caveats.map((_, index) => `caveat-${index + 1}`),
    degradedIds: report.degraded.map((_, index) => `degraded-${index + 1}`)
  };
}

function structuralFingerprint(report: ReverseReport): string {
  return JSON.stringify({
    id: report.id,
    targetUrl: report.targetUrl,
    generatedAt: report.generatedAt,
    frameworkFailureTypes: report.framework.steps.map((item) => item.failureType),
    author: { name: report.author.name, handle: report.author.handle },
    occupation: {
      code: report.occupation.code,
      provider: report.occupation.provider,
      version: report.occupation.version,
      sourceUri: report.occupation.sourceUri,
      competencies: report.occupation.competencies.map((item) => ({
        kind: item.kind,
        importance: item.importance,
        sourceUri: item.sourceUri
      }))
    },
    professionalDelta: report.professionalDelta.map((item) => ({
      manifestation: item.manifestation,
      evidenceIds: item.evidenceIds
    })),
    observations: report.observations.map((item) => ({
      id: item.id,
      sourceIds: item.sourceIds
    })),
    claims: report.claims.map((item) => ({
      id: item.id,
      status: item.status,
      confidence: item.confidence,
      evidenceIds: item.evidenceIds,
      score: item.score
    })),
    sources: report.sources,
    edges: report.edges,
    lengths: {
      adoption: report.adoption.length,
      caveats: report.caveats.length,
      degraded: report.degraded.length
    }
  });
}

export function assertEquivalentReportStructure(
  source: ReverseReport,
  translation: ReverseReport
): void {
  if (structuralFingerprint(source) !== structuralFingerprint(translation)) {
    throw new Error("Translated report changed language-neutral report structure");
  }
}

export function createBilingualReportBundle(
  source: ReverseReport,
  english: ReverseReport,
  generation: ReportGenerationMetadata
): BilingualReportBundle {
  assertEquivalentReportStructure(source, english);
  return {
    schemaVersion: 2,
    availableLocales: ["zh-TW", "en"],
    core: reportCore(source),
    locales: { "zh-TW": source, en: english },
    generation
  };
}

export function resolveReport(payload: ReportPayload, locale: Locale): ReverseReport {
  if (!isBilingualReportBundle(payload)) return payload;
  return payload.locales[locale] ?? payload.locales["zh-TW"]!;
}

export function availableReportLocales(payload: ReportPayload): Locale[] {
  return isBilingualReportBundle(payload) ? payload.availableLocales : ["zh-TW"];
}
