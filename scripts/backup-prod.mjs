import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const stamp = new Date().toISOString().replaceAll(":", "-");
const backupDir = resolve(".backups", stamp);
mkdirSync(backupDir, { recursive: true });
const durableTables = [
  "app_meta",
  "d1_migrations",
  "occupations",
  "jobs",
  "job_sources",
  "provider_calls",
  "reports",
  "source_artifacts"
];

function runWrangler(args, { capture = false, attempts = 3 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = spawnSync("pnpm", ["exec", "wrangler", ...args], {
      encoding: "utf8",
      stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
      shell: process.platform === "win32"
    });
    if (result.status === 0) return result.stdout ?? "";
    if (attempt < attempts) {
      console.warn(`\nWrangler failed (attempt ${attempt}/${attempts}); retrying…`);
    } else {
      process.exit(result.status ?? 1);
    }
  }
  return "";
}

const databasePath = resolve(backupDir, "skill-reverse-db.sql");
console.log(`\n→ Exporting production D1 to ${databasePath}`);
runWrangler([
  "d1",
  "export",
  "DB",
  "--remote",
  "--skip-confirmation",
  "--output",
  databasePath,
  ...durableTables.flatMap((table) => ["--table", table])
]);

console.log("\n→ Recording the R2 keys referenced by published reports");
const inventory = runWrangler(
  [
    "d1",
    "execute",
    "DB",
    "--remote",
    "--command",
    `SELECT j.id AS job_id, j.report_id, a.id AS artifact_id, a.r2_key, a.metadata_json
     FROM jobs j
     LEFT JOIN source_artifacts a ON a.job_id = j.id
     WHERE j.status = 'completed' AND j.report_id IS NOT NULL
     ORDER BY j.updated_at DESC, a.id`
  ],
  { capture: true }
);
writeFileSync(resolve(backupDir, "published-r2-inventory.txt"), inventory, "utf8");
writeFileSync(
  resolve(backupDir, "manifest.json"),
  JSON.stringify(
    {
      createdAt: new Date().toISOString(),
      database: "skill-reverse-db",
      bucket: "skill-reverse-artifacts",
      files: ["skill-reverse-db.sql", "published-r2-inventory.txt"],
      includedTables: durableTables,
      excludedRebuildableTables: [
        "occupations_fts",
        "occupations_fts_config",
        "occupations_fts_data",
        "occupations_fts_docsize",
        "occupations_fts_idx"
      ],
      note:
        "D1 export excludes the rebuildable FTS5 index because Cloudflare cannot export virtual tables. The inventory records referenced R2 keys; keep an independent R2 copy for disaster recovery."
    },
    null,
    2
  ),
  "utf8"
);

console.log(`\n✓ Production backup recorded in ${backupDir}`);
console.log("  This directory is gitignored. Copy it to owner-controlled backup storage.");
