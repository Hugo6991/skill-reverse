import { env } from "cloudflare:workers";
import { applyD1Migrations, SELF, type D1Migration } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { nextEligiblePendingIndex } from "../worker/durable";
import { searchOccupations } from "../worker/occupations";
import { recordProviderCall } from "../worker/provider-ledger";
import { sha256 } from "../worker/security";
import type { AppEnv } from "../worker/types";

type TestEnv = AppEnv & { TEST_MIGRATIONS: D1Migration[] };
const bindings = env as unknown as TestEnv;

beforeAll(async () => {
  await applyD1Migrations(bindings.DB, bindings.TEST_MIGRATIONS);
});

describe("Cloudflare bindings in workerd", () => {
  it("queries the seeded O*NET catalog through D1", async () => {
    const results = await searchOccupations(bindings.DB, "web interface");
    expect(results[0]).toMatchObject({
      code: "15-1255.00",
      version: "30.3",
      provider: "O*NET"
    });
  });

  it("enforces outstanding and daily job limits in ActorGate", async () => {
    const actor = bindings.ACTOR_GATE.getByName(`test-${crypto.randomUUID()}`);
    expect(await actor.reserve("job-1", "2026-07-28", 3, 2)).toEqual({ ok: true });
    expect(await actor.reserve("job-2", "2026-07-28", 3, 2)).toEqual({ ok: true });
    expect(await actor.reserve("job-3", "2026-07-28", 3, 2)).toMatchObject({
      ok: false,
      reason: "outstanding_job_limit"
    });
    await actor.release("job-1");
    expect(await actor.reserve("job-3", "2026-07-28", 3, 2)).toEqual({ ok: true });
    await actor.rollback("job-3");
    await actor.release("job-2");
    expect(await actor.reserve("job-4", "2026-07-28", 3, 2)).toEqual({ ok: true });
    await actor.release("job-4");
    expect(await actor.reserve("job-5", "2026-07-28", 3, 2)).toMatchObject({
      ok: false,
      reason: "daily_job_limit"
    });
  });

  it("reserves and settles the daily budget atomically", async () => {
    const budget = bindings.DAILY_BUDGET.getByName(`2026-07-28-${crypto.randomUUID()}`);
    expect(await budget.reserve("job-1", 50, 100)).toMatchObject({
      ok: true,
      remainingCents: 50
    });
    expect(await budget.reserve("job-2", 60, 100)).toMatchObject({
      ok: false,
      remainingCents: 50
    });
    await budget.settle("job-1", 12);
    expect(await budget.reserve("job-1", 38, 100)).toMatchObject({
      ok: true,
      remainingCents: 50
    });
    await budget.settle("job-1", 20);
    expect(await budget.status(100)).toMatchObject({
      reservedCents: 0,
      actualCents: 20,
      remainingCents: 80
    });
  });

  it("skips a blocked actor while preserving cross-user queue order", () => {
    const pending = [
      { actorHash: "actor-a" },
      { actorHash: "actor-a" },
      { actorHash: "actor-b" }
    ];
    expect(nextEligiblePendingIndex(pending, new Map([["actor-a", 1]]), 1)).toBe(2);
    expect(nextEligiblePendingIndex(pending, new Map(), 1)).toBe(0);
  });

  it("reports queued timestamps, approximate position and accepts sources before start", async () => {
    const session = await SELF.fetch("https://example.com/api/my-jobs");
    const cookie = session.headers.get("set-cookie")?.split(";")[0] ?? "";
    const actorId = cookie.slice("sr_actor=".length).split(".")[0];
    const actorHash = await sha256(actorId);
    const firstJobId = crypto.randomUUID();
    const secondJobId = crypto.randomUUID();
    const firstQueuedAt = "2026-01-01T00:00:00.000Z";
    const secondQueuedAt = "2026-01-01T00:00:01.000Z";
    const expires = "2026-12-31T00:00:00.000Z";

    const statement = (jobId: string, owner: string, queuedAt: string, targetUrl: string) =>
      bindings.DB.prepare(
        `INSERT INTO jobs
         (id, actor_hash, target_url, support_urls_json, occupation_code, stage, status,
          progress, reserved_cents, actual_cents, capability_hash, degraded_json,
          queued_at, created_at, updated_at, expires_at)
         VALUES (?1, ?2, ?3, '[]', '15-1255.00', 'validate', 'queued',
          4, 50, 0, 'capability', '[]', ?4, ?4, ?4, ?5)`
      ).bind(jobId, owner, targetUrl, queuedAt, expires);
    await bindings.DB.batch([
      statement(firstJobId, "another-queued-actor", firstQueuedAt, "https://example.com/first"),
      statement(secondJobId, actorHash, secondQueuedAt, "https://example.com/second")
    ]);

    const status = await SELF.fetch(`https://example.com/api/jobs/${secondJobId}`);
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({
      id: secondJobId,
      status: "queued",
      queuePosition: 2,
      queuedAt: secondQueuedAt,
      retry: { automaticCount: 0, automaticMax: 1 }
    });

    const sources = await SELF.fetch(`https://example.com/api/jobs/${secondJobId}/sources`, {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        urls: ["https://github.com/owner/repo"],
        finalize: true
      })
    });
    expect(sources.status).toBe(200);
    expect(await sources.json()).toMatchObject({
      accepted: ["https://github.com/owner/repo"],
      finalized: true
    });
    expect(
      await bindings.DB.prepare(
        "SELECT sources_finalized_at FROM jobs WHERE id = ?1"
      )
        .bind(secondJobId)
        .first()
    ).toMatchObject({ sources_finalized_at: expect.any(String) });

    await bindings.DB.batch([
      bindings.DB.prepare("DELETE FROM jobs WHERE id = ?1").bind(firstJobId),
      bindings.DB.prepare("DELETE FROM jobs WHERE id = ?1").bind(secondJobId)
    ]);
  });

  it("keeps history and supporting sources scoped to the signed actor cookie", async () => {
    const session = await SELF.fetch("https://example.com/api/history");
    const setCookie = session.headers.get("set-cookie");
    expect(setCookie).toContain("sr_actor=");
    const cookie = setCookie?.split(";")[0] ?? "";
    const actorId = cookie.slice("sr_actor=".length).split(".")[0];
    const actorHash = await sha256(actorId);
    const jobId = crypto.randomUUID();
    const now = new Date().toISOString();
    const expires = new Date(Date.now() + 86_400_000).toISOString();
    await bindings.DB.prepare(
      `INSERT INTO jobs
       (id, actor_hash, target_url, support_urls_json, occupation_code, stage, status,
        progress, reserved_cents, actual_cents, workflow_id, degraded_json,
        created_at, updated_at, expires_at)
       VALUES (?1, ?2, 'https://example.com', '[]', '15-1255.00', 'capture', 'running',
        12, 50, 0, NULL, '[]', ?3, ?3, ?4)`
    )
      .bind(jobId, actorHash, now, expires)
      .run();

    const history = await SELF.fetch("https://example.com/api/history", {
      headers: { cookie }
    });
    expect(history.status).toBe(200);
    expect(await history.json()).toMatchObject({
      items: [{ jobId, targetUrl: "https://example.com", status: "running" }]
    });

    const sources = await SELF.fetch(`https://example.com/api/jobs/${jobId}/sources`, {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({
        urls: [
          "https://example.com/about#team",
          "https://github.com/owner/repo"
        ],
        finalize: true
      })
    });
    expect(sources.status).toBe(200);
    expect(await sources.json()).toMatchObject({
      accepted: ["https://example.com/about", "https://github.com/owner/repo"],
      finalized: true,
      submittedCount: 2
    });

    const repeated = await SELF.fetch(`https://example.com/api/jobs/${jobId}/sources`, {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ urls: [], finalize: true })
    });
    expect(repeated.status).toBe(409);

    const otherSession = await SELF.fetch("https://example.com/api/history");
    const otherCookie = otherSession.headers.get("set-cookie")?.split(";")[0] ?? "";
    const forbidden = await SELF.fetch(`https://example.com/api/jobs/${jobId}/sources`, {
      method: "PUT",
      headers: { cookie: otherCookie, "content-type": "application/json" },
      body: JSON.stringify({ urls: [], finalize: false })
    });
    expect(forbidden.status).toBe(404);
  });

  it("removes only terminal history owned by the current actor", async () => {
    const session = await SELF.fetch("https://example.com/api/history");
    const cookie = session.headers.get("set-cookie")?.split(";")[0] ?? "";
    const actorId = cookie.slice("sr_actor=".length).split(".")[0];
    const actorHash = await sha256(actorId);
    const jobId = crypto.randomUUID();
    const now = new Date().toISOString();
    const expires = new Date(Date.now() + 86_400_000).toISOString();
    await bindings.DB.prepare(
      `INSERT INTO jobs
       (id, actor_hash, target_url, support_urls_json, occupation_code, stage, status,
        progress, reserved_cents, actual_cents, degraded_json, created_at, updated_at, expires_at)
       VALUES (?1, ?2, 'https://example.com/report', '[]', '15-1255.00', 'report',
        'completed', 100, 50, 10, '[]', ?3, ?3, ?4)`
    )
      .bind(jobId, actorHash, now, expires)
      .run();

    const removed = await SELF.fetch(`https://example.com/api/history/${jobId}`, {
      method: "DELETE",
      headers: { cookie }
    });
    expect(removed.status).toBe(204);
    expect(
      await bindings.DB.prepare("SELECT id FROM jobs WHERE id = ?1").bind(jobId).first()
    ).toBeNull();
  });

  it("records provider usage and cost even when structured output parsing fails", async () => {
    const jobId = crypto.randomUUID();
    const now = new Date().toISOString();
    const expires = new Date(Date.now() + 86_400_000).toISOString();
    await bindings.DB.prepare(
      `INSERT INTO jobs
       (id, actor_hash, target_url, support_urls_json, occupation_code, stage, status,
        progress, reserved_cents, actual_cents, degraded_json, created_at, updated_at, expires_at)
       VALUES (?1, 'provider-ledger-test', 'https://example.com', '[]', '15-1255.00',
        'source_verification', 'running', 62, 50, 0, '[]', ?2, ?2, ?3)`
    )
      .bind(jobId, now, expires)
      .run();

    await recordProviderCall(bindings, {
      jobId,
      provider: "perplexity",
      model: "sonar-pro",
      requestId: "request-1",
      httpStatus: 200,
      finishReason: "stop",
      totalTokens: 3_200,
      costMicrousd: 25_000,
      outcome: "schema_error",
      errorCode: "provider_schema_invalid",
      errorMessage: "Invalid JSON"
    });

    expect(
      await bindings.DB.prepare(
        `SELECT provider, model, request_id, finish_reason, total_tokens,
                cost_microusd, attempt, outcome, error_code
         FROM provider_calls WHERE job_id = ?1`
      )
        .bind(jobId)
        .first()
    ).toMatchObject({
      provider: "perplexity",
      model: "sonar-pro",
      request_id: "request-1",
      finish_reason: "stop",
      total_tokens: 3_200,
      cost_microusd: 25_000,
      attempt: 1,
      outcome: "schema_error",
      error_code: "provider_schema_invalid"
    });
    expect(
      await bindings.DB.prepare("SELECT actual_cents FROM jobs WHERE id = ?1")
        .bind(jobId)
        .first()
    ).toMatchObject({ actual_cents: 3 });
  });
});
