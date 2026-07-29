import { describe, expect, it } from "vitest";
import {
  assertEquivalentReportStructure,
  availableReportLocales,
  resolveReport
} from "../src/bilingual";
import { resolveInitialLocale } from "../src/LocaleContext";
import { en, zhTW } from "../src/locales";
import { demoReport, demoReportBundle, demoReportEn } from "../worker/demo";

function keyShape(value: unknown): unknown {
  if (typeof value === "string") return "string";
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
      key,
      keyShape(nested)
    ])
  );
}

function allStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  return Object.values(value as Record<string, unknown>).flatMap(allStrings);
}

describe("typed localization", () => {
  it("keeps both dictionaries complete and non-empty", () => {
    expect(keyShape(en)).toEqual(keyShape(zhTW));
    expect(allStrings(en).every((value) => value.trim().length > 0)).toBe(true);
    expect(allStrings(zhTW).every((value) => value.trim().length > 0)).toBe(true);
  });

  it("resolves URL, saved preference, browser language, then the zh-TW default", () => {
    expect(
      resolveInitialLocale({
        search: "?lang=en",
        stored: "zh-TW",
        browserLanguage: "zh-Hant-TW"
      })
    ).toBe("en");
    expect(
      resolveInitialLocale({ search: "", stored: "en", browserLanguage: "zh-TW" })
    ).toBe("en");
    expect(resolveInitialLocale({ search: "", browserLanguage: "en-US" })).toBe("en");
    expect(resolveInitialLocale({ search: "", browserLanguage: "fr-FR" })).toBe("zh-TW");
  });
});

describe("bilingual report bundle", () => {
  it("stores and resolves both complete report locales", () => {
    expect(availableReportLocales(demoReportBundle)).toEqual(["zh-TW", "en"]);
    expect(resolveReport(demoReportBundle, "zh-TW").title).toBe(demoReport.title);
    expect(resolveReport(demoReportBundle, "en").title).toBe(demoReportEn.title);
  });

  it("rejects translations that alter evidence structure", () => {
    const changed = structuredClone(demoReportEn);
    changed.claims[0].confidence -= 1;
    expect(() => assertEquivalentReportStructure(demoReport, changed)).toThrow(
      "language-neutral report structure"
    );
  });

  it("keeps legacy payloads readable as Traditional Chinese", () => {
    const legacy = structuredClone(demoReport);
    delete legacy.author.kind;
    expect(availableReportLocales(legacy)).toEqual(["zh-TW"]);
    expect(resolveReport(legacy, "en")).toBe(legacy);
    expect(resolveReport(legacy, "en").author.kind).toBeUndefined();
  });
});
