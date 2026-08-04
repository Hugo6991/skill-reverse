import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function parseWranglerJson(output) {
  const start = output.indexOf("[");
  if (start < 0) throw new Error("Wrangler did not return a JSON result");
  return JSON.parse(output.slice(start));
}

function runWrangler(args, { capture = false } = {}) {
  const wrangler = resolve("node_modules", ".bin", process.platform === "win32" ? "wrangler.cmd" : "wrangler");
  let result;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    result = spawnSync(wrangler, args, {
      encoding: "utf8",
      stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
      maxBuffer: 20 * 1024 * 1024,
      shell: process.platform === "win32"
    });
    if (result.status === 0) return result.stdout ?? "";
    if (attempt < 4) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, attempt * 500);
    }
  }
  process.exit(result?.status ?? 1);
}

function sql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sourceIdentity(payloadJson) {
  const payload = JSON.parse(payloadJson);
  return payload?.locales?.["zh-TW"]?.gameProfile?.identity ??
    payload?.gameProfile?.identity ??
    null;
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
  console.log(`\n→ ${apply ? "Applying" : "Planning"} method-persona-v1 repair`);
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
                sc.id AS card_id, sc.game_profile_json AS card_game_profile_json,
                sc.updated_at AS card_updated_at
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
  const rowByReport = new Map(rows.map((row) => [row.report_id, row]));

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
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const reviewDir = resolve(".backups", `method-persona-${stamp}`);
  mkdirSync(reviewDir, { recursive: true });
  const review = plan.changes.map((item) => {
    const identity = sourceIdentity(item.reportPayloadJson);
    return {
      reportId: item.reportId,
      beforeTitle: item.beforeTitle,
      afterTitle: item.afterTitle,
      primaryMethodTypeId: identity?.primaryMethodTypeId ?? "undetermined",
      secondaryMethodTypeId: identity?.secondaryMethodTypeId ?? null,
      signatureMove: identity?.signatureMove ?? "",
      strength: identity?.strength ?? "",
      shadow: identity?.shadow ?? "",
      beats: identity?.beats ?? [],
      titleRationale: identity?.titleRationale ?? [],
      source: identity?.source ?? "fallback",
      reportChanged: item.reportChanged,
      cardChanged: item.cardChanged
    };
  });
  writeFileSync(
    resolve(reviewDir, "review.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), metrics, reports: review }, null, 2),
    "utf8"
  );
  const rollback = plan.writes.flatMap((item) => {
    const row = rowByReport.get(item.reportId);
    if (!row) return [];
    return [
      item.reportChanged
        ? `UPDATE reports SET payload_json = ${sql(row.payload_json)} WHERE id = ${sql(item.reportId)};`
        : undefined,
      item.cardChanged && item.cardId && row.card_game_profile_json
        ? `UPDATE skill_cards SET game_profile_json = ${sql(row.card_game_profile_json)}, updated_at = ${sql(row.card_updated_at ?? new Date().toISOString())} WHERE id = ${sql(item.cardId)} AND report_id = ${sql(item.reportId)};`
        : undefined
    ].filter(Boolean);
  });
  writeFileSync(resolve(reviewDir, "rollback.sql"), rollback.join("\n"), "utf8");
  console.log(`✓ Review list and rollback SQL recorded in ${reviewDir}`);
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
     VALUES ('method_persona_v1', 'complete', ${sql(now)})`
  ]);
  console.log("✓ Method-persona-v1 repair completed");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
