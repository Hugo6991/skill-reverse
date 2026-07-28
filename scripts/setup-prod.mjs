import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Writable } from "node:stream";

if (!input.isTTY) {
  console.error("setup:prod needs an interactive terminal so secrets never appear in command history.");
  process.exit(1);
}

let muteOutput = false;
const silentOutput = new Writable({
  write(chunk, _encoding, callback) {
    if (!muteOutput) output.write(chunk);
    callback();
  }
});
const rl = createInterface({ input, output: silentOutput, terminal: true });

async function ask(label, { optional = false } = {}) {
  while (true) {
    const value = (await rl.question(`${label}${optional ? " (optional)" : ""}: `)).trim();
    if (value || optional) return value;
    console.log("  This value is required.");
  }
}

async function askSecret(label, { optional = false } = {}) {
  while (true) {
    output.write(`${label}${optional ? " (optional)" : ""}: `);
    muteOutput = true;
    const value = (await rl.question("")).trim();
    muteOutput = false;
    output.write("\n");
    if (value || optional) return value;
    console.log("  This value is required.");
  }
}

function run(args, options = {}) {
  const result = spawnSync("pnpm", ["exec", "wrangler", ...args], {
    stdio: options.input ? ["pipe", "inherit", "inherit"] : "inherit",
    input: options.input,
    encoding: "utf8",
    shell: process.platform === "win32"
  });
  if (result.status !== 0) {
    rl.close();
    process.exit(result.status ?? 1);
  }
}

function listRemoteSecrets() {
  const result = spawnSync("pnpm", ["exec", "wrangler", "secret", "list"], {
    encoding: "utf8",
    shell: process.platform === "win32"
  });
  if (result.status !== 0) return new Set();
  try {
    return new Set(JSON.parse(result.stdout).map((item) => item.name));
  } catch {
    return new Set();
  }
}

async function createTurnstileWidget({ apiToken, accountId, hostname }) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/challenges/widgets`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        name: `Skill Reverse — ${hostname}`,
        domains: [hostname],
        mode: "managed",
        region: "world"
      })
    }
  );
  const payload = await response.json();
  if (!response.ok || !payload.success || !payload.result?.sitekey || !payload.result?.secret) {
    throw new Error(payload.errors?.[0]?.message ?? `Turnstile API returned ${response.status}`);
  }
  return { siteKey: payload.result.sitekey, secretKey: payload.result.secret };
}

console.log("\nSkill Reverse production setup");
console.log("Secrets are sent to Wrangler over stdin and are never written to this repository.\n");

const whoami = spawnSync("pnpm", ["exec", "wrangler", "whoami", "--json"], {
  stdio: "inherit",
  shell: process.platform === "win32"
});
if (whoami.status !== 0) run(["login"]);

const remoteSecrets = listRemoteSecrets();
const hasPerplexityKey = remoteSecrets.has("PERPLEXITY_API_KEY");
const hasTwitterKey = remoteSecrets.has("TWITTERAPI_KEY");
const hasAnonSessionSecret = remoteSecrets.has("ANON_SESSION_SECRET");
if (hasPerplexityKey || hasTwitterKey) {
  console.log(
    `Existing Worker secrets: ${[
      hasPerplexityKey && "Perplexity",
      hasTwitterKey && "TwitterAPI.io"
    ]
      .filter(Boolean)
      .join(", ")}`
  );
}

const deploymentUrl = await ask("Deployed URL (for example https://skill-reverse.example.workers.dev)");
const deployment = new URL(deploymentUrl);
if (deployment.protocol !== "https:") {
  console.error("Production URL must use HTTPS.");
  rl.close();
  process.exit(1);
}

const perplexityKey = await askSecret(
  hasPerplexityKey ? "Perplexity API key (leave blank to keep existing)" : "Perplexity API key",
  { optional: hasPerplexityKey }
);
const twitterKey = await askSecret(
  hasTwitterKey ? "TwitterAPI.io key (leave blank to keep existing)" : "TwitterAPI.io key",
  { optional: true }
);
const automateTurnstile = (
  await askSecret("Scoped Cloudflare token with Turnstile Sites Write", { optional: true })
).trim();

let turnstile;
if (automateTurnstile) {
  const accountId = await ask("Cloudflare Account ID");
  try {
    turnstile = await createTurnstileWidget({
      apiToken: automateTurnstile,
      accountId,
      hostname: deployment.hostname
    });
    console.log("✓ Turnstile widget created and restricted to the production hostname");
  } catch (error) {
    console.error(`Turnstile automation failed: ${error.message}`);
    console.log("Create a Managed widget in the Cloudflare dashboard and paste its keys.");
  }
}
if (!turnstile) {
    turnstile = {
      siteKey: await ask("Turnstile site key"),
      secretKey: await askSecret("Turnstile secret key")
    };
}

const setupCapability = randomBytes(32).toString("hex");
const secrets = {
  TURNSTILE_SITE_KEY: turnstile.siteKey,
  TURNSTILE_SECRET_KEY: turnstile.secretKey,
  SETUP_CAPABILITY: setupCapability,
  SETUP_COMPLETE: "false"
};
if (!hasAnonSessionSecret) {
  secrets.ANON_SESSION_SECRET = randomBytes(32).toString("hex");
}
if (perplexityKey) secrets.PERPLEXITY_API_KEY = perplexityKey;
if (twitterKey) secrets.TWITTERAPI_KEY = twitterKey;

run(["secret", "bulk"], { input: JSON.stringify(secrets) });
run(["d1", "migrations", "apply", "DB", "--remote"]);
run(["deploy"]);

const health = await fetch(`${deployment.origin}/api/health?deep=1`, {
  headers: { "x-setup-capability": setupCapability }
}).then((response) => response.json());

console.log("\nPreflight");
for (const [name, result] of Object.entries(health.checks ?? {})) {
  const optionalFailure = name === "social" && !result.ok;
  console.log(`${result.ok ? "✓" : optionalFailure ? "!" : "✕"} ${name}: ${result.detail ?? ""}`);
}
const requiredFailures = Object.entries(health.checks ?? {}).filter(
  ([name, result]) => name !== "social" && !result.ok
);
if (requiredFailures.length) {
  console.error("\nProduction remains locked. Fix the red checks, then run setup:prod again.");
  rl.close();
  process.exit(1);
}

console.log("\nLive research smoke");
const smokeResponse = await fetch(`${deployment.origin}/api/setup/smoke`, {
  method: "POST",
  headers: { "x-setup-capability": setupCapability }
});
const smoke = await smokeResponse.json();
if (!smokeResponse.ok || !smoke.jobId) {
  console.error(`✕ Smoke could not start: ${smoke.error?.message ?? smokeResponse.status}`);
  console.error("Production remains locked");
  rl.close();
  process.exit(1);
}

let smokeJob;
for (let attempt = 0; attempt < 180; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  const response = await fetch(
    `${deployment.origin}/api/jobs/${encodeURIComponent(smoke.jobId)}`
  );
  smokeJob = await response.json();
  if (smokeJob.status === "completed" || smokeJob.status === "failed") break;
  if (attempt % 10 === 0) {
    console.log(`  ${smokeJob.stage ?? "queued"} · ${smokeJob.progress ?? 0}%`);
  }
}

if (smokeJob?.status !== "completed" || !smokeJob.reportId) {
  console.error(
    `✕ Live research failed: ${smokeJob?.error?.message ?? "smoke timed out"}`
  );
  console.error("Production remains locked");
  rl.close();
  process.exit(1);
}
if (Number(smokeJob.costUsd) > 0.5) {
  console.error(`✕ Smoke exceeded the per-job cap: $${smokeJob.costUsd}`);
  console.error("Production remains locked");
  rl.close();
  process.exit(1);
}

const smokeReportResponse = await fetch(
  `${deployment.origin}/api/reports/${encodeURIComponent(smokeJob.reportId)}`
);
const smokeReport = await smokeReportResponse.json();
const sourceIds = new Set((smokeReport.sources ?? []).map((source) => source.id));
const citationsAreValid =
  (smokeReport.sources?.length ?? 0) > 0 &&
  smokeReport.sources.every((source) => {
    try {
      return new URL(source.url).protocol === "https:";
    } catch {
      return false;
    }
  });
const verifiedClaimsAreSupported = (smokeReport.claims ?? [])
  .filter((claim) => claim.status === "verified")
  .every(
    (claim) =>
      claim.evidenceIds.length > 0 &&
      claim.evidenceIds.every((sourceId) => sourceIds.has(sourceId))
  );
if (!smokeReportResponse.ok || !citationsAreValid || !verifiedClaimsAreSupported) {
  console.error("✕ Smoke report failed citation or verified-claim validation");
  console.error("Production remains locked");
  rl.close();
  process.exit(1);
}
console.log(`✓ Live report passed · ${smokeReport.sources.length} sources · $${smokeJob.costUsd}`);

run(["secret", "put", "SETUP_COMPLETE"], { input: "true\n" });
console.log("\n✓ Production unlocked");
console.log(`  Health: ${deployment.origin}/api/health`);
console.log(`  Setup capability (shown once): ${setupCapability}`);
console.log("  Save it in your password manager for future deep doctor checks");
rl.close();
