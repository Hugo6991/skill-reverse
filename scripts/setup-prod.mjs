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

async function runWithRetries(args, options = {}, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = spawnSync("pnpm", ["exec", "wrangler", ...args], {
      stdio: options.input ? ["pipe", "inherit", "inherit"] : "inherit",
      input: options.input,
      encoding: "utf8",
      shell: process.platform === "win32"
    });
    if (result.status === 0) return;
    if (attempt < attempts) {
      console.log(`Cloudflare request failed; retrying (${attempt}/${attempts})`);
      await wait(attempt * 2_000);
    }
  }
  rl.close();
  process.exit(1);
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

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
const hasOpenRouterKey = remoteSecrets.has("OPENROUTER_API_KEY");
const hasTwitterKey = remoteSecrets.has("TWITTERAPI_KEY");
const hasAnonSessionSecret = remoteSecrets.has("ANON_SESSION_SECRET");
const hasAccessConfig =
  remoteSecrets.has("CF_ACCESS_TEAM_DOMAIN") &&
  remoteSecrets.has("CF_ACCESS_AUD") &&
  remoteSecrets.has("CF_ACCESS_ALLOWED_EMAIL");
const hasTurnstileKeys =
  remoteSecrets.has("TURNSTILE_SITE_KEY") && remoteSecrets.has("TURNSTILE_SECRET_KEY");
if (hasPerplexityKey || hasOpenRouterKey || hasTwitterKey || hasTurnstileKeys) {
  console.log(
    `Existing Worker secrets: ${[
      hasPerplexityKey && "Perplexity",
      hasOpenRouterKey && "OpenRouter",
      hasTwitterKey && "TwitterAPI.io",
      hasTurnstileKeys && "Turnstile",
      hasAccessConfig && "Cloudflare Access"
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

const accessTeamDomain = await ask(
  hasAccessConfig
    ? "Cloudflare Access team domain (leave blank to keep existing)"
    : "Cloudflare Access team domain (for example your-team.cloudflareaccess.com)",
  { optional: hasAccessConfig }
);
const accessAud = await ask(
  hasAccessConfig
    ? "Cloudflare Access application AUD (leave blank to keep existing)"
    : "Cloudflare Access application AUD",
  { optional: hasAccessConfig }
);
const accessAllowedEmail = await askSecret(
  hasAccessConfig
    ? "Cloudflare Access owner email (leave blank to keep existing)"
    : "Cloudflare Access owner email",
  { optional: hasAccessConfig }
);

const perplexityKey = await askSecret(
  hasPerplexityKey ? "Perplexity API key (leave blank to keep existing)" : "Perplexity API key",
  { optional: hasPerplexityKey }
);
const openRouterKey = await askSecret(
  hasOpenRouterKey
    ? "OpenRouter API key (leave blank to keep existing)"
    : "OpenRouter API key for OpenAI synthesis",
  { optional: true }
);
const twitterKey = await askSecret(
  hasTwitterKey ? "TwitterAPI.io key (leave blank to keep existing)" : "TwitterAPI.io key",
  { optional: true }
);
let turnstile;
if (!hasTurnstileKeys) {
  const automateTurnstile = (
    await askSecret("Scoped Cloudflare token with Turnstile Sites Write", { optional: true })
  ).trim();
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
}

const setupCapability = randomBytes(32).toString("hex");
const secrets = {
  SETUP_COMPLETE: "false",
  SETUP_CAPABILITY: setupCapability
};
if (turnstile) {
  secrets.TURNSTILE_SITE_KEY = turnstile.siteKey;
  secrets.TURNSTILE_SECRET_KEY = turnstile.secretKey;
}
if (!hasAnonSessionSecret) {
  secrets.ANON_SESSION_SECRET = randomBytes(32).toString("hex");
}
if (perplexityKey) secrets.PERPLEXITY_API_KEY = perplexityKey;
if (openRouterKey) secrets.OPENROUTER_API_KEY = openRouterKey;
if (twitterKey) secrets.TWITTERAPI_KEY = twitterKey;
if (accessTeamDomain) secrets.CF_ACCESS_TEAM_DOMAIN = accessTeamDomain;
if (accessAud) secrets.CF_ACCESS_AUD = accessAud;
if (accessAllowedEmail) secrets.CF_ACCESS_ALLOWED_EMAIL = accessAllowedEmail.trim().toLowerCase();

run(["d1", "migrations", "apply", "DB", "--remote"]);
const backfill = spawnSync("node", ["scripts/backfill-target-keys.mjs"], {
  stdio: "inherit",
  shell: process.platform === "win32"
});
if (backfill.status !== 0) {
  rl.close();
  process.exit(backfill.status ?? 1);
}
run(["deploy"]);
for (const [name, value] of Object.entries(secrets)) {
  await runWithRetries(["secret", "put", name], { input: `${value}\n` });
}

let health;
for (let attempt = 0; attempt < 10; attempt += 1) {
  const response = await fetch(`${deployment.origin}/api/health?deep=1`, {
    headers: { "x-setup-capability": setupCapability }
  });
  health = await response.json();
  if (response.ok && health.checks) break;
  if (attempt < 9) await wait(3_000);
}
if (!health?.checks) {
  console.error("\nProduction remains locked. Setup capability did not propagate.");
  rl.close();
  process.exit(1);
}

console.log("\nPreflight");
for (const [name, result] of Object.entries(health.checks ?? {})) {
  const optionalFailure = (name === "social" || name === "openrouter") && !result.ok;
  console.log(`${result.ok ? "✓" : optionalFailure ? "!" : "✕"} ${name}: ${result.detail ?? ""}`);
}
const requiredFailures = Object.entries(health.checks ?? {}).filter(
  ([name, result]) => name !== "social" && name !== "openrouter" && !result.ok
);
if (requiredFailures.length) {
  console.error("\nProduction remains locked. Fix the red checks, then run setup:prod again.");
  rl.close();
  process.exit(1);
}

console.log("\nLive research smoke");
let smokeResponse;
let smoke;
for (let attempt = 0; attempt < 10; attempt += 1) {
  smokeResponse = await fetch(`${deployment.origin}/api/setup/smoke`, {
    method: "POST",
    headers: { "x-setup-capability": setupCapability }
  });
  smoke = await smokeResponse.json();
  if (smokeResponse.status !== 401) break;
  if (attempt < 9) await wait(3_000);
}
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
const gameProfileIsValid =
  /^game-profile-v1(?:\.\d+)?$/.test(smokeReport.gameProfile?.rubricVersion ?? "") &&
  Array.isArray(smokeReport.gameProfile?.axes) &&
  smokeReport.gameProfile.axes.length === 6 &&
  new Set(smokeReport.gameProfile.axes.map((axis) => axis.id)).size === 6;
if (
  !smokeReportResponse.ok ||
  !citationsAreValid ||
  !verifiedClaimsAreSupported ||
  !gameProfileIsValid
) {
  console.error("✕ Smoke report failed citation claim or game-profile validation");
  console.error("Production remains locked");
  rl.close();
  process.exit(1);
}
console.log(`✓ Live report passed · ${smokeReport.sources.length} sources · $${smokeJob.costUsd}`);

run(["secret", "put", "SETUP_COMPLETE"], { input: "true\n" });
console.log("\n✓ Production unlocked");
console.log(`  Health: ${deployment.origin}/api/health`);
if (process.env.SKILL_REVERSE_AUTOMATED === "1") {
  console.log("  Setup capability was withheld from automated logs");
  console.log("  Run setup:prod interactively later if you need a saved deep-doctor capability");
} else {
  console.log(`  Setup capability (shown once): ${setupCapability}`);
  console.log("  Save it in your password manager for future deep doctor checks");
}
rl.close();
