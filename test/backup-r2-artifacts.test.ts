// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error Node ESM script tested through its public exports.
import { backupPublishedArtifacts, verifyArtifactBackup } from "../scripts/backup-r2-artifacts.mjs";

const roots: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function inventory(rows: unknown[]) {
  return `\n ⛅️ wrangler 4.114.0\n-------------------\n${JSON.stringify([{ results: rows, success: true }], null, 2)}\n`;
}

async function fixture(rows: unknown[]) {
  const root = await mkdtemp(path.join(tmpdir(), "r2-artifact-backup-"));
  roots.push(root);
  const inventoryPath = path.join(root, "published-r2-inventory.txt");
  const outputDir = path.join(root, "published-r2-artifacts");
  await writeFile(inventoryPath, inventory(rows));
  return { root, inventoryPath, outputDir };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    job_id: "job-1",
    report_id: "report-1",
    artifact_id: "job-1-source-1",
    r2_key: "jobs/job-1/source-1.md",
    metadata_json: JSON.stringify({ screenshotKey: "jobs/job-1/source-1.png" }),
    ...overrides
  };
}

describe("published R2 artifact backup", () => {
  it("downloads only inventory keys from the production bucket with bounded concurrency and verifies checksums", async () => {
    const files = await fixture([
      row(),
      row({
        artifact_id: "job-1-source-2",
        r2_key: "jobs/job-1/source-2.md",
        metadata_json: null
      })
    ]);
    let active = 0;
    let maximumActive = 0;
    const downloadMock = vi.fn(async ({ bucketName, r2Key, destination }: { bucketName: string; r2Key: string; destination: string }) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      expect(bucketName).toBe("skill-reverse-artifacts");
      expect(r2Key).toMatch(/^jobs\/job-1\/source-[12]\.(?:md|png)$/u);
      await writeFile(destination, r2Key.endsWith(".png") ? "png" : `snapshot:${r2Key}`);
    });

    const result = await backupPublishedArtifacts({
      inventoryPath: files.inventoryPath,
      outputDir: files.outputDir,
      concurrency: 2,
      downloadImpl: downloadMock
    });

    expect(maximumActive).toBeLessThanOrEqual(2);
    expect(result.manifest.summary).toMatchObject({ total: 3, succeeded: 3, failed: 0 });
    expect(await readFile(path.join(files.outputDir, "objects/jobs/job-1/source-1.png"), "utf8")).toBe("png");
    const manifest = JSON.parse(await readFile(path.join(files.outputDir, "checksum-manifest.json"), "utf8"));
    expect(manifest.files[0].sha256).toMatch(/^[a-f0-9]{64}$/u);
    await expect(verifyArtifactBackup(files.outputDir)).resolves.toMatchObject({ verified: 3 });
  });

  it.each(["../escape.md", "jobs/job-1/../../escape.md", "jobs%2F..%2Fescape.md"])(
    "rejects unsafe R2 key %s before making a request",
    async (r2Key) => {
      const files = await fixture([row({ r2_key: r2Key, metadata_json: null })]);
      const downloadMock = vi.fn();
      await expect(backupPublishedArtifacts({
        inventoryPath: files.inventoryPath,
        outputDir: files.outputDir,
        downloadImpl: downloadMock
      })).rejects.toThrow(/path traversal|unsafe/u);
      expect(downloadMock).not.toHaveBeenCalled();
    }
  );

  it("fails atomically and reports counts when any response is not HTTP 200", async () => {
    const files = await fixture([row()]);
    const downloadMock = vi.fn(async ({ r2Key, destination }: { r2Key: string; destination: string }) => {
      if (r2Key.endsWith(".png")) throw new Error("missing object");
      await writeFile(destination, "snapshot");
    });
    await expect(backupPublishedArtifacts({
      inventoryPath: files.inventoryPath,
      outputDir: files.outputDir,
      downloadImpl: downloadMock
    })).rejects.toMatchObject({ summary: { total: 2, succeeded: 1, failed: 1 } });
    await expect(readFile(path.join(files.outputDir, "checksum-manifest.json"))).rejects.toThrow();
  });

  it("rejects a non-production bucket", async () => {
    const files = await fixture([row({ metadata_json: null })]);
    await expect(backupPublishedArtifacts({
      inventoryPath: files.inventoryPath,
      outputDir: files.outputDir,
      bucketName: "evil-bucket",
      downloadImpl: vi.fn()
    })).rejects.toThrow("unexpected R2 bucket");
  });

  it("detects checksum tampering", async () => {
    const files = await fixture([row({ metadata_json: null })]);
    await backupPublishedArtifacts({
      inventoryPath: files.inventoryPath,
      outputDir: files.outputDir,
      downloadImpl: vi.fn(async ({ destination }: { destination: string }) => writeFile(destination, "original"))
    });
    const artifact = path.join(files.outputDir, "objects/jobs/job-1/source-1.md");
    await writeFile(artifact, "tampered");
    await expect(verifyArtifactBackup(files.outputDir)).rejects.toThrow(/mismatch/u);
    expect(createHash("sha256").update("tampered").digest("hex")).not.toBe(
      createHash("sha256").update("original").digest("hex")
    );
  });
});
