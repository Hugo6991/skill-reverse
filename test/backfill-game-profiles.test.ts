import { describe, expect, it } from "vitest";
import backfillScript from "../scripts/backfill-game-profiles.mjs?raw";
import { createBilingualGameProfileBundle } from "../src/bilingual";
import { demoReport, demoReportBundle, demoReportEn } from "../worker/demo";
import { computeGameProfile } from "../worker/game-profile";
import { historyPresentation } from "../worker/history";
import { targetKey } from "../worker/publication";
import {
  cardUpsertSql,
  planGameProfileBackfill
} from "../worker/backfill-plan";

function row(payload: unknown, overrides: Record<string, unknown> = {}) {
  return {
    report_id: "report-1",
    payload_json: JSON.stringify(payload),
    job_id: "job-1",
    actor_hash: "actor-1",
    target_url: "https://github.com/anthropics/skills?utm_source=test",
    target_key: "https://github.com/anthropics/skills",
    occupation_code: "15-1255.00",
    occupation_title: "Web and Digital Interface Designers",
    published_at: "2026-07-28T00:00:00.000Z",
    card_report_id: null,
    card_game_profile_json: null,
    ...overrides
  };
}

const dependencies = {
  now: "2026-07-29T00:00:00.000Z",
  computeGameProfile,
  historyPresentation,
  targetKey
};

describe("game profile backfill", () => {
  it("loads TypeScript dependencies through Vite instead of native Node ESM", () => {
    expect(backfillScript).toContain('moduleServer.ssrLoadModule("/worker/game-profile.ts")');
    expect(backfillScript).toContain('moduleServer.ssrLoadModule("/worker/backfill-plan.ts")');
    expect(backfillScript).not.toContain('import("../worker/game-profile.ts")');
  });

  it("plans one payload update and one private card for a legacy report", () => {
    const { gameProfile: _gameProfile, ...legacyReport } = demoReport;
    const plan = planGameProfileBackfill([row(legacyReport)], dependencies);

    expect(plan.failures).toEqual([]);
    expect(plan.reportUpdates).toHaveLength(1);
    expect(plan.cardUpserts).toHaveLength(1);
    expect(plan.reportUpdates[0].profile.rubricVersion).toBe("game-profile-v2");
    expect(plan.reportUpdates[0].profile.identity.title).not.toMatch(/法相驚人|法相萬千/);
    expect(cardUpsertSql(plan.cardUpserts[0], dependencies.now, plan.expiresAt))
      .not.toContain("share_slug");
  });

  it("does not plan writes when the payload and latest card are already current", () => {
    const profileJson = JSON.stringify(demoReport.gameProfile);
    const plan = planGameProfileBackfill(
      [
        row(demoReport, {
          card_report_id: "report-1",
          card_game_profile_json: profileJson
        })
      ],
      dependencies
    );

    expect(plan).toMatchObject({
      reportUpdates: [],
      cardUpserts: [],
      failures: []
    });
  });

  it("preserves a current bilingual report and its localized card profile", () => {
    const cardProfile = createBilingualGameProfileBundle(
      demoReport.gameProfile,
      demoReportEn.gameProfile
    );
    const plan = planGameProfileBackfill(
      [
        row(demoReportBundle, {
          card_report_id: "report-1",
          card_game_profile_json: JSON.stringify(cardProfile)
        })
      ],
      dependencies
    );

    expect(plan).toMatchObject({
      reportUpdates: [],
      cardUpserts: [],
      failures: []
    });
  });

  it("backfills a missing source profile without replacing English or locale metadata", () => {
    const source = demoReportBundle.locales["zh-TW"]!;
    const { gameProfile: _gameProfile, ...sourceWithoutProfile } = source;
    const legacyBundle = {
      ...demoReportBundle,
      locales: {
        ...demoReportBundle.locales,
        "zh-TW": sourceWithoutProfile
      }
    } as unknown as typeof demoReportBundle;
    const storedBundle = JSON.parse(JSON.stringify(legacyBundle)) as typeof demoReportBundle;
    const plan = planGameProfileBackfill([row(storedBundle)], dependencies);
    const update = plan.reportUpdates[0];

    expect(plan.failures).toEqual([]);
    expect(plan.reportUpdates).toHaveLength(1);
    expect(update.report).toMatchObject({
      schemaVersion: storedBundle.schemaVersion,
      availableLocales: storedBundle.availableLocales,
      core: storedBundle.core,
      generation: storedBundle.generation,
      locales: {
        en: storedBundle.locales.en
      }
    });
    expect(update.cardProfile).toMatchObject({
      schemaVersion: 1,
      locales: {
        en: storedBundle.locales.en!.gameProfile
      }
    });
  });

  it("keeps only the latest report per actor target and occupation in the collection", () => {
    const { gameProfile: _gameProfile, ...legacyReport } = demoReport;
    const plan = planGameProfileBackfill(
      [
        row(legacyReport),
        row(legacyReport, {
          report_id: "report-2",
          job_id: "job-2",
          published_at: "2026-07-29T00:00:00.000Z"
        })
      ],
      dependencies
    );

    expect(plan.reportUpdates).toHaveLength(2);
    expect(plan.cardUpserts).toHaveLength(1);
    expect(plan.cardUpserts[0].row.report_id).toBe("report-2");
  });

  it("gives six chronological legacy cards distinct titles without forcing type distribution", () => {
    const { gameProfile: _gameProfile, ...legacyReport } = demoReport;
    const rows = Array.from({ length: 6 }, (_, index) =>
      row(
        {
          ...legacyReport,
          id: `report-${index + 1}`,
          targetUrl: `https://example.com/skill-${index + 1}`,
          framework: {
            ...legacyReport.framework,
            name: `第${["一", "二", "三", "四", "五", "六"][index]}套校準方法`
          }
        },
        {
          report_id: `report-${index + 1}`,
          job_id: `job-${index + 1}`,
          target_url: `https://example.com/skill-${index + 1}`,
          target_key: `https://example.com/skill-${index + 1}`,
          published_at: `2026-07-${String(20 + index).padStart(2, "0")}T00:00:00.000Z`
        }
      )
    );
    const plan = planGameProfileBackfill(rows, dependencies);
    const titles = plan.reportUpdates.map((item) => item.profile.identity.title);
    const signatures = plan.reportUpdates.map((item) => item.profile.identity.signatureMove);
    const motifs = plan.reportUpdates.map((item) => item.profile.identity.motifId);

    expect(new Set(titles).size).toBe(6);
    expect(signatures.every(Boolean)).toBe(true);
    expect(new Set(motifs).size).toBeGreaterThanOrEqual(1);
    expect(titles.join("")).not.toMatch(/法相驚人|法相萬千/);
    expect(plan.metrics).toMatchObject({
      duplicateTitleRate: 0,
      concentrated: false
    });
  });
});
