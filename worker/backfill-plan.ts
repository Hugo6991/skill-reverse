import type { GameMotifId, GameProfile, ReverseReport } from "../src/types";
import {
  GAME_MOTIF_IDS,
  hasCurrentIdentity,
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
  report: ReverseReport;
  profile: GameProfile;
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

function hasCurrentProfile(value: unknown): value is GameProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Partial<GameProfile>;
  return (
    profile.rubricVersion === "game-profile-v2" &&
    hasCurrentIdentity(profile.identity) &&
    Array.isArray(profile.axes) &&
    profile.axes.length === 6
  );
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
      const original = JSON.parse(row.payload_json) as ReverseReport;
      const stored = {
        ...original,
        claims: original.claims.map((claim) => ({
          ...claim,
          confidence: confidenceFromScore(claim.score)
        }))
      };
      const context = contextByActor.get(row.actor_hash) ?? {
        usedTitles: [],
        motifUsage: Object.fromEntries(
          GAME_MOTIF_IDS.map((motif) => [motif, 0])
        ) as Record<GameMotifId, number>
      };
      const profile = hasCurrentProfile(stored.gameProfile)
        ? stored.gameProfile
        : computeGameProfile(stored, [], context);
      if (!hasCurrentProfile(profile)) {
        throw new Error("computed profile is incomplete");
      }
      context.usedTitles?.push(profile.identity.title);
      context.motifUsage![profile.identity.motifId] =
        (context.motifUsage![profile.identity.motifId] ?? 0) + 1;
      contextByActor.set(row.actor_hash, context);
      const needsReportUpdate =
        !hasCurrentProfile(stored.gameProfile) ||
        JSON.stringify(original.claims) !== JSON.stringify(stored.claims) ||
        JSON.stringify(stored.gameProfile) !== JSON.stringify(profile);
      const report = needsReportUpdate ? { ...stored, gameProfile: profile } : stored;
      prepared.push({
        row,
        report,
        profile,
        targetKey: row.target_key || targetKey(row.target_url),
        displayName: historyPresentation(
          row.target_url,
          JSON.stringify(report)
        ).displayName,
        needsReportUpdate
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
      item.row.card_game_profile_json !== JSON.stringify(item.profile)
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
      ${sql(JSON.stringify(item.profile))}, ${sql(item.row.published_at || now)}, ${sql(now)},
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
