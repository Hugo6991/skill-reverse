import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PRODUCTION_BUCKET = "skill-reverse-artifacts";
const DEFAULT_CONCURRENCY = 4;
const MAX_CONCURRENCY = 8;
const MAX_ARTIFACT_BYTES = 32 * 1024 * 1024;

function invariant(value, message) {
  if (!value) throw new Error(message);
}

export class ArtifactBackupError extends Error {
  constructor(message, summary, failures = []) {
    super(message);
    this.name = "ArtifactBackupError";
    this.summary = summary;
    this.failures = failures;
  }
}

export function parseWranglerInventory(text) {
  const cleaned = String(text).replace(/\u001b\[[0-9;]*m/gu, "");
  const offsets = [];
  for (const match of cleaned.matchAll(/^\s*[\[{]/gmu)) offsets.push(match.index);

  let payload;
  for (const offset of offsets) {
    try {
      payload = JSON.parse(cleaned.slice(offset).trim());
      break;
    } catch {
      // Wrangler prints a banner before the final JSON document.
    }
  }
  invariant(payload !== undefined, "Inventory does not contain valid Wrangler JSON");

  const pages = Array.isArray(payload) ? payload : [payload];
  const rows = [];
  for (const page of pages) {
    invariant(page && typeof page === "object", "Inventory JSON page is invalid");
    invariant(page.success !== false, "Wrangler reported an unsuccessful inventory query");
    invariant(Array.isArray(page.results), "Inventory JSON page has no results array");
    rows.push(...page.results);
  }
  return rows;
}

function requiredString(row, field) {
  const value = row?.[field];
  invariant(typeof value === "string" && value.length > 0, `Inventory row has invalid ${field}`);
  return value;
}

function safeR2Key(value, label = "r2_key") {
  invariant(typeof value === "string" && value.length > 0, `${label} must be a non-empty string`);
  invariant(value.length <= 1024, `${label} is too long`);
  invariant(!/[\\\0\r\n]/u.test(value), `${label} contains unsafe characters`);
  invariant(!path.posix.isAbsolute(value) && !/^[A-Za-z]:/u.test(value), `${label} must be relative`);
  const segments = value.split("/");
  invariant(segments.every((segment) => segment && segment !== "." && segment !== ".."), `${label} contains path traversal`);
  for (const segment of segments) {
    let decoded = segment;
    for (let pass = 0; pass < 2; pass += 1) {
      try {
        decoded = decodeURIComponent(decoded);
      } catch {
        break;
      }
      invariant(decoded !== "." && decoded !== ".." && !/[\\/\0]/u.test(decoded), `${label} contains encoded path traversal`);
    }
  }
  return value;
}

function targetPath(root, key) {
  const safeKey = safeR2Key(key);
  const target = path.resolve(root, ...safeKey.split("/"));
  invariant(target.startsWith(`${path.resolve(root)}${path.sep}`), `Unsafe artifact path: ${key}`);
  return target;
}

function parseMetadata(raw) {
  if (raw == null || raw === "") return {};
  invariant(typeof raw === "string", "metadata_json must be a JSON string");
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("metadata_json is invalid JSON");
  }
  invariant(value === null || (typeof value === "object" && !Array.isArray(value)), "metadata_json must contain an object");
  return value ?? {};
}

export function planArtifactDownloads(rows) {
  const tasks = [];
  const outputKeys = new Set();

  for (const row of rows) {
    invariant(row && typeof row === "object", "Inventory result row is invalid");
    if (row.artifact_id == null && row.r2_key == null) continue;
    const jobId = requiredString(row, "job_id");
    const reportId = requiredString(row, "report_id");
    const artifactId = requiredString(row, "artifact_id");
    const prefix = `${jobId}-`;
    invariant(artifactId.startsWith(prefix), `Artifact ${artifactId} does not belong to job ${jobId}`);
    const sourceId = artifactId.slice(prefix.length);
    invariant(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(sourceId) && sourceId !== "." && sourceId !== "..", `Artifact ${artifactId} has an unsafe source id`);

    const add = (r2Key, view) => {
      safeR2Key(r2Key, view === "snapshot" ? "r2_key" : "screenshotKey");
      invariant(!outputKeys.has(r2Key), `Duplicate artifact output key: ${r2Key}`);
      outputKeys.add(r2Key);
      tasks.push({ r2Key, reportId, sourceId, view });
    };

    add(requiredString(row, "r2_key"), "snapshot");
    const metadata = parseMetadata(row.metadata_json);
    if (Object.hasOwn(metadata, "screenshotKey")) {
      invariant(typeof metadata.screenshotKey === "string" && metadata.screenshotKey.length > 0, "screenshotKey must be a non-empty string");
      add(metadata.screenshotKey, "screenshot");
    }
  }
  return { tasks };
}

export async function downloadR2Object({ bucketName, r2Key, destination }) {
  invariant(bucketName === PRODUCTION_BUCKET, `Refusing unexpected R2 bucket: ${bucketName}`);
  const attempts = 4;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await rm(destination, { force: true });
    try {
      await new Promise((resolve, reject) => {
        const child = spawn(
          "pnpm",
          ["exec", "wrangler", "r2", "object", "get", `${bucketName}/${r2Key}`, "--remote", "--file", destination],
          { stdio: ["ignore", "pipe", "pipe"] }
        );
        let stderr = "";
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk) => { stderr += chunk; });
        child.once("error", reject);
        child.once("close", (code) =>
          code === 0
            ? resolve()
            : reject(
                new Error(
                  `Wrangler R2 get failed (${code ?? "signal"}): ${stderr.trim().slice(-500)}`
                )
              )
        );
      });
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 500));
      }
    }
  }
  throw lastError;
}

async function downloadOne(task, root, bucketName, downloadImpl, maxBytes) {
  const destination = targetPath(root, task.r2Key);
  await mkdir(path.dirname(destination), { recursive: true });
  await downloadImpl({ bucketName, r2Key: task.r2Key, destination });
  const info = await stat(destination);
  invariant(info.isFile(), `R2 download did not create a file for ${task.r2Key}`);
  invariant(info.size <= maxBytes, `Artifact ${task.r2Key} exceeds ${maxBytes} bytes`);
  const bytes = await readFile(destination);
  return {
    r2Key: task.r2Key,
    relativePath: path.posix.join("objects", task.r2Key),
    reportId: task.reportId,
    sourceId: task.sourceId,
    view: task.view,
    bytes: info.size,
    sha256: createHash("sha256").update(bytes).digest("hex")
  };
}

async function runLimited(tasks, concurrency, worker) {
  const results = new Array(tasks.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = { ok: true, value: await worker(tasks[index]) };
      } catch (error) {
        results[index] = { ok: false, error };
      }
    }
  });
  await Promise.all(runners);
  return results;
}

async function pathExists(value) {
  try {
    await access(value);
    return true;
  } catch {
    return false;
  }
}

export async function backupPublishedArtifacts({
  inventoryPath,
  outputDir,
  bucketName = PRODUCTION_BUCKET,
  concurrency = DEFAULT_CONCURRENCY,
  downloadImpl = downloadR2Object,
  maxArtifactBytes = MAX_ARTIFACT_BYTES
}) {
  invariant(typeof inventoryPath === "string" && inventoryPath, "inventoryPath is required");
  invariant(bucketName === PRODUCTION_BUCKET, `Refusing unexpected R2 bucket: ${bucketName}`);
  invariant(Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= MAX_CONCURRENCY, `concurrency must be between 1 and ${MAX_CONCURRENCY}`);
  const absoluteInventory = path.resolve(inventoryPath);
  const finalDir = path.resolve(outputDir ?? path.join(path.dirname(absoluteInventory), "published-r2-artifacts"));
  invariant(!(await pathExists(finalDir)), `Backup output already exists: ${finalDir}`);

  const rows = parseWranglerInventory(await readFile(absoluteInventory, "utf8"));
  const { tasks } = planArtifactDownloads(rows);
  invariant(tasks.length > 0, "Inventory contains no published artifacts");
  await mkdir(path.dirname(finalDir), { recursive: true });
  const stagingDir = await mkdtemp(`${finalDir}.partial-`);
  const objectsRoot = path.join(stagingDir, "objects");
  await mkdir(objectsRoot);

  try {
    const results = await runLimited(tasks, concurrency, (task) => downloadOne(task, objectsRoot, bucketName, downloadImpl, maxArtifactBytes));
    const files = results.filter((result) => result.ok).map((result) => result.value);
    const failures = results.flatMap((result, index) => result.ok ? [] : [{ r2Key: tasks[index].r2Key, message: result.error instanceof Error ? result.error.message : String(result.error) }]);
    const summary = { total: tasks.length, succeeded: files.length, failed: failures.length, totalBytes: files.reduce((sum, file) => sum + file.bytes, 0) };
    if (failures.length) throw new ArtifactBackupError(`Artifact backup incomplete: ${summary.succeeded}/${summary.total} downloaded, ${summary.failed} failed`, summary, failures);

    const manifest = {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      sourceInventory: path.basename(absoluteInventory),
      bucketName,
      checksumAlgorithm: "sha256",
      summary,
      files
    };
    await writeFile(path.join(stagingDir, "checksum-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
    await rename(stagingDir, finalDir);
    return { outputDir: finalDir, manifest };
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true });
    throw error;
  }
}

export async function verifyArtifactBackup(outputDir) {
  const root = path.resolve(outputDir);
  const manifest = JSON.parse(await readFile(path.join(root, "checksum-manifest.json"), "utf8"));
  invariant(manifest.schemaVersion === 1 && manifest.checksumAlgorithm === "sha256" && Array.isArray(manifest.files), "Checksum manifest is invalid");
  let totalBytes = 0;
  for (const file of manifest.files) {
    const key = safeR2Key(file.r2Key);
    invariant(file.relativePath === path.posix.join("objects", key), `Manifest path mismatch for ${key}`);
    const location = targetPath(path.join(root, "objects"), key);
    const info = await stat(location);
    invariant(info.isFile() && info.size === file.bytes, `Size mismatch for ${key}`);
    const bytes = await readFile(location);
    invariant(createHash("sha256").update(bytes).digest("hex") === file.sha256, `Checksum mismatch for ${key}`);
    totalBytes += info.size;
  }
  return { verified: manifest.files.length, totalBytes };
}

function usage() {
  return "Usage: node scripts/backup-r2-artifacts.mjs <published-r2-inventory.txt> [--output-dir <dir>] [--concurrency <1-8>]\n       node scripts/backup-r2-artifacts.mjs --verify <published-r2-artifacts-dir>";
}

async function main(argv) {
  if (argv[0] === "--") argv = argv.slice(1);
  if (argv[0] === "--verify") {
    invariant(argv[1] && argv.length === 2, usage());
    const result = await verifyArtifactBackup(argv[1]);
    console.log(`✓ Verified ${result.verified} artifacts (${result.totalBytes} bytes)`);
    return;
  }
  invariant(argv[0], usage());
  const options = { inventoryPath: argv[0] };
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    invariant(value, `Missing value for ${flag}\n${usage()}`);
    if (flag === "--output-dir") options.outputDir = value;
    else if (flag === "--concurrency") options.concurrency = Number(value);
    else throw new Error(`Unknown option ${flag}\n${usage()}`);
    index += 1;
  }
  const result = await backupPublishedArtifacts(options);
  console.log(`✓ Downloaded ${result.manifest.summary.succeeded}/${result.manifest.summary.total} artifacts; 0 failed`);
  console.log(`✓ SHA-256 manifest: ${path.join(result.outputDir, "checksum-manifest.json")}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`✕ ${error instanceof Error ? error.message : error}`);
    if (error instanceof ArtifactBackupError) {
      for (const failure of error.failures) console.error(`  - ${failure.r2Key}: ${failure.message}`);
    }
    process.exitCode = 1;
  });
}
