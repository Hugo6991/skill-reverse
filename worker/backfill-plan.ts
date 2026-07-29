import type { GameProfile, ReverseReport } from "../src/types";

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
  computeGameProfile: (report: ReverseReport) => GameProfile;
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
    /^game-profile-v1(?:\.\d+)?$/.test(profile.rubricVersion ?? "") &&
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

  for (const row of rows) {
    try {
      const stored = JSON.parse(row.payload_json) as ReverseReport;
      const profile = hasCurrentProfile(stored.gameProfile)
        ? stored.gameProfile
        : computeGameProfile(stored);
      if (!hasCurrentProfile(profile)) {
        throw new Error("computed profile is incomplete");
      }
      const report = hasCurrentProfile(stored.gameProfile)
        ? stored
        : { ...stored, gameProfile: profile };
      prepared.push({
        row,
        report,
        profile,
        targetKey: row.target_key || targetKey(row.target_url),
        displayName: historyPresentation(
          row.target_url,
          JSON.stringify(report)
        ).displayName,
        needsReportUpdate: !hasCurrentProfile(stored.gameProfile)
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

  return { reportUpdates, cardUpserts, failures, expiresAt };
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
