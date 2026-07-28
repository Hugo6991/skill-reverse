import {
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  D1_PLACEHOLDER,
  findD1DatabaseId,
  findWorkersDevUrl,
  getConfiguredD1Database,
  updateD1DatabaseId
} from "./cloudflare-bootstrap-core.mjs";

const dryRun = process.argv.includes("--dry-run");
const root = fileURLToPath(new URL("../", import.meta.url));
const configPath = fileURLToPath(new URL("../wrangler.jsonc", import.meta.url));
const databaseName = "skill-reverse-db";
const bucketName = "skill-reverse-artifacts";
const queueNames = ["skill-reverse-jobs-dlq", "skill-reverse-jobs"];

function commandText(command, args) {
  return [command, ...args].join(" ");
}

function run(command, args, { capture = false, allowFailure = false } = {}) {
  if (dryRun) {
    console.log(`  would run: ${commandText(command, args)}`);
    return { status: 0, stdout: "", stderr: "" };
  }

  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: capture ? ["inherit", "pipe", "pipe"] : "inherit"
  });

  if (capture) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`${commandText(command, args)} exited with ${result.status ?? "no status"}`);
  }
  return result;
}

function wrangler(args, options) {
  return run("pnpm", ["exec", "wrangler", ...args], options);
}

function readConfig() {
  const text = readFileSync(configPath, "utf8");
  const database = getConfiguredD1Database(text);
  if (database.database_name !== databaseName) {
    throw new Error(`DB binding must target ${databaseName}`);
  }
  return { text, database };
}

function writeConfigAtomically(nextConfig) {
  const temporary = `${configPath}.bootstrap-${process.pid}.tmp`;
  try {
    writeFileSync(temporary, nextConfig, { encoding: "utf8", mode: 0o644 });
    renameSync(temporary, configPath);
  } catch (error) {
    if (existsSync(temporary)) unlinkSync(temporary);
    throw error;
  }
}

function ensureAuthentication() {
  const identity = wrangler(["whoami", "--json"], { capture: true, allowFailure: true });
  if (identity.status === 0) {
    console.log("✓ Wrangler authenticated");
    return;
  }
  console.log("! Wrangler login is required");
  wrangler(["login"]);
  const verified = wrangler(["whoami", "--json"], { capture: true, allowFailure: true });
  if (verified.status !== 0) throw new Error("Wrangler authentication did not complete");
  console.log("✓ Wrangler authenticated");
}

function ensureD1() {
  let listed = wrangler(["d1", "list", "--json"], { capture: true });
  let id = findD1DatabaseId(listed.stdout, databaseName);
  if (!id) {
    console.log(`→ Creating D1 database ${databaseName}`);
    wrangler(["d1", "create", databaseName, "--location", "apac"]);
    listed = wrangler(["d1", "list", "--json"], { capture: true });
    id = findD1DatabaseId(listed.stdout, databaseName);
  }
  if (!id) throw new Error(`D1 database ${databaseName} was not found after creation`);
  console.log(`✓ D1 ${databaseName} ready (${id})`);
  return id;
}

function ensureR2() {
  let info = wrangler(["r2", "bucket", "info", bucketName, "--json"], {
    capture: true,
    allowFailure: true
  });
  if (info.status !== 0) {
    console.log(`→ Creating R2 bucket ${bucketName}`);
    wrangler(["r2", "bucket", "create", bucketName, "--location", "apac"]);
    info = wrangler(["r2", "bucket", "info", bucketName, "--json"], {
      capture: true,
      allowFailure: true
    });
  }
  if (info.status !== 0) throw new Error(`R2 bucket ${bucketName} was not found after creation`);
  console.log(`✓ R2 ${bucketName} ready`);
}

function ensureQueues() {
  for (const queueName of queueNames) {
    let info = wrangler(["queues", "info", queueName], {
      capture: true,
      allowFailure: true
    });
    if (info.status !== 0) {
      console.log(`→ Creating Queue ${queueName}`);
      wrangler(["queues", "create", queueName]);
      info = wrangler(["queues", "info", queueName], {
        capture: true,
        allowFailure: true
      });
    }
    if (info.status !== 0) throw new Error(`Queue ${queueName} was not found after creation`);
    console.log(`✓ Queue ${queueName} ready`);
  }
}

function deployLocked() {
  run("pnpm", ["typecheck"]);
  run("pnpm", ["test"]);
  run("pnpm", ["build"]);
  run("pnpm", ["db:migrate:remote"]);
  return wrangler(["deploy"], { capture: true });
}

async function main() {
  const initial = readConfig();
  console.log("\nSkill Reverse — private Cloudflare bootstrap");
  console.log("Repository stays private; the first Worker deployment stays locked.\n");

  if (dryRun) {
    console.log("Dry run — no authentication, Cloudflare resources, files, or deployments are changed.");
    console.log(`  config: ${configPath}`);
    console.log(`  D1: ensure ${databaseName}, then replace ${initial.database.database_id}`);
    console.log(`  R2: ensure ${bucketName}`);
    console.log(`  Queues: ensure ${queueNames.join(" and ")}`);
    console.log("  verify: typecheck → tests → build → migrations → deploy");
    console.log("\n✓ Bootstrap plan is valid");
    return;
  }

  ensureAuthentication();
  const databaseId = ensureD1();
  ensureR2();
  ensureQueues();

  const current = readConfig();
  const nextConfig = updateD1DatabaseId(current.text, databaseId);
  if (nextConfig !== current.text) {
    writeConfigAtomically(nextConfig);
    console.log("✓ wrangler.jsonc updated with the production D1 UUID");
  } else {
    console.log("✓ wrangler.jsonc already contains the production D1 UUID");
  }

  const deployment = deployLocked();
  const output = `${deployment.stdout ?? ""}\n${deployment.stderr ?? ""}`;
  const deploymentUrl = findWorkersDevUrl(output);

  console.log("\n✓ Locked production deployment completed");
  if (deploymentUrl) console.log(`  URL: ${deploymentUrl}`);
  else console.log("  URL: open Workers & Pages → skill-reverse → Deployments");
  console.log("\nNext and only next command:");
  console.log("  pnpm setup:prod");
  console.log("\nCommit the updated wrangler.jsonc to the private main branch before enabling Builds.");
}

main().catch((error) => {
  console.error(`\n✕ Bootstrap stopped: ${error instanceof Error ? error.message : String(error)}`);
  console.error(
    "  It is safe to rerun pnpm bootstrap:cloudflare; existing D1/R2/Queue resources are reused."
  );
  if (!process.env.CLOUDFLARE_API_TOKEN) {
    console.error(
      "  If OAuth is intentionally disabled, set CLOUDFLARE_API_TOKEN in your terminal and rerun."
    );
  }
  process.exit(1);
});
