import { env } from "cloudflare:workers";
import {
  applyD1Migrations,
  introspectWorkflowInstance,
  SELF,
  type D1Migration
} from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { demoReport } from "../worker/demo";
import type { AppEnv } from "../worker/types";

type TestEnv = AppEnv & { TEST_MIGRATIONS: D1Migration[] };
const bindings = env as unknown as TestEnv;

beforeAll(async () => {
  await applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS);
});

async function insertJob(jobId: string, actorHash: string, day: string) {
  const timestamp = `${day}T00:00:00.000Z`;
  await bindings.DB.prepare(
    `INSERT INTO jobs
     (id, actor_hash, target_url, support_urls_json, occupation_code, stage, status,
      progress, reserved_cents, actual_cents, capability_hash, degraded_json,
      sources_finalized_at, queued_at, created_at, updated_at, expires_at)
     VALUES (?1, ?2, 'https://github.com/anthropics/skills', '[]', '15-1255.00',
      'validate', 'queued', 4, 50, 0, 'capability-hash', '[]', ?3, ?3, ?3, ?3, ?4)`
  )
    .bind(jobId, actorHash, timestamp, `${day}T23:59:59.999Z`)
    .run();
}

async function configureWorkflow(
  jobId: string,
  reportId: string,
  options: { settlementFails?: boolean; translationFails?: boolean } = {}
) {
  const targetUrl = "https://github.com/anthropics/skills";
  const captured = {
    id: "source-skill",
    url: targetUrl,
    title: "Workflow fixture",
    markdown: "# Workflow fixture\nEvidence",
    excerpt: "Evidence",
    r2Key: `jobs/${jobId}/source-1.md`
  };
  const report = {
    ...structuredClone(demoReport),
    id: reportId,
    targetUrl,
    generatedAt: new Date().toISOString()
  };
  const introspector = await introspectWorkflowInstance(
    bindings.RESEARCH_WORKFLOW as never,
    jobId
  );
  await introspector.modify(async (modifier) => {
    await modifier.disableRetryDelays();
    await modifier.mockStepResult({ name: "capture primary artifact" }, captured);
    await modifier.mockStepResult(
      { name: "resolve first-party creator identity" },
      {
        identity: {
          kind: "team",
          name: "Fixture team",
          evidenceUrls: [targetUrl]
        },
        artifacts: [],
        degraded: []
      }
    );
    await modifier.mockStepResult(
      { name: "collect targeted social provenance" },
      { posts: [] }
    );
    await modifier.mockStepResult(
      { name: "reverse research with structured evidence" },
      { result: {}, citations: [], estimatedCents: 0 }
    );
    await modifier.mockStepResult(
      { name: "synthesize final report with OpenAI via OpenRouter" },
      { result: {}, estimatedCents: 0 }
    );
    await modifier.mockStepResult({ name: "assemble evidence graph" }, report);
    if (options.translationFails) {
      await modifier.mockStepError(
        { name: "translate final report to English" },
        new Error("translation unavailable")
      );
    } else {
      await modifier.mockStepResult(
        { name: "translate final report to English" },
        { report: structuredClone(report), estimatedCents: 0, model: "openai/test" }
      );
    }
    if (options.settlementFails) {
      await modifier.mockStepError(
        { name: "settle gates" },
        new Error("actor gate temporarily unavailable")
      );
    }
  });
  return introspector;
}

async function createWorkflow(jobId: string, actorHash: string, day: string) {
  return bindings.RESEARCH_WORKFLOW.create({
    id: jobId,
    params: {
      kind: "research",
      jobId,
      actorHash,
      targetUrl: "https://github.com/anthropics/skills",
      occupationCode: "15-1255.00",
      capabilityHash: "capability-hash",
      reservedCents: 50,
      day
    }
  });
}

describe("ResearchWorkflow binding end to end", () => {
  it("publishes a bilingual report and settles the real gates", async () => {
    const jobId = crypto.randomUUID();
    const reportId = crypto.randomUUID();
    const actorHash = `actor-${crypto.randomUUID()}`;
    const day = "2026-08-05";
    await insertJob(jobId, actorHash, day);
    await bindings.ACTOR_GATE.getByName(actorHash).reserve(jobId, day, 20, 10);
    await bindings.DAILY_BUDGET.getByName(day).reserve(jobId, 50, 500);
    const introspector = await configureWorkflow(jobId, reportId);
    try {
      await createWorkflow(jobId, actorHash, day);
      await introspector.waitForStatus("complete");
      const output = (await introspector.getOutput()) as {
        reportId: string;
        actualCents: number;
        settlementPending: boolean;
      };
      const job = await bindings.DB.prepare(
        `SELECT status, publication_status, report_id, error_code, expires_at
         FROM jobs WHERE id = ?1`
      )
        .bind(jobId)
        .first<Record<string, string | null>>();
      const stored = await bindings.DB.prepare(
        "SELECT payload_json, content_schema_version FROM reports WHERE id = ?1"
      )
        .bind(reportId)
        .first<{ payload_json: string; content_schema_version: number }>();

      expect(output).toMatchObject({
        reportId,
        actualCents: 0,
        settlementPending: false
      });
      expect(job).toMatchObject({
        status: "completed",
        publication_status: "published",
        report_id: reportId,
        error_code: null,
        expires_at: "9999-12-31T23:59:59.999Z"
      });
      expect(stored?.content_schema_version).toBe(2);
      expect(JSON.parse(stored?.payload_json ?? "{}")).toMatchObject({
        schemaVersion: 2,
        availableLocales: ["zh-TW", "en"]
      });
      expect(await bindings.ACTOR_GATE.getByName(actorHash).health()).toMatchObject({
        outstanding: 0
      });
      expect(await bindings.DAILY_BUDGET.getByName(day).status(500)).toMatchObject({
        reservedCents: 0
      });
    } finally {
      await introspector.dispose();
    }
  });

  it("keeps an already-published report public when settlement is deferred", async () => {
    const jobId = crypto.randomUUID();
    const reportId = crypto.randomUUID();
    const actorHash = `actor-${crypto.randomUUID()}`;
    const day = "2026-08-06";
    await insertJob(jobId, actorHash, day);
    const introspector = await configureWorkflow(jobId, reportId, {
      settlementFails: true
    });
    try {
      await createWorkflow(jobId, actorHash, day);
      await introspector.waitForStatus("complete");
      expect(await introspector.getOutput()).toMatchObject({
        reportId,
        settlementPending: true
      });
      expect(
        await bindings.DB.prepare(
          `SELECT status, publication_status, report_id, error_code
           FROM jobs WHERE id = ?1`
        )
          .bind(jobId)
          .first()
      ).toMatchObject({
        status: "completed",
        publication_status: "published",
        report_id: reportId,
        error_code: null
      });
      expect(
        await bindings.DB.prepare("SELECT id FROM reports WHERE id = ?1")
          .bind(reportId)
        .first()
      ).toMatchObject({ id: reportId });
      const publicReport = await SELF.fetch(`https://example.com/api/reports/${reportId}`);
      expect(publicReport.status).toBe(200);
      expect(await publicReport.json()).toMatchObject({ schemaVersion: 2 });
    } finally {
      await introspector.dispose();
    }
  });

  it("fails before publication when required English translation cannot complete", async () => {
    const jobId = crypto.randomUUID();
    const reportId = crypto.randomUUID();
    const actorHash = `actor-${crypto.randomUUID()}`;
    const day = "2026-08-07";
    await insertJob(jobId, actorHash, day);
    await bindings.ACTOR_GATE.getByName(actorHash).reserve(jobId, day, 20, 10);
    await bindings.DAILY_BUDGET.getByName(day).reserve(jobId, 50, 500);
    const introspector = await configureWorkflow(jobId, reportId, {
      translationFails: true
    });
    try {
      await createWorkflow(jobId, actorHash, day);
      await introspector.waitForStatus("errored");
      expect(await introspector.getError()).toMatchObject({
        message: expect.stringContaining("translation unavailable")
      });
      expect(
        await bindings.DB.prepare(
          `SELECT status, publication_status, report_id, error_code
           FROM jobs WHERE id = ?1`
        )
          .bind(jobId)
          .first()
      ).toMatchObject({
        status: "failed",
        publication_status: "unpublished",
        report_id: null,
        error_code: "research_failed"
      });
      expect(
        await bindings.DB.prepare("SELECT id FROM reports WHERE id = ?1")
          .bind(reportId)
          .first()
      ).toBeNull();
      expect(await bindings.ACTOR_GATE.getByName(actorHash).health()).toMatchObject({
        outstanding: 0
      });
      expect(await bindings.DAILY_BUDGET.getByName(day).status(500)).toMatchObject({
        reservedCents: 0
      });
    } finally {
      await introspector.dispose();
    }
  });
});
