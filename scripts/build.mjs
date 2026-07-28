import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const localVarsPath = new URL("../.dev.vars", import.meta.url);
const localSecretValues = existsSync(localVarsPath)
  ? readFileSync(localVarsPath, "utf8")
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => line.slice(line.indexOf("=") + 1))
      .filter((value) => value.length >= 12)
  : [];

run("pnpm", ["exec", "tsc", "--noEmit"]);
run("pnpm", ["exec", "vite", "build"]);

const copiedDevVars = new URL("../dist/skill_reverse/.dev.vars", import.meta.url);
if (existsSync(copiedDevVars)) rmSync(copiedDevVars);

if (existsSync(copiedDevVars)) {
  console.error("Security check failed: .dev.vars remains in the production build.");
  process.exit(1);
}

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    return entry.isDirectory() ? filesUnder(child) : [child];
  });
}

const distDirectory = new URL("../dist/", import.meta.url);
for (const file of filesUnder(distDirectory)) {
  if (statSync(file).size > 5_000_000) continue;
  const content = readFileSync(file);
  const text = content.toString("utf8");
  if (localSecretValues.some((value) => text.includes(value))) {
    console.error(`Security check failed: a local .dev.vars value was found in ${file.pathname}`);
    process.exit(1);
  }
}
console.log("✓ Production build contains no .dev.vars file");
console.log("✓ Production build contains no values copied from local .dev.vars");
