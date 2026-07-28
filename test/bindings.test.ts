import { env } from "cloudflare:workers";
import { applyD1Migrations, SELF, type D1Migration } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { nextEligiblePendingIndex } from "../worker/durable";
import { searchOccupations } from "../worker/occupations";
import { recordProviderCall } from "../worker/provider-ledger";
import { sha256 } from "../worker/security";
import type { AppEnv } from "../worker/types";
import { demoReport } from "../worker/demo";

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

  it("shares published history globally while keeping job controls scoped to a cookie", async () => {
    const session = await SELF.fetch(`https://example.com/api/jobs/missing/sources`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ urls: [], finalize: false })
    });
    const cookie = session.headers.get("set-cookie")?.split(";")[0] ?? "";
    expect(cookie).toContain("sr_actor=");
    const actorId = cookie.slice("sr_actor=".length).split(".")[0];
    const actorHash = await sha256(actorId);
    const runningJobId = crypto.randomUUID();
    const publicJobId = crypto.randomUUID();
    const publicReportId = crypto.randomUUID();
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
      .bind(runningJobId, actorHash, now, expires)
      .run();
    await bindings.DB.prepare(
      `INSERT INTO jobs
       (id, actor_hash, target_url, support_urls_json, occupation_code, stage, status,
        progress, reserved_cents, actual_cents, report_id, degraded_json,
        publication_status, published_at, target_key, created_at, updated_at, expires_at)
       VALUES (?1, 'another-actor', 'https://example.com/public', '[]', '15-1255.00',
        'report', 'completed', 100, 50, 10, ?2, '[]', 'published', ?3,
        'https://example.com/public', ?3, ?3, ?4)`
    )
      .bind(publicJobId, publicReportId, now, expires)
      .run();
    await bindings.DB.prepare(
      `INSERT INTO reports
       (id, job_id, capability_hash, title, payload_json, created_at, expires_at)
       VALUES (?1, ?2, 'test-capability', 'Public report', ?3, ?4, ?5)`
    )
      .bind(
        publicReportId,
        publicJobId,
        JSON.stringify({
          id: publicReportId,
          title: "Public report",
          targetUrl: "https://example.com/public",
          sources: []
        }),
        now,
        "9999-12-31T23:59:59.999Z"
      )
      .run();

    const history = await SELF.fetch("https://another-domain.example/api/history");
    expect(history.status).toBe(200);
    expect(history.headers.get("set-cookie")).toBeNull();
    const historyBody = (await history.json()) as { items: Array<{ jobId: string }> };
    expect(historyBody.items.some((item) => item.jobId === publicJobId)).toBe(true);
    expect(historyBody.items.some((item) => item.jobId === runningJobId)).toBe(false);

    const myJobs = await SELF.fetch("https://example.com/api/my-jobs", {
      headers: { cookie }
    });
    expect(myJobs.status).toBe(200);
    expect(await myJobs.json()).toMatchObject({
      items: [
        {
          jobId: runningJobId,
          targetUrl: "https://example.com",
          status: "running"
        }
      ]
    });

    const sources = await SELF.fetch(`https://example.com/api/jobs/${runningJobId}/sources`, {
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

    const repeated = await SELF.fetch(`https://example.com/api/jobs/${runningJobId}/sources`, {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ urls: [], finalize: true })
    });
    expect(repeated.status).toBe(409);

    const otherSession = await SELF.fetch(`https://example.com/api/jobs/another-missing/sources`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ urls: [], finalize: false })
    });
    const otherCookie = otherSession.headers.get("set-cookie")?.split(";")[0] ?? "";
    const forbidden = await SELF.fetch(`https://example.com/api/jobs/${runningJobId}/sources`, {
      method: "PUT",
      headers: { cookie: otherCookie, "content-type": "application/json" },
      body: JSON.stringify({ urls: [], finalize: false })
    });
    expect(forbidden.status).toBe(404);
  });

  it("lets only the owner moderation API hide, restore and permanently delete reports", async () => {
    const jobId = crypto.randomUUID();
    const reportId = crypto.randomUUID();
    const now = new Date().toISOString();
    const expires = new Date(Date.now() + 86_400_000).toISOString();
    await bindings.DB.prepare(
      `INSERT INTO jobs
       (id, actor_hash, target_url, support_urls_json, occupation_code, stage, status,
        progress, reserved_cents, actual_cents, report_id, degraded_json,
        publication_status, published_at, target_key, created_at, updated_at, expires_at)
       VALUES (?1, ?2, 'https://example.com/report', '[]', '15-1255.00', 'report',
        'completed', 100, 50, 10, ?3, '[]', 'published', ?4,
        'https://example.com/report', ?4, ?4, ?5)`
    )
      .bind(jobId, "public-actor", reportId, now, expires)
      .run();
    await bindings.DB.prepare(
      `INSERT INTO reports
       (id, job_id, capability_hash, title, payload_json, created_at, expires_at)
       VALUES (?1, ?2, 'test-capability', 'Moderated report', ?3, ?4, ?5)`
    )
      .bind(
        reportId,
        jobId,
        JSON.stringify({
          id: reportId,
          title: "Moderated report",
          targetUrl: "https://example.com/report",
          sources: []
        }),
        now,
        "9999-12-31T23:59:59.999Z"
      )
      .run();

    const publicDelete = await SELF.fetch(`https://example.com/api/reports/${reportId}`, {
      method: "DELETE"
    });
    expect(publicDelete.status).toBe(404);

    const hidden = await SELF.fetch(`https://example.com/api/admin/reports/${reportId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "hide", reason: "Test moderation" })
    });
    expect(hidden.status).toBe(200);
    expect((await SELF.fetch(`https://example.com/api/reports/${reportId}`)).status).toBe(404);

    const restored = await SELF.fetch(`https://example.com/api/admin/reports/${reportId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "restore" })
    });
    expect(restored.status).toBe(200);
    expect((await SELF.fetch(`https://example.com/api/reports/${reportId}`)).status).toBe(200);

    const removed = await SELF.fetch(`https://example.com/api/admin/reports/${reportId}`, {
      method: "DELETE"
    });
    expect(removed.status).toBe(204);
    expect(
      await bindings.DB.prepare("SELECT id FROM jobs WHERE id = ?1").bind(jobId).first()
    ).toBeNull();
  });

  it("serves archived evidence only through its published report and source id", async () => {
    const jobId = crypto.randomUUID();
    const reportId = crypto.randomUUID();
    const now = new Date().toISOString();
    const expires = new Date(Date.now() + 86_400_000).toISOString();
    const r2Key = `jobs/${jobId}/source-1.md`;
    await bindings.DB.prepare(
      `INSERT INTO jobs
       (id, actor_hash, target_url, support_urls_json, occupation_code, stage, status,
        progress, reserved_cents, actual_cents, report_id, degraded_json,
        publication_status, published_at, target_key, created_at, updated_at, expires_at)
       VALUES (?1, 'archive-actor', 'https://example.com/evidence', '[]', '15-1255.00',
        'report', 'completed', 100, 50, 10, ?2, '[]', 'published', ?3,
        'https://example.com/evidence', ?3, ?3, ?4)`
    )
      .bind(jobId, reportId, now, expires)
      .run();
    await bindings.DB.prepare(
      `INSERT INTO reports
       (id, job_id, capability_hash, title, payload_json, created_at, expires_at)
       VALUES (?1, ?2, 'test-capability', 'Evidence report', ?3, ?4, ?5)`
    )
      .bind(
        reportId,
        jobId,
        JSON.stringify({
          id: reportId,
          title: "Evidence report",
          targetUrl: "https://example.com/evidence",
          sources: [{ id: "source-1", title: "Evidence", url: "https://example.com/evidence" }]
        }),
        now,
        "9999-12-31T23:59:59.999Z"
      )
      .run();
    await bindings.DB.prepare(
      `INSERT INTO source_artifacts
       (id, job_id, url, kind, status, title, retrieved_at, r2_key, metadata_json)
       VALUES (?1, ?2, 'https://example.com/evidence', 'website',
        'verified_at_retrieval', 'Evidence', ?3, ?4, '{}')`
    )
      .bind(`${jobId}-source-1`, jobId, now, r2Key)
      .run();
    await bindings.ARTIFACTS.put(r2Key, "# Archived evidence");

    const report = await SELF.fetch(`https://example.com/api/reports/${reportId}`);
    expect(report.status).toBe(200);
    expect(await report.json()).toMatchObject({
      sources: [
        {
          id: "source-1",
          archive: {
            snapshotUrl: `/api/reports/${reportId}/artifacts/source-1`
          }
        }
      ]
    });

    const artifact = await SELF.fetch(
      `https://example.com/api/reports/${reportId}/artifacts/source-1`
    );
    expect(artifact.status).toBe(200);
    expect(artifact.headers.get("content-type")).toContain("text/plain");
    expect(await artifact.text()).toBe("# Archived evidence");
    expect(
      (
        await SELF.fetch(
          `https://example.com/api/reports/${reportId}/artifacts/source-2`
        )
      ).status
    ).toBe(404);
  });

  it("keeps cards private until sharing is enabled and isolates anonymous owners", async () => {
    const session = await SELF.fetch("https://example.com/api/collection");
    const cookie = session.headers.get("set-cookie")?.split(";")[0] ?? "";
    const actorId = cookie.slice("sr_actor=".length).split(".")[0];
    const actorHash = await sha256(actorId);
    const cardId = crypto.randomUUID();
    const now = new Date().toISOString();
    const expires = new Date(Date.now() + 365 * 86_400_000).toISOString();
    await bindings.DB.prepare(
      `INSERT INTO skill_cards
       (id, actor_hash, job_id, report_id, target_key, target_url, display_name,
        occupation_code, occupation_title, game_profile_json, created_at, updated_at, expires_at)
       VALUES (?1, ?2, ?3, ?1, ?4, ?4, 'Test Manual', '15-1255.00',
        'Web and Digital Interface Designers', ?5, ?6, ?6, ?7)`
    )
      .bind(
        cardId,
        actorHash,
        crypto.randomUUID(),
        "https://github.com/example/manual",
        JSON.stringify(demoReport.gameProfile),
        now,
        expires
      )
      .run();

    const owned = await SELF.fetch("https://example.com/api/collection", {
      headers: { cookie }
    });
    expect(await owned.json()).toMatchObject({
      cards: [{ id: cardId, displayName: "Test Manual" }]
    });

    const otherSession = await SELF.fetch("https://example.com/api/collection");
    const otherCookie = otherSession.headers.get("set-cookie")?.split(";")[0] ?? "";
    expect(await otherSession.json()).toMatchObject({ cards: [] });
    const forbiddenShare = await SELF.fetch(`https://example.com/api/cards/${cardId}/share`, {
      method: "POST",
      headers: { cookie: otherCookie }
    });
    expect(forbiddenShare.status).toBe(404);

    expect(
      await bindings.DB.prepare("SELECT share_slug FROM skill_cards WHERE id = ?1")
        .bind(cardId)
        .first()
    ).toMatchObject({ share_slug: null });

    const shared = await SELF.fetch(`https://example.com/api/cards/${cardId}/share`, {
      method: "POST",
      headers: { cookie }
    });
    expect(shared.status).toBe(200);
    const shareBody = (await shared.json()) as { shareSlug: string; shareUrl: string };
    expect(shareBody.shareUrl).toBe(`https://example.com/c/${shareBody.shareSlug}`);

    const publicCard = await SELF.fetch(
      `https://example.com/api/public/cards/${shareBody.shareSlug}`
    );
    expect(publicCard.status).toBe(200);
    expect(await publicCard.json()).toMatchObject({
      displayName: "Test Manual",
      gameProfile: {
        axes: expect.arrayContaining([
          expect.objectContaining({ evidenceIds: [], signalIds: [] })
        ])
      }
    });

    const removed = await SELF.fetch(`https://example.com/api/cards/${cardId}`, {
      method: "DELETE",
      headers: { cookie }
    });
    expect(removed.status).toBe(204);
    expect(
      await SELF.fetch(`https://example.com/api/public/cards/${shareBody.shareSlug}`)
    ).toMatchObject({ status: 404 });
  });

  it("hides expired cards from the collection", async () => {
    const session = await SELF.fetch("https://example.com/api/collection");
    const cookie = session.headers.get("set-cookie")?.split(";")[0] ?? "";
    const actorId = cookie.slice("sr_actor=".length).split(".")[0];
    const actorHash = await sha256(actorId);
    const now = new Date().toISOString();
    await bindings.DB.prepare(
      `INSERT INTO skill_cards
       (id, actor_hash, job_id, target_key, target_url, display_name,
        occupation_code, occupation_title, game_profile_json, created_at, updated_at, expires_at)
       VALUES (?1, ?2, ?3, ?4, ?4, 'Expired Manual', '15-1255.00',
        'Web and Digital Interface Designers', ?5, ?6, ?6, ?7)`
    )
      .bind(
        crypto.randomUUID(),
        actorHash,
        crypto.randomUUID(),
        "https://example.com/expired",
        JSON.stringify(demoReport.gameProfile),
        now,
        new Date(Date.now() - 1_000).toISOString()
      )
      .run();
    const collection = await SELF.fetch("https://example.com/api/collection", {
      headers: { cookie }
    });
    expect(await collection.json()).toMatchObject({ cards: [] });
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
