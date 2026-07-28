import { spawnSync } from "node:child_process";

function run(command, args) {
  console.log(`\n→ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("pnpm", ["typecheck"]);
run("pnpm", ["test"]);
run("pnpm", ["build"]);
run("pnpm", ["db:migrate:remote"]);
run("pnpm", ["exec", "wrangler", "deploy"]);

if (process.env.SKILL_REVERSE_URL) {
  const response = await fetch(new URL("/api/health", process.env.SKILL_REVERSE_URL));
  if (!response.ok) {
    console.error(`Post-deploy health returned ${response.status}`);
    process.exit(1);
  }
  const health = await response.json();
  console.log(`\n✓ Deployed health: ${health.status}`);
} else {
  console.log("\n✓ Deployed. Set SKILL_REVERSE_URL to enable automatic post-deploy health verification.");
}
