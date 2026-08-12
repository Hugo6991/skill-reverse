import { describe, expect, it } from "vitest";
import { demoReport, demoReportBundle } from "../worker/demo";
import {
  resolveSmokeReport,
  validateSmokeReport
} from "../scripts/setup-prod-validation.mjs";

describe("production setup report validation", () => {
  it("validates the current bilingual report envelope", () => {
    expect(resolveSmokeReport(demoReportBundle)).toEqual(demoReport);
    expect(validateSmokeReport(demoReportBundle)).toMatchObject({
      ok: true,
      sourceCount: demoReport.sources.length,
      report: demoReport
    });
  });

  it("rejects a legacy report because production publication must be bilingual", () => {
    expect(validateSmokeReport(demoReport)).toMatchObject({
      ok: false,
      sourceCount: demoReport.sources.length
    });
  });

  it("rejects unsupported citations in either envelope", () => {
    expect(
      validateSmokeReport({
        ...demoReportBundle,
        locales: {
          ...demoReportBundle.locales,
          "zh-TW": {
            ...demoReport,
            sources: [{ ...demoReport.sources[0], url: "http://example.com" }]
          }
        }
      })
    ).toMatchObject({ ok: false });
  });

  it("rejects an empty or structurally different English locale", () => {
    expect(
      validateSmokeReport({
        ...demoReportBundle,
        locales: { ...demoReportBundle.locales, en: {} }
      })
    ).toMatchObject({ ok: false });
  });
});
