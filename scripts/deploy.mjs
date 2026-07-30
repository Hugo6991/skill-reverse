import { spawnSync } from "node:child_process";

const PRODUCTION_BRANCH = "main";

function capture(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: process.platform === "win32"
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result.stdout.trim();
}

function run(command, args) {
  console.log(`\n→ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const isWorkersBuild = Boolean(process.env.WORKERS_CI);
const branch = isWorkersBuild
  ? process.env.WORKERS_CI_BRANCH
  : capture("git", ["branch", "--show-current"]);
const commit =
  process.env.WORKERS_CI_COMMIT_SHA ||
  capture("git", ["rev-parse", "--short=12", "HEAD"]);
const localOverride =
  !isWorkersBuild &&
  process.env.SKILL_REVERSE_ALLOW_NONCANONICAL_DEPLOY === "1";

if (!branch) {
  console.error("Production deploy refused because the current branch is unknown");
  process.exit(1);
}
if (branch !== PRODUCTION_BRANCH && !localOverride) {
  console.error(
    `Production deploy refused from ${branch}\n` +
      `Use pnpm run preview:upload for feature branches\n` +
      `Production is restricted to ${PRODUCTION_BRANCH}`
  );
  process.exit(1);
}

console.log(`\n→ Production release ${branch}@${commit}`);
run("pnpm", ["copycheck"]);
run("pnpm", ["fontcheck"]);
run("pnpm", ["typecheck"]);
run("pnpm", ["test"]);
run("pnpm", ["build"]);
run("pnpm", ["db:migrate:remote"]);
run("node", ["scripts/backfill-target-keys.mjs"]);
run("pnpm", [
  "exec",
  "wrangler",
  "deploy",
  "--strict",
  "--message",
  `${branch}@${commit}`
]);

if (process.env.SKILL_REVERSE_URL) {
  const response = await fetch(new URL("/api/health", process.env.SKILL_REVERSE_URL));
  if (!response.ok) {
    console.error(`Post-deploy health returned ${response.status}`);
    process.exit(1);
  }
  const health = await response.json();
  console.log(`\n✓ Deployed health: ${health.status}`);
} else {
  console.log(
    "\n✓ Deployed. Set SKILL_REVERSE_URL to enable automatic post-deploy health verification."
  );
}
