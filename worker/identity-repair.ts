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
  GAME_IDENTITY_NAMING_VERSION,
  GAME_MOTIF_IDS,
  isFourBeatTitle,
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
  reason: "missing" | "invalid" | "version" | "unchanged";
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

function repairReason(identity: unknown): IdentityRepairChange["reason"] {
  if (!isRecord(identity) || typeof identity.title !== "string") return "missing";
  if (!isFourBeatTitle(identity.title)) return "invalid";
  return identity.namingVersion === GAME_IDENTITY_NAMING_VERSION
    ? "unchanged"
    : "version";
}

function stampEnglishIdentity(identity: GameIdentity): GameIdentity {
  return {
    ...identity,
    namingVersion: GAME_IDENTITY_NAMING_VERSION
  };
}

function repairChineseReport(
  value: unknown,
  context: IdentitySelectionContext
): ReverseReport {
  const upgraded = upgradeStoredReport(value, "zh-TW", context);
  const existing = upgraded.gameProfile.identity;
  const identity = isFourBeatTitle(existing.title)
    ? {
        ...existing,
        namingVersion: GAME_IDENTITY_NAMING_VERSION
      }
    : repairGameIdentity(upgraded, existing, context);
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
                    identity: stampEnglishIdentity(english.gameProfile.identity)
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
    identity: {
      ...english.identity,
      namingVersion: GAME_IDENTITY_NAMING_VERSION,
      motifId: source.identity.motifId,
      evidenceUrls: source.identity.evidenceUrls,
      source: source.identity.source
    }
  };
}

function repairCardPayload(value: unknown, source: GameProfile): GameProfile | BilingualGameProfileBundle {
  if (isBilingualGameProfileBundle(value)) {
    const english = value.locales.en;
    return {
      ...value,
      locales: {
        ...value.locales,
        "zh-TW": source,
        ...(english ? { en: localizedCardProfile(english, source) } : {})
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
  const contextByActor = new Map<string, IdentitySelectionContext>();
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
      if (!beforeTitle || !isFourBeatTitle(beforeTitle)) invalidBefore += 1;
      if (beforeTitle) beforeKeys.push(`${row.actor_hash}\u0000${beforeTitle}`);

      const context = contextByActor.get(row.actor_hash) ?? {
        usedTitles: [],
        motifUsage: Object.fromEntries(
          GAME_MOTIF_IDS.map((motif) => [motif, 0])
        ) as Record<GameMotifId, number>
      };
      const sourceBefore = isBilingualReportBundle(originalPayload)
        ? originalPayload.locales["zh-TW"]
        : originalPayload;
      const existingIdentity =
        isRecord(sourceBefore) && isGameProfile(sourceBefore.gameProfile)
          ? sourceBefore.gameProfile.identity
          : cardProfile?.identity;
      const reason = repairReason(existingIdentity);
      const repaired = repairReportPayload(
        originalPayload,
        context,
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
      if (!isFourBeatTitle(afterTitle)) invalidAfter += 1;
      afterKeys.push(`${row.actor_hash}\u0000${afterTitle}`);
      context.usedTitles!.push(afterTitle);
      context.motifUsage![profile.identity.motifId] =
        (context.motifUsage![profile.identity.motifId] ?? 0) + 1;
      contextByActor.set(row.actor_hash, context);
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
