import { describe, expect, it } from "vitest";
import {
  createBilingualGameProfileBundle,
  createBilingualReportBundle
} from "../src/bilingual";
import type { GameIdentity, ReverseReport } from "../src/types";
import { demoReport, demoReportEn } from "../worker/demo";
import { isFourBeatTitle } from "../worker/game-identity";
import {
  planIdentityRepair,
  type IdentityRepairRow
} from "../worker/identity-repair";

function oldIdentity(title: string): GameIdentity {
  return {
    ...demoReport.gameProfile.identity,
    namingVersion: "four-beat-v1",
    title
  };
}

function reportWithTitle(id: string, title: string): ReverseReport {
  return {
    ...demoReport,
    id,
    framework: {
      ...demoReport.framework,
      name:
        title === "以可編輯威脅模型為中"
          ? "以可編輯威脅模型為中心的分階段安全分析框架"
          : "文章內容圖文化分段輸出"
    },
    gameProfile: {
      ...demoReport.gameProfile,
      identity: oldIdentity(title)
    }
  };
}

function row(
  reportPayload: unknown,
  cardPayload: unknown,
  overrides: Partial<IdentityRepairRow> = {}
): IdentityRepairRow {
  return {
    report_id: "report-1",
    actor_hash: "actor-1",
    payload_json: JSON.stringify(reportPayload),
    content_schema_version: 1,
    report_created_at: "2026-07-28T00:00:00.000Z",
    card_id: "report-1",
    card_game_profile_json: JSON.stringify(cardPayload),
    ...overrides
  };
}

describe("four-beat identity repair", () => {
  it("uses the existing v2 card as the axis source for a legacy report", () => {
    const report = reportWithTitle("report-legacy", "以可編輯威脅模型為中");
    const legacyPayload = {
      ...report,
      gameProfile: {
        rubricVersion: "game-profile-v1.1",
        axes: report.gameProfile.axes.map((axis) => ({
          ...axis,
          value: axis.value === undefined ? undefined : Math.max(0, axis.value - 5)
        })),
        archetypeId: "all_aura",
        roastId: "all_aura",
        badges: report.gameProfile.badges,
        strongestAxisId: "spectacle",
        weakestAxisId: "potency",
        author: report.gameProfile.author
      }
    };
    const plan = planIdentityRepair([
      row(legacyPayload, report.gameProfile, {
        report_id: "report-legacy",
        card_id: "report-legacy"
      })
    ]);

    expect(plan.safeToApply).toBe(true);
    const repaired = JSON.parse(plan.changes[0].reportPayloadJson) as ReverseReport;
    expect(repaired.gameProfile.axes).toEqual(report.gameProfile.axes);
    expect(repaired.gameProfile.identity.title).toBe("威脅沙盤");
  });

  it("repairs flat report and card payloads without changing axes", () => {
    const report = reportWithTitle("report-1", "以可編輯威脅模型為中");
    const beforeAxes = report.gameProfile.axes;
    const plan = planIdentityRepair([row(report, report.gameProfile)]);

    expect(plan.safeToApply).toBe(true);
    expect(plan.metrics.invalidBefore).toBe(1);
    expect(plan.metrics.invalidAfter).toBe(0);
    expect(plan.writes).toHaveLength(1);
    expect(plan.changes[0]).toMatchObject({
      beforeTitle: "以可編輯威脅模型為中",
      afterTitle: "威脅沙盤",
      reason: "invalid",
      reportChanged: true,
      cardChanged: true
    });
    const repaired = JSON.parse(plan.changes[0].reportPayloadJson) as ReverseReport;
    expect(repaired.gameProfile.axes).toEqual(beforeAxes);
  });

  it("supports bilingual report and card bundles while preserving English copy", () => {
    const source = reportWithTitle("report-2", "文章內容圖文化分段輸");
    const english = {
      ...demoReportEn,
      id: "report-2",
      gameProfile: {
        ...demoReportEn.gameProfile,
        axes: source.gameProfile.axes,
        identity: {
          ...demoReportEn.gameProfile.identity,
          motifId: source.gameProfile.identity.motifId,
          evidenceUrls: source.gameProfile.identity.evidenceUrls,
          source: source.gameProfile.identity.source
        }
      }
    };
    const bundle = createBilingualReportBundle(source, english, {
      sourceLocale: "zh-TW",
      synthesizedAt: "2026-07-28T00:00:00.000Z",
      synthesisModel: "test",
      translationModel: "test",
      sourceContentHash: "test"
    });
    const card = createBilingualGameProfileBundle(
      source.gameProfile,
      english.gameProfile
    );
    const plan = planIdentityRepair([
      row(bundle, card, { report_id: "report-2", card_id: "report-2" })
    ]);

    expect(plan.safeToApply).toBe(true);
    expect(plan.changes[0].afterTitle).toBe("圖文編排");
    const repairedBundle = JSON.parse(
      plan.changes[0].reportPayloadJson
    ) as typeof bundle;
    expect(repairedBundle.locales.en?.gameProfile.identity.title).toBe(
      english.gameProfile.identity.title
    );
    expect(repairedBundle.locales["zh-TW"]?.gameProfile.axes).toEqual(
      source.gameProfile.axes
    );
  });

  it("keeps valid titles, allocates invalid titles chronologically, and blocks duplicates", () => {
    const first = reportWithTitle("report-1", "威脅沙盤");
    const second = reportWithTitle("report-2", "以可編輯威脅模型為中");
    const plan = planIdentityRepair([
      row(first, first.gameProfile),
      row(second, second.gameProfile, {
        report_id: "report-2",
        card_id: "report-2",
        report_created_at: "2026-07-29T00:00:00.000Z"
      })
    ]);

    expect(plan.changes[0].afterTitle).toBe("威脅沙盤");
    expect(plan.changes[0].reason).toBe("unchanged");
    expect(plan.changes[1].afterTitle).not.toBe("威脅沙盤");
    expect(isFourBeatTitle(plan.changes[1].afterTitle)).toBe(true);
    expect(plan.metrics.duplicateTitlesAfter).toBe(0);
    expect(plan.safeToApply).toBe(true);
  });
});
