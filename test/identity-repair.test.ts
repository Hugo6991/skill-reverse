import { describe, expect, it } from "vitest";
import {
  createBilingualGameProfileBundle,
  createBilingualReportBundle
} from "../src/bilingual";
import type {
  BilingualGameProfileBundle,
  GameIdentity,
  ReverseReport
} from "../src/types";
import { demoReport, demoReportEn } from "../worker/demo";
import { isFourBeatTitle, repairGameIdentity } from "../worker/game-identity";
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

function reportWithCustomEnglishIdentityCopy(id: string): ReverseReport {
  return {
    ...demoReportEn,
    id,
    gameProfile: {
      ...demoReportEn.gameProfile,
      identity: {
        ...demoReportEn.gameProfile.identity,
        title: "Custom Editorial Persona",
        signatureMove: "Custom translated signature move.",
        strength: "Custom translated strength.",
        shadow: "Custom translated shadow.",
        beats: [
          {
            ...demoReportEn.gameProfile.identity.beats[0],
            text: "Custom translated beat 1."
          },
          {
            ...demoReportEn.gameProfile.identity.beats[1],
            text: "Custom translated beat 2."
          },
          {
            ...demoReportEn.gameProfile.identity.beats[2],
            text: "Custom translated beat 3."
          }
        ],
        titleRationale: [
          {
            ...demoReportEn.gameProfile.identity.titleRationale[0],
            explanation: "Custom translated rationale 1."
          },
          {
            ...demoReportEn.gameProfile.identity.titleRationale[1],
            explanation: "Custom translated rationale 2."
          }
        ]
      }
    }
  };
}

function englishIdentityCopy(identity: GameIdentity) {
  return {
    title: identity.title,
    signatureMove: identity.signatureMove,
    strength: identity.strength,
    shadow: identity.shadow,
    beats: identity.beats.map((item) => item.text),
    titleRationale: identity.titleRationale.map((item) => item.explanation)
  };
}

function identityStructure(identity: GameIdentity) {
  return {
    identityVersion: identity.identityVersion,
    primaryMethodTypeId: identity.primaryMethodTypeId,
    secondaryMethodTypeId: identity.secondaryMethodTypeId,
    titleRationale: identity.titleRationale.map((item) => ({
      segment: item.segment,
      evidenceRefs: item.evidenceRefs
    })),
    beats: identity.beats.map((item) => ({
      kind: item.kind,
      evidenceRefs: item.evidenceRefs
    })),
    methodSignals: identity.methodSignals,
    motifId: identity.motifId,
    evidenceUrls: identity.evidenceUrls,
    source: identity.source
  };
}

describe("four-beat identity repair", () => {
  it("eliminates collisions between current identities and newly repaired titles", () => {
    const first = {
      ...demoReport,
      id: "report-current-1"
    };
    const second = {
      ...demoReport,
      id: "report-current-2"
    };
    const legacyThreat = reportWithTitle(
      "report-legacy-threat",
      "以可編輯威脅模型為中"
    );
    const currentThreat = {
      ...legacyThreat,
      id: "report-current-threat",
      gameProfile: {
        ...legacyThreat.gameProfile,
        identity: repairGameIdentity(
          legacyThreat,
          legacyThreat.gameProfile.identity
        )
      }
    };
    const plan = planIdentityRepair([
      row(first, first.gameProfile, {
        report_id: first.id,
        card_id: first.id,
        report_created_at: "2026-07-28T00:00:00.000Z"
      }),
      row(second, second.gameProfile, {
        report_id: second.id,
        card_id: second.id,
        report_created_at: "2026-07-29T00:00:00.000Z"
      }),
      row(legacyThreat, legacyThreat.gameProfile, {
        report_id: legacyThreat.id,
        card_id: legacyThreat.id,
        report_created_at: "2026-07-30T00:00:00.000Z"
      }),
      row(currentThreat, currentThreat.gameProfile, {
        report_id: currentThreat.id,
        card_id: currentThreat.id,
        report_created_at: "2026-07-31T00:00:00.000Z"
      })
    ]);

    expect(plan.metrics).toMatchObject({
      invalidBefore: 1,
      invalidAfter: 0,
      duplicateTitlesBefore: 1,
      duplicateTitlesAfter: 0,
      duplicateRateAfter: 0
    });
    expect(new Set(plan.changes.map((item) => item.afterTitle)).size).toBe(4);
    expect(plan.changes.every((item) => isFourBeatTitle(item.afterTitle))).toBe(true);
    expect(plan.changes.map((item) => item.reason)).toEqual([
      "unchanged",
      "duplicate",
      "invalid",
      "duplicate"
    ]);
    const retitled = JSON.parse(
      plan.changes[1].reportPayloadJson
    ) as ReverseReport;
    const {
      title: _beforeTitle,
      titleRationale: beforeRationale,
      ...beforeIdentityStructure
    } = second.gameProfile.identity;
    const {
      title: retitledTitle,
      titleRationale: afterRationale,
      ...afterIdentityStructure
    } = retitled.gameProfile.identity;
    expect(afterIdentityStructure).toEqual(beforeIdentityStructure);
    expect(afterRationale.map((item) => item.evidenceRefs)).toEqual(
      beforeRationale.map((item) => item.evidenceRefs)
    );
    expect(afterRationale.map((item) => item.segment)).toEqual([
      Array.from(retitledTitle).slice(0, 2).join(""),
      Array.from(retitledTitle).slice(2, 4).join("")
    ]);
    expect(retitled.gameProfile.axes).toEqual(second.gameProfile.axes);
    expect(plan.safeToApply).toBe(true);
  });

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

  it("keeps existing English identity copy when the current source identity is unchanged", () => {
    const source = { ...demoReport, id: "report-current-bilingual" };
    const english = reportWithCustomEnglishIdentityCopy(source.id);
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
      row(bundle, card, { report_id: source.id, card_id: source.id })
    ]);

    expect(plan.safeToApply).toBe(true);
    expect(plan.writes).toHaveLength(0);
    expect(plan.changes[0]).toMatchObject({
      reason: "unchanged",
      reportChanged: false,
      cardChanged: false
    });
    expect(plan.changes[0].reportPayloadJson).toBe(JSON.stringify(bundle));
    expect(plan.changes[0].cardGameProfileJson).toBe(JSON.stringify(card));
  });

  it("syncs changed bilingual identity structure without rewriting English copy", () => {
    const firstSource = { ...demoReport, id: "report-current-first" };
    const secondSource = { ...demoReport, id: "report-current-second" };
    const firstEnglish = { ...demoReportEn, id: firstSource.id };
    const secondEnglish = reportWithCustomEnglishIdentityCopy(secondSource.id);
    const metadata = {
      sourceLocale: "zh-TW" as const,
      synthesizedAt: "2026-07-28T00:00:00.000Z",
      synthesisModel: "test",
      translationModel: "test",
      sourceContentHash: "test"
    };
    const firstBundle = createBilingualReportBundle(
      firstSource,
      firstEnglish,
      metadata
    );
    const secondBundle = createBilingualReportBundle(
      secondSource,
      secondEnglish,
      metadata
    );
    const firstCard = createBilingualGameProfileBundle(
      firstSource.gameProfile,
      firstEnglish.gameProfile
    );
    const secondCard = createBilingualGameProfileBundle(
      secondSource.gameProfile,
      secondEnglish.gameProfile
    );
    const plan = planIdentityRepair([
      row(firstBundle, firstCard, {
        report_id: firstSource.id,
        card_id: firstSource.id,
        report_created_at: "2026-07-28T00:00:00.000Z"
      }),
      row(secondBundle, secondCard, {
        report_id: secondSource.id,
        card_id: secondSource.id,
        report_created_at: "2026-07-29T00:00:00.000Z"
      })
    ]);

    expect(plan.safeToApply).toBe(true);
    expect(plan.changes[1]).toMatchObject({
      reason: "duplicate",
      reportChanged: true,
      cardChanged: true
    });
    const repairedBundle = JSON.parse(
      plan.changes[1].reportPayloadJson
    ) as typeof secondBundle;
    const repairedCard = JSON.parse(
      plan.changes[1].cardGameProfileJson!
    ) as BilingualGameProfileBundle;
    const repairedSourceIdentity =
      repairedBundle.locales["zh-TW"]!.gameProfile.identity;
    const repairedEnglishIdentity =
      repairedBundle.locales.en!.gameProfile.identity;
    const repairedCardSourceIdentity = repairedCard.locales["zh-TW"]!.identity;
    const repairedCardEnglishIdentity = repairedCard.locales.en!.identity;

    expect(repairedSourceIdentity.title).not.toBe(
      secondSource.gameProfile.identity.title
    );
    expect(englishIdentityCopy(repairedEnglishIdentity)).toEqual(
      englishIdentityCopy(secondEnglish.gameProfile.identity)
    );
    expect(englishIdentityCopy(repairedCardEnglishIdentity)).toEqual(
      englishIdentityCopy(secondEnglish.gameProfile.identity)
    );
    expect(identityStructure(repairedEnglishIdentity)).toEqual(
      identityStructure(repairedSourceIdentity)
    );
    expect(identityStructure(repairedCardEnglishIdentity)).toEqual(
      identityStructure(repairedCardSourceIdentity)
    );
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
