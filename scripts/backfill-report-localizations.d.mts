import type { BilingualReportBundle, ReverseReport } from "../src/types";
import type { ReportTranslation } from "../worker/schema";

export function assertBackfillTranslationLengths(
  source: ReverseReport,
  translated: ReportTranslation
): void;

export function validateBackfillTranslation(
  source: ReverseReport,
  value: unknown
): ReportTranslation;

export function applyBackfillTranslation(
  source: ReverseReport,
  value: unknown
): ReverseReport;

export function createValidatedBilingualBundle(
  source: ReverseReport,
  translation: unknown,
  options: { model: string; synthesizedAt?: string }
): BilingualReportBundle & {
  availableLocales: ["zh-TW", "en"];
  locales: { "zh-TW": ReverseReport; en: ReverseReport };
};

export function runReportLocalizationBackfill(
  options?: { args?: string[] }
): Promise<void>;
