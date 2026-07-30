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
    title,
    namingVersion: "four-beat-v1",
    oneLiner: "Legacy identity copy",
    traits: ["legacy", "identity", "copy"],
    motifId: demoReport.gameProfile.identity.motifId,
    evidenceUrls: demoReport.gameProfile.identity.evidenceUrls,
    source: "fallback"
  } as unknown as GameIdentity;
}

function reportWithTitle(id: string, title: string): ReverseReport {
  const threat = title === "以可編輯威脅模型為中";
  return {
    ...demoReport,
    id,
    framework: {
      ...demoReport.framework,
      name: threat
        ? "以可編輯威脅模型為中心的分階段安全分析框架"
        : "文章內容圖文化分段輸出",
      summary: threat
        ? "先建立可由人調整的威脅模型，再補足證據並逐項驗證風險假設。"
        : "先抽出長文核心，再分段轉成適合圖文平台的閱讀節奏。",
      useWhen: threat
        ? "面對模糊安全任務，需要先界定風險範圍時。"
        : "需要把長文轉換成圖文或投影片時。",
      avoidWhen: threat
        ? "任務與風險都已明確，直接驗證更快時。"
        : "需要保留完整技術語境與細節時。",
      steps: threat
        ? [
            {
              title: "建立威脅模型",
              instruction: "先界定資產、邊界與待驗證假設。",
              failureType: "conditional"
            },
            {
              title: "逐項驗證",
              instruction: "以證據確認風險是否成立。",
              failureType: "omission"
            }
          ]
        : [
            {
              title: "抽取核心",
              instruction: "先抓住長文要讓讀者帶走的訊息。",
              failureType: "shape"
            },
            {
              title: "安排圖文",
              instruction: "再依閱讀節奏分段並轉換媒介。",
              failureType: "conditional"
            }
          ]
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
    expect(repaired.gameProfile.identity.title).toBe("危局推演");
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
      afterTitle: "危局推演",
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
      framework: {
        ...demoReportEn.framework,
        steps: source.framework.steps.map((step) => ({ ...step }))
      },
      gameProfile: {
        ...demoReportEn.gameProfile,
        axes: source.gameProfile.axes,
        identity: {
          ...oldIdentity("Visual Translation"),
          title: "Visual Translation",
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
    expect(plan.changes[0].afterTitle).toBe("長文變奏");
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

  it("keeps current method personas, allocates legacy titles chronologically, and blocks duplicates", () => {
    const firstLegacy = reportWithTitle("report-1", "威脅沙盤");
    const first = {
      ...firstLegacy,
      gameProfile: {
        ...firstLegacy.gameProfile,
        identity: {
          ...demoReport.gameProfile.identity,
          title: "危局推演"
        }
      }
    };
    const second = reportWithTitle("report-2", "以可編輯威脅模型為中");
    const plan = planIdentityRepair([
      row(first, first.gameProfile),
      row(second, second.gameProfile, {
        report_id: "report-2",
        card_id: "report-2",
        report_created_at: "2026-07-29T00:00:00.000Z"
      })
    ]);

    expect(plan.changes[0].afterTitle).toBe("危局推演");
    expect(plan.changes[0].reason).toBe("unchanged");
    expect(plan.changes[1].afterTitle).not.toBe("威脅沙盤");
    expect(isFourBeatTitle(plan.changes[1].afterTitle)).toBe(true);
    expect(plan.metrics.duplicateTitlesAfter).toBe(0);
    expect(plan.safeToApply).toBe(true);
  });
});
