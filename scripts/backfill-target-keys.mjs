import { spawnSync } from "node:child_process";

function runWrangler(args, { capture = false } = {}) {
  const result = spawnSync("pnpm", ["exec", "wrangler", ...args], {
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
    shell: process.platform === "win32"
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result.stdout ?? "";
}

function parseWranglerJson(output) {
  const start = output.indexOf("[");
  if (start < 0) throw new Error("Wrangler did not return a JSON result");
  return JSON.parse(output.slice(start));
}

function normalizeTargetUrl(value) {
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString().replace(/\/$/, "");
}

function sql(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

console.log("\n→ Backfilling canonical public target keys");
const payload = parseWranglerJson(
  runWrangler(
    [
      "d1",
      "execute",
      "DB",
      "--remote",
      "--json",
      "--command",
      "SELECT id, target_url FROM jobs ORDER BY created_at"
    ],
    { capture: true }
  )
);
const rows = payload.flatMap((entry) => entry.results ?? []);
if (rows.length === 0) {
  console.log("✓ No existing jobs need a target key");
  process.exit(0);
}

const statements = rows.map(
  (row) =>
    `UPDATE jobs SET target_key = ${sql(normalizeTargetUrl(row.target_url))} WHERE id = ${sql(row.id)}`
);
runWrangler(["d1", "execute", "DB", "--remote", "--command", statements.join("; ")]);
console.log(`✓ Backfilled ${rows.length} target keys`);
