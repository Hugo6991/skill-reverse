import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const envPath = new URL("../.dev.vars", import.meta.url);
const testSiteKey = "1x00000000000000000000AA";
const testSecret = "1x0000000000000000000000000000000AA";

if (!existsSync(envPath)) {
  const values = [
    "APP_MODE=demo",
    "PERPLEXITY_API_KEY=",
    "TWITTERAPI_KEY=",
    `TURNSTILE_SITE_KEY=${testSiteKey}`,
    `TURNSTILE_SECRET_KEY=${testSecret}`,
    `ANON_SESSION_SECRET=${randomBytes(32).toString("hex")}`,
    `SETUP_CAPABILITY=${randomBytes(24).toString("hex")}`,
    ""
  ].join("\n");
  writeFileSync(envPath, values, { mode: 0o600 });
  console.log("✓ Created .dev.vars with Cloudflare's official local test keys");
} else {
  console.log("• .dev.vars already exists; left unchanged");
}

const migration = spawnSync("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "DB", "--local"], {
  stdio: "inherit",
  shell: process.platform === "win32"
});
if (migration.status !== 0) process.exit(migration.status ?? 1);

console.log("\n✓ Local setup complete");
console.log("  Run: pnpm dev");
console.log("  Open: http://localhost:5173");
console.log("  Demo mode never calls Perplexity, TwitterAPI.io, or Browser Run.");
