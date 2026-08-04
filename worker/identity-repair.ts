import {
  isBilingualGameProfileBundle,
  isBilingualReportBundle
} from "../src/bilingual";
import type {
  BilingualGameProfileBundle,
  BilingualReportBundle,
  GameIdentity,
  GameMotifId,
  GameProfile,
  ReverseReport
} from "../src/types";
import {
  GAME_MOTIF_IDS,
  hasCurrentIdentity,
  isFourBeatTitle,
  localizedEnglishIdentity,
  repairGameIdentity,
  type IdentitySelectionContext
} from "./game-identity";
import { upgradeStoredReport } from "./report-compat";

export interface IdentityRepairRow {
  report_id: string;
  actor_hash: string;
  payload_json: string;
  content_schema_version?: number;
  report_created_at?: string | null;
  card_id?: string | null;
  card_game_profile_json?: string | null;
}

export interface IdentityRepairChange {
  reportId: string;
  actorHash: string;
  beforeTitle: string | null;
  afterTitle: string;
  reason: "missing" | "invalid" | "version" | "duplicate" | "unchanged";
  reportPayloadJson: string;
  cardId?: string;
  cardGameProfileJson?: string;
  reportChanged: boolean;
  cardChanged: boolean;
}

export interface IdentityRepairPlan {
  changes: IdentityRepairChange[];
  writes: IdentityRepairChange[];
  failures: Array<{ reportId: string; message: string }>;
  metrics: {
    total: number;
    invalidBefore: number;
    invalidAfter: number;
    duplicateTitlesBefore: number;
    duplicateTitlesAfter: number;
    duplicateRateBefore: number;
    duplicateRateAfter: number;
    fallbackCount: number;
    fallbackRate: number;
    motifDistribution: Record<GameMotifId, number>;
  };
  safeToApply: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isGameProfile(value: unknown): value is GameProfile {
  return (
    isRecord(value) &&
    value.rubricVersion === "game-profile-v2" &&
    isRecord(value.identity) &&
    Array.isArray(value.axes) &&
    value.axes.length === 6
  );
}

function titleOfReportPayload(payload: unknown): string | null {
  if (isBilingualReportBundle(payload)) {
    return payload.locales["zh-TW"]?.gameProfile?.identity?.title ?? null;
  }
  if (!isRecord(payload) || !isRecord(payload.gameProfile)) return null;
  const identity = payload.gameProfile.identity;
  return isRecord(identity) && typeof identity.title === "string"
    ? identity.title
    : null;
}

function repairReason(
  identity: unknown,
  context: IdentitySelectionContext
): IdentityRepairChange["reason"] {
  if (!isRecord(identity) || typeof identity.title !== "string") return "missing";
  if (hasCurrentIdentity(identity)) {
    const title = identity.title.trim();
    return context.usedTitles?.some((used) => used.trim() === title)
      ? "duplicate"
      : "unchanged";
  }
  return isFourBeatTitle(identity.title) ? "version" : "invalid";
}

function stampEnglishIdentity(identity: GameIdentity, source: GameIdentity): GameIdentity {
  return localizedEnglishIdentity(source, identity.title);
}

function sameIdentity(left: GameIdentity, right: GameIdentity): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function repairChineseReport(
  value: unknown,
  context: IdentitySelectionContext
): ReverseReport {
  const upgraded = upgradeStoredReport(value, "zh-TW", context);
  const identity = repairGameIdentity(
    upgraded,
    upgraded.gameProfile.identity,
    context
  );
  return {
    ...upgraded,
    gameProfile: {
      ...upgraded.gameProfile,
      identity
    }
  };
}

function repairReportPayload(
  payload: unknown,
  context: IdentitySelectionContext,
  profileOverride?: GameProfile
): { payload: ReverseReport | BilingualReportBundle; sourceReport: ReverseReport } {
  if (isBilingualReportBundle(payload)) {
    const source = payload.locales["zh-TW"];
    if (!source) throw new Error("Bilingual report is missing zh-TW");
    const repairedSource = repairChineseReport(
      profileOverride ? { ...source, gameProfile: profileOverride } : source,
      context
    );
    const english = payload.locales.en;
    const sourceIdentityChanged = !sameIdentity(
      source.gameProfile.identity,
      repairedSource.gameProfile.identity
    );
    return {
      payload: {
        ...payload,
        locales: {
          ...payload.locales,
          "zh-TW": repairedSource,
          ...(english
            ? {
                en: {
                  ...english,
                  gameProfile: {
                    ...english.gameProfile,
                    identity: sourceIdentityChanged
                      ? stampEnglishIdentity(
                          english.gameProfile.identity,
                          repairedSource.gameProfile.identity
                        )
                      : english.gameProfile.identity
                  }
                }
              }
            : {})
        }
      },
      sourceReport: repairedSource
    };
  }
  const sourceReport = repairChineseReport(
    profileOverride && isRecord(payload)
      ? { ...payload, gameProfile: profileOverride }
      : payload,
    context
  );
  return { payload: sourceReport, sourceReport };
}

function localizedCardProfile(
  english: GameProfile,
  source: GameProfile
): GameProfile {
  return {
    ...english,
    identity: stampEnglishIdentity(english.identity, source.identity)
  };
}

function repairCardPayload(value: unknown, source: GameProfile): GameProfile | BilingualGameProfileBundle {
  if (isBilingualGameProfileBundle(value)) {
    const english = value.locales.en;
    const storedSource = value.locales["zh-TW"];
    const sourceIdentityChanged =
      !storedSource || !sameIdentity(storedSource.identity, source.identity);
    return {
      ...value,
      locales: {
        ...value.locales,
        "zh-TW": source,
        ...(english
          ? {
              en: sourceIdentityChanged
                ? localizedCardProfile(english, source)
                : english
            }
          : {})
      }
    };
  }
  return source;
}

function sourceCardProfile(value: unknown): GameProfile | undefined {
  if (isBilingualGameProfileBundle(value)) {
    const profile = value.locales["zh-TW"];
    return isGameProfile(profile) ? profile : undefined;
  }
  return isGameProfile(value) ? value : undefined;
}

function duplicateCount(keys: string[]): number {
  return keys.length - new Set(keys).size;
}

export function planIdentityRepair(rows: IdentityRepairRow[]): IdentityRepairPlan {
  const failures: IdentityRepairPlan["failures"] = [];
  const changes: IdentityRepairChange[] = [];
  const globalContext: IdentitySelectionContext = {
    usedTitles: [],
    motifUsage: Object.fromEntries(
      GAME_MOTIF_IDS.map((motif) => [motif, 0])
    ) as Record<GameMotifId, number>
  };
  const beforeKeys: string[] = [];
  const afterKeys: string[] = [];
  let invalidBefore = 0;
  let invalidAfter = 0;
  let fallbackCount = 0;
  const motifDistribution = Object.fromEntries(
    GAME_MOTIF_IDS.map((motif) => [motif, 0])
  ) as Record<GameMotifId, number>;

  for (const row of rows) {
    try {
      const originalPayload = JSON.parse(row.payload_json) as unknown;
      const originalCard =
        row.card_game_profile_json
          ? (JSON.parse(row.card_game_profile_json) as unknown)
          : undefined;
      const cardProfile = sourceCardProfile(originalCard);
      const beforeTitle =
        titleOfReportPayload(originalPayload) ??
        cardProfile?.identity?.title ??
        null;
      const sourceBefore = isBilingualReportBundle(originalPayload)
        ? originalPayload.locales["zh-TW"]
        : originalPayload;
      const existingIdentity =
        isRecord(sourceBefore) && isGameProfile(sourceBefore.gameProfile)
          ? sourceBefore.gameProfile.identity
          : cardProfile?.identity;
      if (!hasCurrentIdentity(existingIdentity)) invalidBefore += 1;
      if (beforeTitle) beforeKeys.push(beforeTitle);
      const reason = repairReason(existingIdentity, globalContext);
      const repaired = repairReportPayload(
        originalPayload,
        globalContext,
        cardProfile
      );
      const profile = repaired.sourceReport.gameProfile;
      if (
        cardProfile &&
        JSON.stringify(profile.axes) !== JSON.stringify(cardProfile.axes)
      ) {
        throw new Error("Repair changed stored card axes");
      }
      const afterTitle = profile.identity.title;
      if (!hasCurrentIdentity(profile.identity)) invalidAfter += 1;
      afterKeys.push(afterTitle);
      globalContext.usedTitles!.push(afterTitle);
      globalContext.motifUsage![profile.identity.motifId] =
        (globalContext.motifUsage![profile.identity.motifId] ?? 0) + 1;
      motifDistribution[profile.identity.motifId] += 1;
      if (profile.identity.source === "fallback") fallbackCount += 1;

      const reportPayloadJson = JSON.stringify(repaired.payload);
      let cardGameProfileJson: string | undefined;
      if (row.card_id && row.card_game_profile_json) {
        cardGameProfileJson = JSON.stringify(
          repairCardPayload(originalCard, profile)
        );
      }
      changes.push({
        reportId: row.report_id,
        actorHash: row.actor_hash,
        beforeTitle,
        afterTitle,
        reason,
        reportPayloadJson,
        cardId: row.card_id ?? undefined,
        cardGameProfileJson,
        reportChanged: reportPayloadJson !== row.payload_json,
        cardChanged:
          cardGameProfileJson !== undefined &&
          cardGameProfileJson !== row.card_game_profile_json
      });
    } catch (error) {
      failures.push({
        reportId: row.report_id,
        message: error instanceof Error ? error.message : "Unknown repair error"
      });
    }
  }

  const duplicateTitlesBefore = duplicateCount(beforeKeys);
  const duplicateTitlesAfter = duplicateCount(afterKeys);
  const total = changes.length;
  const writes = changes.filter((item) => item.reportChanged || item.cardChanged);
  return {
    changes,
    writes,
    failures,
    metrics: {
      total,
      invalidBefore,
      invalidAfter,
      duplicateTitlesBefore,
      duplicateTitlesAfter,
      duplicateRateBefore: total ? duplicateTitlesBefore / total : 0,
      duplicateRateAfter: total ? duplicateTitlesAfter / total : 0,
      fallbackCount,
      fallbackRate: total ? fallbackCount / total : 0,
      motifDistribution
    },
    safeToApply:
      failures.length === 0 &&
      invalidAfter === 0 &&
      duplicateTitlesAfter === 0
  };
}
