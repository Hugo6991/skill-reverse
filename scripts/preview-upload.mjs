import { spawnSync } from "node:child_process";

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

const branch =
  process.env.WORKERS_CI_BRANCH ||
  capture("git", ["branch", "--show-current"]) ||
  "detached";
const commit =
  process.env.WORKERS_CI_COMMIT_SHA ||
  capture("git", ["rev-parse", "--short=12", "HEAD"]);
const previewAlias = branch
  .toLowerCase()
  .replace(/^codex\//, "")
  .replace(/[^a-z0-9-]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 48) || "preview";

console.log(`\n→ Preview upload ${branch}@${commit}`);
run("pnpm", ["copycheck"]);
run("pnpm", ["fontcheck"]);
run("pnpm", ["typecheck"]);
run("pnpm", ["test"]);
run("pnpm", ["build"]);
run("pnpm", [
  "exec",
  "wrangler",
  "versions",
  "upload",
  "--strict",
  "--preview-alias",
  previewAlias,
  "--message",
  `preview ${branch}@${commit}`
]);
