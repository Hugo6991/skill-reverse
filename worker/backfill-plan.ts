import { isBilingualReportBundle } from "../src/bilingual";
import type {
  BilingualGameProfileBundle,
  BilingualReportBundle,
  GameMotifId,
  GameProfile,
  Locale,
  ReportPayload,
  ReverseReport
} from "../src/types";
import {
  GAME_MOTIF_IDS,
  hasCurrentIdentity,
  localizedEnglishIdentity,
  type IdentitySelectionContext
} from "./game-identity";
import { confidenceFromScore } from "./game-profile";

export interface PublishedReportRow {
  report_id: string;
  payload_json: string;
  report_created_at?: string | null;
  job_id: string;
  actor_hash: string;
  target_url: string;
  target_key?: string | null;
  occupation_code: string;
  occupation_title: string;
  published_at?: string | null;
  card_report_id?: string | null;
  card_game_profile_json?: string | null;
}

export interface BackfillItem {
  row: PublishedReportRow;
  report: ReportPayload;
  profile: GameProfile;
  cardProfile: GameProfile | BilingualGameProfileBundle;
  targetKey: string;
  displayName: string;
  needsReportUpdate: boolean;
}

interface BackfillDependencies {
  now: string;
  computeGameProfile: (
    report: ReverseReport,
    candidates?: [],
    context?: IdentitySelectionContext
  ) => GameProfile;
  historyPresentation: (
    targetUrl: string,
    payloadJson: string
  ) => { displayName: string };
  targetKey: (targetUrl: string) => string;
}

function sql(value: unknown) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function hasBaseProfile(value: unknown): value is GameProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Partial<GameProfile>;
  const identity = profile.identity as Partial<GameProfile["identity"]> | undefined;
  return (
    profile.rubricVersion === "game-profile-v2" &&
    Boolean(identity) &&
    typeof identity?.title === "string" &&
    typeof identity?.motifId === "string" &&
    Array.isArray(profile.axes) &&
    profile.axes.length === 6
  );
}

function hasCurrentProfile(value: unknown): value is GameProfile {
  return hasBaseProfile(value) && hasCurrentIdentity(value.identity);
}

function normalizeClaims(report: ReverseReport): ReverseReport {
  if (!Array.isArray(report.claims)) {
    throw new Error("report is missing claims");
  }
  return {
    ...report,
    claims: report.claims.map((claim) => ({
      ...claim,
      confidence: confidenceFromScore(claim.score)
    }))
  };
}

interface PreparedPayload {
  report: ReportPayload;
  profile: GameProfile;
  cardProfile: GameProfile | BilingualGameProfileBundle;
  needsReportUpdate: boolean;
}

function prepareSingleReport(
  original: ReverseReport,
  computeGameProfile: BackfillDependencies["computeGameProfile"],
  context: IdentitySelectionContext
): PreparedPayload {
  const stored = normalizeClaims(original);
  const profile = hasCurrentProfile(stored.gameProfile)
    ? stored.gameProfile
    : computeGameProfile(stored, [], context);
  if (!hasCurrentProfile(profile)) {
    throw new Error("computed profile is incomplete");
  }
  const report = { ...stored, gameProfile: profile };
  return {
    report,
    profile,
    cardProfile: profile,
    needsReportUpdate: JSON.stringify(original) !== JSON.stringify(report)
  };
}

function prepareBilingualReport(
  original: BilingualReportBundle,
  computeGameProfile: BackfillDependencies["computeGameProfile"],
  context: IdentitySelectionContext
): PreparedPayload {
  const source = original.locales["zh-TW"];
  if (!source) {
    throw new Error("bilingual report is missing zh-TW");
  }

  const storedSource = normalizeClaims(source);
  const sourceProfile = hasBaseProfile(storedSource.gameProfile)
    ? storedSource.gameProfile
    : computeGameProfile(storedSource, [], context);
  if (!hasBaseProfile(sourceProfile)) {
    throw new Error("computed zh-TW profile is incomplete");
  }
  const reports: Partial<Record<Locale, ReverseReport>> = {
    "zh-TW": { ...storedSource, gameProfile: sourceProfile }
  };
  const profiles: Partial<Record<Locale, GameProfile>> = {
    "zh-TW": sourceProfile
  };
  for (const locale of original.availableLocales) {
    if (locale === "zh-TW") continue;
    const localized = original.locales[locale];
    if (!localized) {
      throw new Error(`bilingual report is missing ${locale}`);
    }
    const stored = normalizeClaims(localized);
    const existingProfile = hasBaseProfile(stored.gameProfile)
      ? stored.gameProfile
      : undefined;
    const profile = existingProfile ?? {
          ...sourceProfile,
          identity: localizedEnglishIdentity(
            sourceProfile.identity,
            ""
          )
        };
    if (!hasBaseProfile(profile)) {
      throw new Error(`computed ${locale} profile is incomplete`);
    }
    reports[locale] = { ...stored, gameProfile: profile };
    profiles[locale] = profile;
  }

  const report: BilingualReportBundle = {
    ...original,
    locales: { ...original.locales, ...reports }
  };
  const cardProfile: BilingualGameProfileBundle = {
    schemaVersion: 1,
    availableLocales: [...original.availableLocales],
    locales: profiles
  };
  return {
    report,
    profile: sourceProfile,
    cardProfile,
    needsReportUpdate: JSON.stringify(original) !== JSON.stringify(report)
  };
}

function preparePayload(
  original: unknown,
  computeGameProfile: BackfillDependencies["computeGameProfile"],
  context: IdentitySelectionContext
): PreparedPayload {
  if (isBilingualReportBundle(original)) {
    return prepareBilingualReport(original, computeGameProfile, context);
  }
  if (!original || typeof original !== "object" || Array.isArray(original)) {
    throw new Error("report payload is not an object");
  }
  return prepareSingleReport(original as ReverseReport, computeGameProfile, context);
}

export function planGameProfileBackfill(
  rows: PublishedReportRow[],
  { now, computeGameProfile, historyPresentation, targetKey }: BackfillDependencies
) {
  const prepared: BackfillItem[] = [];
  const failures: Array<{ reportId: string; message: string }> = [];
  const contextByActor = new Map<string, IdentitySelectionContext>();

  for (const row of rows) {
    try {
      const original = JSON.parse(row.payload_json) as unknown;
      const context = contextByActor.get(row.actor_hash) ?? {
        usedTitles: [],
        motifUsage: Object.fromEntries(
          GAME_MOTIF_IDS.map((motif) => [motif, 0])
        ) as Record<GameMotifId, number>
      };
      const preparedPayload = preparePayload(original, computeGameProfile, context);
      const { profile } = preparedPayload;
      context.usedTitles?.push(profile.identity.title);
      context.motifUsage![profile.identity.motifId] =
        (context.motifUsage![profile.identity.motifId] ?? 0) + 1;
      contextByActor.set(row.actor_hash, context);
      prepared.push({
        row,
        report: preparedPayload.report,
        profile,
        cardProfile: preparedPayload.cardProfile,
        targetKey: row.target_key || targetKey(row.target_url),
        displayName: historyPresentation(
          row.target_url,
          JSON.stringify(preparedPayload.report)
        ).displayName,
        needsReportUpdate: preparedPayload.needsReportUpdate
      });
    } catch (error) {
      failures.push({
        reportId: row.report_id,
        message: error instanceof Error ? error.message : "unknown error"
      });
    }
  }

  const latestCardByKey = new Map<string, BackfillItem>();
  for (const item of prepared) {
    const key = `${item.row.actor_hash}\u0000${item.targetKey}\u0000${item.row.occupation_code}`;
    latestCardByKey.set(key, item);
  }

  const reportUpdates = prepared.filter((item) => item.needsReportUpdate);
  const cardUpserts = [...latestCardByKey.values()].filter(
    (item) =>
      item.row.card_report_id !== item.row.report_id ||
      item.row.card_game_profile_json !== JSON.stringify(item.cardProfile)
  );
  const expiresAt = new Date(
    new Date(now).getTime() + 365 * 86_400_000
  ).toISOString();
  const titleKeys = prepared.map(
    (item) => `${item.row.actor_hash}\u0000${item.profile.identity.title}`
  );
  const duplicateTitles = titleKeys.length - new Set(titleKeys).size;
  const motifDistribution = Object.fromEntries(
    GAME_MOTIF_IDS.map((motif) => [
      motif,
      prepared.filter((item) => item.profile.identity.motifId === motif).length
    ])
  ) as Record<GameMotifId, number>;
  const unknownAxes = prepared.reduce(
    (sum, item) => sum + item.profile.axes.filter((axis) => axis.value === undefined).length,
    0
  );
  const axisAverages = Object.fromEntries(
    ["money", "spectacle", "potency", "activation", "renown", "ascension"].map((axisId) => {
      const values = prepared
        .map((item) => item.profile.axes.find((axis) => axis.id === axisId)?.value)
        .filter((value): value is number => value !== undefined);
      return [
        axisId,
        values.length
          ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
          : null
      ];
    })
  );
  const metrics = {
    duplicateTitleRate: prepared.length ? duplicateTitles / prepared.length : 0,
    motifDistribution,
    unknownAxisRate: prepared.length ? unknownAxes / (prepared.length * 6) : 0,
    axisAverages,
    // Method types and their motifs may naturally concentrate; only identity-title
    // collisions block rollout.
    concentrated: duplicateTitles > 0
  };

  return { reportUpdates, cardUpserts, failures, expiresAt, metrics };
}

export function reportUpdateSql(item: BackfillItem) {
  return `UPDATE reports SET payload_json = ${sql(JSON.stringify(item.report))} WHERE id = ${sql(item.row.report_id)}`;
}

export function cardUpsertSql(
  item: BackfillItem,
  now: string,
  expiresAt: string
) {
  return `INSERT INTO skill_cards
    (id, actor_hash, job_id, report_id, target_key, target_url, display_name,
     occupation_code, occupation_title, game_profile_json, created_at, updated_at, expires_at)
    VALUES (
      ${sql(item.row.report_id)}, ${sql(item.row.actor_hash)}, ${sql(item.row.job_id)},
      ${sql(item.row.report_id)}, ${sql(item.targetKey)}, ${sql(item.row.target_url)},
      ${sql(item.displayName)}, ${sql(item.row.occupation_code)}, ${sql(item.row.occupation_title)},
      ${sql(JSON.stringify(item.cardProfile))}, ${sql(item.row.published_at || now)}, ${sql(now)},
      ${sql(expiresAt)}
    )
    ON CONFLICT(actor_hash, target_key, occupation_code) DO UPDATE SET
      id = excluded.id,
      job_id = excluded.job_id,
      report_id = excluded.report_id,
      target_url = excluded.target_url,
      display_name = excluded.display_name,
      occupation_title = excluded.occupation_title,
      game_profile_json = excluded.game_profile_json,
      updated_at = excluded.updated_at,
      expires_at = excluded.expires_at`;
}
