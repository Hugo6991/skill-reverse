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

function sql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function main() {
  const remote = process.argv.includes("--remote");
  const apply = process.argv.includes("--apply");
  const backupConfirmed = process.argv.includes("--backup-confirmed");
  if (!remote) {
    throw new Error("Pass --remote explicitly. Identity repair only targets production D1.");
  }
  if (apply && !backupConfirmed) {
    throw new Error("Refusing writes without --backup-confirmed after a production backup.");
  }

  const { createServer } = await import("vite");
  const moduleServer = await createServer({
    configFile: false,
    root: process.cwd(),
    appType: "custom",
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true },
    logLevel: "error"
  });
  let planIdentityRepair;
  try {
    ({ planIdentityRepair } = await moduleServer.ssrLoadModule(
      "/worker/identity-repair.ts"
    ));
  } finally {
    await moduleServer.close();
  }
  console.log(`\n→ ${apply ? "Applying" : "Planning"} four-beat identity repair`);
  const payload = parseWranglerJson(
    runWrangler(
      [
        "d1",
        "execute",
        "DB",
        "--remote",
        "--json",
        "--command",
        `SELECT r.id AS report_id, r.payload_json, r.content_schema_version,
                r.created_at AS report_created_at, j.actor_hash,
                sc.id AS card_id, sc.game_profile_json AS card_game_profile_json
         FROM reports r
         JOIN jobs j ON j.id = r.job_id
         LEFT JOIN skill_cards sc ON sc.report_id = r.id
         WHERE j.status = 'completed'
         ORDER BY r.created_at, r.id`
      ],
      { capture: true }
    )
  );
  const rows = payload.flatMap((entry) => entry.results ?? []);
  const plan = planIdentityRepair(rows);

  for (const item of plan.changes) {
    const marker = item.reportChanged || item.cardChanged ? "→" : "=";
    console.log(
      `  ${marker} ${item.reportId} · ${item.beforeTitle ?? "(missing)"} → ${item.afterTitle} · ${item.reason}`
    );
  }
  const metrics = plan.metrics;
  console.log(
    `\n  ${metrics.total} reports · ${plan.writes.length} writes · ` +
      `invalid ${metrics.invalidBefore} → ${metrics.invalidAfter} · ` +
      `duplicates ${(metrics.duplicateRateBefore * 100).toFixed(1)}% → ` +
      `${(metrics.duplicateRateAfter * 100).toFixed(1)}%`
  );
  console.log(
    `  fallback ${(metrics.fallbackRate * 100).toFixed(1)}% · motifs ${JSON.stringify(metrics.motifDistribution)}`
  );
  for (const failure of plan.failures) {
    console.error(`✕ ${failure.reportId}: ${failure.message}`);
  }
  if (!plan.safeToApply) {
    throw new Error("Repair guard failed; no writes were made.");
  }
  if (!apply) {
    console.log("✓ Dry run passed without remote writes");
    return;
  }

  const now = new Date().toISOString();
  for (const item of plan.writes) {
    const statements = [
      item.reportChanged
        ? `UPDATE reports SET payload_json = ${sql(item.reportPayloadJson)} WHERE id = ${sql(item.reportId)}`
        : undefined,
      item.cardChanged && item.cardId && item.cardGameProfileJson
        ? `UPDATE skill_cards SET game_profile_json = ${sql(item.cardGameProfileJson)}, updated_at = ${sql(now)} WHERE id = ${sql(item.cardId)} AND report_id = ${sql(item.reportId)}`
        : undefined
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
     VALUES ('game_identity_four_beat_v1', 'complete', ${sql(now)})`
  ]);
  console.log("✓ Four-beat identity repair completed");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
