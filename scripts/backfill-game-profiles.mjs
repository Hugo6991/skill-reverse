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

export async function loadBackfillDependencies() {
  const { createServer } = await import("vite");
  const moduleServer = await createServer({
    configFile: false,
    root: process.cwd(),
    appType: "custom",
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true },
    logLevel: "error"
  });
  try {
    const [gameProfile, history, publication, backfillPlan] = await Promise.all([
      moduleServer.ssrLoadModule("/worker/game-profile.ts"),
      moduleServer.ssrLoadModule("/worker/history.ts"),
      moduleServer.ssrLoadModule("/worker/publication.ts"),
      moduleServer.ssrLoadModule("/worker/backfill-plan.ts")
    ]);
    return {
      computeGameProfile: gameProfile.computeGameProfile,
      historyPresentation: history.historyPresentation,
      targetKey: publication.targetKey,
      planGameProfileBackfill: backfillPlan.planGameProfileBackfill,
      reportUpdateSql: backfillPlan.reportUpdateSql,
      cardUpsertSql: backfillPlan.cardUpsertSql
    };
  } finally {
    await moduleServer.close();
  }
}

export async function runGameProfileBackfill({
  args = process.argv.slice(2),
  now = new Date().toISOString(),
  wrangler = runWrangler
} = {}) {
  const apply = args.includes("--apply");
  const backupConfirmed = args.includes("--backup-confirmed");
  if (apply && !backupConfirmed) {
    console.error("✕ Refusing remote writes without --backup-confirmed");
    console.error("  Run pnpm backup:prod first, then repeat with --apply --backup-confirmed");
    process.exit(1);
  }
  const {
    computeGameProfile,
    historyPresentation,
    targetKey,
    planGameProfileBackfill,
    reportUpdateSql,
    cardUpsertSql
  } = await loadBackfillDependencies();
  console.log(`\n→ ${apply ? "Running" : "Planning"} game-profile-v2 backfill`);
  const payload = parseWranglerJson(
    wrangler(
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
  const plan = planGameProfileBackfill(rows, {
    now,
    computeGameProfile,
    historyPresentation,
    targetKey
  });

  console.log(
    `  ${rows.length} published reports · ${plan.reportUpdates.length} payload updates · ${plan.cardUpserts.length} card upserts`
  );
  console.log(
    `  duplicate titles ${(plan.metrics.duplicateTitleRate * 100).toFixed(1)}% · unknown axes ${(plan.metrics.unknownAxisRate * 100).toFixed(1)}%`
  );
  console.log(`  motifs ${JSON.stringify(plan.metrics.motifDistribution)}`);
  console.log(`  axis averages ${JSON.stringify(plan.metrics.axisAverages)}`);
  if (plan.failures.length) {
    plan.failures.forEach((failure) =>
      console.error(`✕ ${failure.reportId}: ${failure.message}`)
    );
    process.exit(1);
  }
  if (!apply) {
    console.log("✓ Dry run completed without remote writes");
    console.log("  To apply after a backup: --apply --backup-confirmed");
    return;
  }
  if (plan.metrics.concentrated) {
    console.error("✕ Distribution guard stopped the backfill; inspect titles and motifs first");
    process.exit(1);
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
    wrangler([
      "d1",
      "execute",
      "DB",
      "--remote",
      "--command",
      statements.join("; ")
    ]);
  }
  wrangler([
    "d1",
    "execute",
    "DB",
    "--remote",
    "--command",
    `INSERT OR REPLACE INTO app_meta (key, value, updated_at)
     VALUES ('game_profile_backfill_v2', 'complete', '${now.replaceAll("'", "''")}')`
  ]);
  console.log("✓ Game-profile-v2 backfill completed");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runGameProfileBackfill();
}
