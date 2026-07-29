import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

function parseWranglerJson(output) {
  const start = output.indexOf("[");
  if (start < 0) throw new Error("Wrangler did not return a JSON result");
  return JSON.parse(output.slice(start));
}

function runWrangler(args, { capture = false } = {}) {
  const result = spawnSync("pnpm", ["exec", "wrangler", ...args], {
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    maxBuffer: 20 * 1024 * 1024,
    shell: process.platform === "win32"
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result.stdout ?? "";
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const [
    { computeGameProfile },
    { historyPresentation },
    { targetKey },
    { planGameProfileBackfill, reportUpdateSql, cardUpsertSql }
  ] = await Promise.all([
    import("../worker/game-profile.ts"),
    import("../worker/history.ts"),
    import("../worker/publication.ts"),
    import("../worker/backfill-plan.ts")
  ]);
  console.log(`\n→ ${dryRun ? "Planning" : "Running"} game-profile-v1.1 backfill`);
  const payload = parseWranglerJson(
    runWrangler(
      [
        "d1",
        "execute",
        "DB",
        "--remote",
        "--json",
        "--command",
        `SELECT r.id AS report_id, r.payload_json, r.created_at AS report_created_at,
                j.id AS job_id, j.actor_hash, j.target_url, j.target_key,
                j.occupation_code, j.published_at, o.title AS occupation_title,
                sc.report_id AS card_report_id,
                sc.game_profile_json AS card_game_profile_json
         FROM reports r
         JOIN jobs j ON j.id = r.job_id
         LEFT JOIN occupations o ON o.code = j.occupation_code
         LEFT JOIN skill_cards sc
           ON sc.actor_hash = j.actor_hash
          AND sc.target_key = j.target_key
          AND sc.occupation_code = j.occupation_code
         WHERE j.status = 'completed'
           AND j.publication_status = 'published'
         ORDER BY COALESCE(j.published_at, r.created_at), r.id`
      ],
      { capture: true }
    )
  );
  const rows = payload.flatMap((entry) => entry.results ?? []);
  const now = new Date().toISOString();
  const plan = planGameProfileBackfill(rows, {
    now,
    computeGameProfile,
    historyPresentation,
    targetKey
  });

  console.log(
    `  ${rows.length} published reports · ${plan.reportUpdates.length} payload updates · ${plan.cardUpserts.length} card upserts`
  );
  if (plan.failures.length) {
    plan.failures.forEach((failure) =>
      console.error(`✕ ${failure.reportId}: ${failure.message}`)
    );
    process.exit(1);
  }
  if (dryRun) {
    console.log("✓ Dry run completed without remote writes");
    return;
  }

  const updateByReport = new Map(
    plan.reportUpdates.map((item) => [item.row.report_id, reportUpdateSql(item)])
  );
  const cardByReport = new Map(
    plan.cardUpserts.map((item) => [
      item.row.report_id,
      cardUpsertSql(item, now, plan.expiresAt)
    ])
  );
  for (const row of rows) {
    const statements = [
      updateByReport.get(row.report_id),
      cardByReport.get(row.report_id)
    ].filter(Boolean);
    if (!statements.length) continue;
    runWrangler([
      "d1",
      "execute",
      "DB",
      "--remote",
      "--command",
      statements.join("; ")
    ]);
  }
  runWrangler([
    "d1",
    "execute",
    "DB",
    "--remote",
    "--command",
    `INSERT OR REPLACE INTO app_meta (key, value, updated_at)
     VALUES ('game_profile_backfill_v1_1', 'complete', '${now.replaceAll("'", "''")}')`
  ]);
  console.log("✓ Game-profile backfill completed");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
