import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { JobStatus } from "../src/types";
import { ActorGate, DailyBudget } from "./durable";
import { demoReport } from "./demo";
import { historyPresentation } from "./history";
import { normalizeSourceUrl, replaceJobSources } from "./job-sources";
import { getOccupation, searchOccupations } from "./occupations";
import { createJobSchema, updateJobSourcesSchema } from "./schema";
import {
  assertSafePublicUrl,
  attachActorCookie,
  getOrCreateActor,
  isSetupAuthorized,
  sha256,
  verifyTurnstile
} from "./security";
import type { AppEnv, HonoEnv, JobRow, WorkflowInstance } from "./types";
import { ResearchWorkflow } from "./workflow";

export { ActorGate, DailyBudget, ResearchWorkflow };

const app = new Hono<HonoEnv>();

export function resolveAppMode(env: AppEnv): "locked" | "demo" | "public" {
  if (env.APP_MODE === "demo") return "demo";
  return env.SETUP_COMPLETE === "true" ? "public" : "locked";
}

export function publicConfig(env: AppEnv) {
  return {
    mode: resolveAppMode(env),
    turnstileSiteKey: env.TURNSTILE_SITE_KEY ?? ""
  };
}

class JobGateError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: 429 | 503 = 429
  ) {
    super(message);
  }
}

async function enqueueResearchJob(
  env: AppEnv,
  input: {
    actorHash: string;
    targetUrl: string;
    supportUrls?: string[];
    occupationCode: string;
  }
): Promise<{
  jobId: string;
  capabilityToken: string;
  workflow: WorkflowInstance;
  remainingCents: number;
}> {
  const jobId = crypto.randomUUID();
  const capabilityToken = crypto.randomUUID() + crypto.randomUUID();
  const capabilityHash = await sha256(capabilityToken);
  const day = new Date().toISOString().slice(0, 10);
  const reservedCents = Math.round(Number(env.JOB_USD_LIMIT || 0.5) * 100);
  const dailyLimitCents = Math.round(Number(env.DAILY_USD_LIMIT || 5) * 100);
  const configuredActorLimit = Number(env.ANON_DAILY_JOB_LIMIT || 20);
  const actorDailyJobLimit =
    Number.isFinite(configuredActorLimit) && configuredActorLimit > 0
      ? Math.max(1, Math.min(100, Math.floor(configuredActorLimit)))
      : 20;
  const actorGate = env.ACTOR_GATE.getByName(input.actorHash);
  const dailyBudget = env.DAILY_BUDGET.getByName(day);

  const actorReservation = await actorGate.reserve(jobId, day, actorDailyJobLimit);
  if (!actorReservation.ok) {
    throw new JobGateError(
      actorReservation.reason ?? "actor_limited",
      actorReservation.reason === "concurrent_job"
        ? "One research job is already running"
        : `This anonymous session has reached its daily limit of ${actorDailyJobLimit} research jobs`
    );
  }

  const budgetReservation = await dailyBudget.reserve(jobId, reservedCents, dailyLimitCents);
  if (!budgetReservation.ok) {
    await actorGate.release(jobId);
    throw new JobGateError(
      "daily_budget_exhausted",
      "The public research budget is exhausted for today"
    );
  }

  const normalizedSupportUrls = [...new Set((input.supportUrls ?? []).map(normalizeSourceUrl))];
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + Number(env.REPORT_TTL_DAYS || 30) * 86_400_000
  ).toISOString();
  try {
    await env.DB.prepare(
      `INSERT INTO jobs
       (id, actor_hash, target_url, support_urls_json, occupation_code, stage, status,
        progress, reserved_cents, actual_cents, degraded_json, created_at, updated_at, expires_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 'validate', 'queued', 4, ?6, 0, '[]', ?7, ?7, ?8)`
    )
      .bind(
        jobId,
        input.actorHash,
        input.targetUrl,
        JSON.stringify(normalizedSupportUrls),
        input.occupationCode,
        reservedCents,
        now.toISOString(),
        expiresAt
      )
      .run();
    if (normalizedSupportUrls.length) {
      await replaceJobSources(env.DB, jobId, normalizedSupportUrls);
    }

    const workflow = await env.RESEARCH_WORKFLOW.create({
      id: jobId,
      params: {
        kind: "research",
        jobId,
        actorHash: input.actorHash,
        targetUrl: input.targetUrl,
        supportUrls: normalizedSupportUrls,
        occupationCode: input.occupationCode,
        capabilityHash,
        reservedCents,
        day
      }
    });
    await env.DB.prepare("UPDATE jobs SET workflow_id = ?1 WHERE id = ?2")
      .bind(workflow.id, jobId)
      .run();
    return {
      jobId,
      capabilityToken,
      workflow,
      remainingCents: budgetReservation.remainingCents
    };
  } catch (error) {
    await Promise.all([actorGate.release(jobId), dailyBudget.release(jobId)]);
    await env.DB.prepare("DELETE FROM jobs WHERE id = ?1").bind(jobId).run().catch(() => undefined);
    throw error;
  }
}

async function deleteJobAndArtifacts(env: AppEnv, jobId: string): Promise<void> {
  const objects = await env.ARTIFACTS.list({ prefix: `jobs/${jobId}/` });
  await Promise.all(objects.objects.map((object) => env.ARTIFACTS.delete(object.key)));
  await env.DB.prepare("DELETE FROM jobs WHERE id = ?1").bind(jobId).run();
}

app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://challenges.cloudflare.com"],
      frameSrc: ["https://challenges.cloudflare.com"],
      connectSrc: ["'self'", "https://challenges.cloudflare.com"],
      imgSrc: ["'self'", "data:", "https:"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", "data:"]
    },
    referrerPolicy: "strict-origin-when-cross-origin",
    xFrameOptions: "DENY",
    xContentTypeOptions: "nosniff",
    crossOriginResourcePolicy: "same-origin"
  })
);

app.use("/api/*", async (c, next) => {
  await next();
  c.header("cache-control", "no-store");
  c.header("x-robots-tag", "noindex, nofollow");
});

app.onError((error, c) => {
  console.error(
    JSON.stringify({
      event: "request_error",
      path: c.req.path,
      message: error.message
    })
  );
  return c.json(
    {
      error: {
        code: "internal_error",
        message:
          resolveAppMode(c.env) === "public" ? "The request could not be completed" : error.message
      }
    },
    500
  );
});

app.get("/api/config", (c) => c.json(publicConfig(c.env)));

app.get("/api/occupations", async (c) => {
  const query = c.req.query("q") ?? "";
  try {
    return c.json({ occupations: await searchOccupations(c.env.DB, query) });
  } catch (error) {
    console.warn(JSON.stringify({ event: "occupation_fallback", message: String(error) }));
    const pilot = await Promise.resolve(getOccupation(c.env.DB, "15-1255.00")).catch(() => null);
    return c.json({ occupations: pilot ? [pilot] : [demoReport.occupation], degraded: true });
  }
});

app.post("/api/jobs", async (c) => {
  const mode = resolveAppMode(c.env);
  if (mode === "locked") {
    return c.json(
      {
        error: {
          code: "setup_required",
          message: "Deployment is locked until pnpm setup:prod passes every required check"
        }
      },
      503
    );
  }

  const parsed = createJobSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      {
        error: {
          code: "invalid_request",
          message: parsed.error.issues[0]?.message ?? "Invalid job input"
        }
      },
      400
    );
  }
  const input = parsed.data;
  try {
    assertSafePublicUrl(input.targetUrl);
    input.supportUrls.forEach(assertSafePublicUrl);
  } catch (error) {
    return c.json(
      {
        error: {
          code: "unsafe_url",
          message: error instanceof Error ? error.message : "Unsafe URL"
        }
      },
      400
    );
  }

  if (mode === "demo") {
    return c.json({
      jobId: "demo",
      reportId: "demo",
      status: "completed",
      capabilityToken: "demo"
    });
  }

  const occupation = await getOccupation(c.env.DB, input.occupationCode);
  if (!occupation) {
    return c.json(
      { error: { code: "occupation_not_found", message: "Select one available occupation" } },
      400
    );
  }

  const actor = await getOrCreateActor(c.req.raw, c.env);
  c.set("actorId", actor.actorId);
  c.set("actorHash", actor.actorHash);
  if (actor.setCookie) c.set("setActorCookie", actor.setCookie);

  const burst = await c.env.BURST_LIMITER.limit({ key: `job:${actor.actorHash}` });
  if (!burst.success) {
    return attachActorCookie(
      c,
      c.json(
        { error: { code: "burst_limited", message: "Too many attempts; wait one minute" } },
        429
      )
    );
  }

  const turnstile = await verifyTurnstile(input.turnstileToken, c.req.raw, c.env);
  if (!turnstile.success) {
    return attachActorCookie(
      c,
      c.json(
        {
          error: {
            code: turnstile.code,
            message: "Human verification failed or expired; refresh the challenge and retry"
          }
        },
        400
      )
    );
  }

  try {
    const result = await enqueueResearchJob(c.env, {
      actorHash: actor.actorHash,
      targetUrl: input.targetUrl,
      supportUrls: input.supportUrls,
      occupationCode: input.occupationCode
    });
    const response = c.json(
      {
        jobId: result.jobId,
        status: "queued",
        capabilityToken: result.capabilityToken,
        budgetRemainingUsd: result.remainingCents / 100
      },
      202
    );
    return attachActorCookie(c, response);
  } catch (error) {
    if (error instanceof JobGateError) {
      return attachActorCookie(
        c,
        c.json({ error: { code: error.code, message: error.message } }, error.status)
      );
    }
    throw error;
  }
});

app.get("/api/jobs/:id", async (c) => {
  if (c.req.param("id") === "demo") {
    return c.json({
      id: "demo",
      status: "completed",
      stage: "report",
      progress: 100,
      reportId: "demo",
      degraded: demoReport.degraded,
      costUsd: 0
    } satisfies JobStatus);
  }
  const row = await c.env.DB.prepare(
    `SELECT j.*,
       (SELECT COUNT(*) FROM job_sources s WHERE s.job_id = j.id) AS submitted_count
     FROM jobs j WHERE j.id = ?1`
  )
    .bind(c.req.param("id"))
    .first<JobRow & { submitted_count: number }>();
  if (!row) return c.json({ error: { code: "not_found", message: "Job not found" } }, 404);
  const sourceStageOpen = ["validate", "capture", "source_collection"].includes(row.stage);
  const beforeDeadline =
    !row.source_window_closes_at ||
    new Date(row.source_window_closes_at).getTime() > Date.now();
  return c.json({
    id: row.id,
    status: row.status,
    stage: row.stage,
    progress: row.progress,
    targetUrl: row.target_url,
    occupationCode: row.occupation_code,
    createdAt: row.created_at,
    reportId: row.report_id ?? undefined,
    degraded: JSON.parse(row.degraded_json),
    costUsd: row.actual_cents / 100,
    sourceCollection: {
      open:
        row.status !== "completed" &&
        row.status !== "failed" &&
        !row.sources_finalized_at &&
        sourceStageOpen &&
        beforeDeadline,
      closesAt: row.source_window_closes_at ?? undefined,
      submittedCount: Number(row.submitted_count)
    },
    error: row.error_code
      ? { code: row.error_code, message: row.error_message ?? "Research failed" }
      : undefined
  });
});

app.put("/api/jobs/:id/sources", async (c) => {
  const parsed = updateJobSourcesSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      {
        error: {
          code: "invalid_request",
          message: parsed.error.issues[0]?.message ?? "Invalid supporting sources"
        }
      },
      400
    );
  }
  if (!c.env.ANON_SESSION_SECRET) {
    return c.json(
      { error: { code: "setup_required", message: "Anonymous sessions are unavailable" } },
      503
    );
  }
  const actor = await getOrCreateActor(c.req.raw, c.env);
  c.set("actorId", actor.actorId);
  c.set("actorHash", actor.actorHash);
  if (actor.setCookie) c.set("setActorCookie", actor.setCookie);

  const row = await c.env.DB.prepare(
    `SELECT id, actor_hash, stage, status, workflow_id,
            source_window_closes_at, sources_finalized_at
     FROM jobs WHERE id = ?1`
  )
    .bind(c.req.param("id"))
    .first<
      Pick<
        JobRow,
        | "id"
        | "actor_hash"
        | "stage"
        | "status"
        | "workflow_id"
        | "source_window_closes_at"
        | "sources_finalized_at"
      >
    >();
  if (!row || row.actor_hash !== actor.actorHash) {
    return attachActorCookie(
      c,
      c.json({ error: { code: "not_found", message: "Research job not found" } }, 404)
    );
  }
  const stageOpen = ["validate", "capture", "source_collection"].includes(row.stage);
  const beforeDeadline =
    !row.source_window_closes_at ||
    new Date(row.source_window_closes_at).getTime() > Date.now();
  if (
    row.sources_finalized_at ||
    !stageOpen ||
    !beforeDeadline ||
    row.status === "completed" ||
    row.status === "failed"
  ) {
    return attachActorCookie(
      c,
      c.json(
        {
          error: {
            code: "sources_closed",
            message: "Supporting source collection has closed"
          }
        },
        409
      )
    );
  }

  let normalized: string[];
  try {
    normalized = parsed.data.urls.map(normalizeSourceUrl);
  } catch (error) {
    return attachActorCookie(
      c,
      c.json(
        {
          error: {
            code: "unsafe_url",
            message: error instanceof Error ? error.message : "Unsafe URL"
          }
        },
        400
      )
    );
  }
  if (parsed.data.finalize) {
    const now = new Date().toISOString();
    const finalized = await c.env.DB.prepare(
      `UPDATE jobs
       SET sources_finalized_at = ?1, updated_at = ?1
       WHERE id = ?2 AND sources_finalized_at IS NULL`
    )
      .bind(now, row.id)
      .run();
    if (!finalized.meta.changes) {
      return attachActorCookie(
        c,
        c.json(
          {
            error: {
              code: "sources_closed",
              message: "Supporting source collection has closed"
            }
          },
          409
        )
      );
    }
    try {
      normalized = await replaceJobSources(c.env.DB, row.id, normalized);
    } catch (error) {
      await c.env.DB.prepare(
        `UPDATE jobs SET sources_finalized_at = NULL
         WHERE id = ?1 AND sources_finalized_at = ?2`
      )
        .bind(row.id, now)
        .run();
      throw error;
    }
    if (row.workflow_id) {
      try {
        const workflow = await c.env.RESEARCH_WORKFLOW.get(row.workflow_id);
        await workflow.sendEvent({ type: "sources-ready", payload: { urls: normalized } });
      } catch (error) {
        console.warn(
          JSON.stringify({
            event: "source_event_deferred",
            jobId: row.id,
            message: error instanceof Error ? error.message : "unavailable"
          })
        );
      }
    }
  } else {
    normalized = await replaceJobSources(c.env.DB, row.id, normalized);
  }

  return attachActorCookie(
    c,
    c.json({
      accepted: normalized,
      finalized: parsed.data.finalize,
      submittedCount: normalized.length
    })
  );
});

app.get("/api/history", async (c) => {
  if (!c.env.ANON_SESSION_SECRET) return c.json({ items: [] });
  const actor = await getOrCreateActor(c.req.raw, c.env);
  c.set("actorId", actor.actorId);
  c.set("actorHash", actor.actorHash);
  if (actor.setCookie) c.set("setActorCookie", actor.setCookie);
  const requestedLimit = Number(c.req.query("limit") ?? 20);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(50, Math.floor(requestedLimit)))
    : 20;
  const cursor = c.req.query("cursor");
  const rows = await c.env.DB.prepare(
    `SELECT j.id, j.target_url, j.occupation_code, o.title AS occupation_title,
            j.status, j.stage, j.progress, j.report_id, j.created_at, j.updated_at,
            r.payload_json AS report_payload_json
     FROM jobs j
     LEFT JOIN occupations o ON o.code = j.occupation_code
     LEFT JOIN reports r ON r.id = j.report_id AND r.expires_at > ?2
     WHERE j.actor_hash = ?1
       AND j.expires_at > ?2
       AND (?3 IS NULL OR j.created_at < ?3)
     ORDER BY j.created_at DESC
     LIMIT ?4`
  )
    .bind(actor.actorHash, new Date().toISOString(), cursor ?? null, limit + 1)
    .all<{
      id: string;
      target_url: string;
      occupation_code: string;
      occupation_title: string | null;
      status: string;
      stage: string;
      progress: number;
      report_id: string | null;
      report_payload_json: string | null;
      created_at: string;
      updated_at: string;
    }>();
  const page = rows.results.slice(0, limit);
  const response = c.json({
    items: page.map((item) => {
      const presentation = historyPresentation(item.target_url, item.report_payload_json);
      return {
        jobId: item.id,
        targetUrl: item.target_url,
        occupationCode: item.occupation_code,
        occupationTitle: item.occupation_title ?? item.occupation_code,
        ...presentation,
        status: item.status,
        stage: item.stage,
        progress: item.progress,
        reportId: item.report_id ?? undefined,
        createdAt: item.created_at,
        updatedAt: item.updated_at
      };
    }),
    nextCursor: rows.results.length > limit ? page.at(-1)?.created_at : undefined
  });
  return attachActorCookie(c, response);
});

app.delete("/api/history/:jobId", async (c) => {
  if (!c.env.ANON_SESSION_SECRET) {
    return c.json({ error: { code: "setup_required", message: "History is unavailable" } }, 503);
  }
  const actor = await getOrCreateActor(c.req.raw, c.env);
  c.set("actorId", actor.actorId);
  c.set("actorHash", actor.actorHash);
  if (actor.setCookie) c.set("setActorCookie", actor.setCookie);
  const row = await c.env.DB.prepare(
    "SELECT id, status FROM jobs WHERE id = ?1 AND actor_hash = ?2"
  )
    .bind(c.req.param("jobId"), actor.actorHash)
    .first<{ id: string; status: string }>();
  if (!row) {
    return attachActorCookie(
      c,
      c.json({ error: { code: "not_found", message: "History item not found" } }, 404)
    );
  }
  if (row.status !== "completed" && row.status !== "failed") {
    return attachActorCookie(
      c,
      c.json(
        {
          error: {
            code: "job_running",
            message: "Running research cannot be removed"
          }
        },
        409
      )
    );
  }
  await deleteJobAndArtifacts(c.env, row.id);
  return attachActorCookie(c, c.body(null, 204));
});

app.post("/api/setup/smoke", async (c) => {
  if (!isSetupAuthorized(c.req.raw, c.env)) {
    return c.json({ error: { code: "unauthorized", message: "Setup capability required" } }, 401);
  }
  const occupation = await getOccupation(c.env.DB, "15-1255.00");
  if (!occupation) {
    return c.json(
      { error: { code: "occupation_not_found", message: "Pilot occupation is unavailable" } },
      503
    );
  }
  try {
    const result = await enqueueResearchJob(c.env, {
      actorHash: `setup-smoke-${crypto.randomUUID()}`,
      targetUrl: "https://antfu.me",
      occupationCode: occupation.code
    });
    await result.workflow.sendEvent({ type: "sources-ready", payload: { urls: [] } });
    return c.json({ jobId: result.jobId, capabilityToken: result.capabilityToken }, 202);
  } catch (error) {
    if (error instanceof JobGateError) {
      return c.json({ error: { code: error.code, message: error.message } }, error.status);
    }
    throw error;
  }
});

app.get("/api/reports/:id", async (c) => {
  if (c.req.param("id") === "demo") return c.json(demoReport);
  const row = await c.env.DB.prepare(
    "SELECT payload_json FROM reports WHERE id = ?1 AND expires_at > ?2"
  )
    .bind(c.req.param("id"), new Date().toISOString())
    .first<{ payload_json: string }>();
  if (!row) return c.json({ error: { code: "not_found", message: "Report not found" } }, 404);
  return c.json(JSON.parse(row.payload_json));
});

app.delete("/api/reports/:id", async (c) => {
  if (c.req.param("id") === "demo") {
    return c.json({ error: { code: "demo_readonly", message: "Demo report cannot be deleted" } }, 400);
  }
  const token = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return c.json({ error: { code: "unauthorized", message: "Capability required" } }, 401);
  const capabilityHash = await sha256(token);
  const row = await c.env.DB.prepare(
    "SELECT job_id FROM reports WHERE id = ?1 AND capability_hash = ?2"
  )
    .bind(c.req.param("id"), capabilityHash)
    .first<{ job_id: string }>();
  if (!row) return c.json({ error: { code: "unauthorized", message: "Capability rejected" } }, 403);

  await deleteJobAndArtifacts(c.env, row.job_id);
  return c.body(null, 204);
});

app.get("/api/health", async (c) => {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};
  const authorized = isSetupAuthorized(c.req.raw, c.env);
  const requireProductionSecrets = resolveAppMode(c.env) === "public" || authorized;
  try {
    const schema = await c.env.DB.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'")
      .first<{ value: string }>();
    checks.database = { ok: schema?.value === "3", detail: `schema ${schema?.value ?? "missing"}` };
  } catch (error) {
    checks.database = { ok: false, detail: error instanceof Error ? error.message : "unavailable" };
  }
  checks.perplexity = {
    ok: !requireProductionSecrets || Boolean(c.env.PERPLEXITY_API_KEY),
    detail: c.env.PERPLEXITY_API_KEY ? "configured" : "missing"
  };
  checks.openrouter = {
    ok: Boolean(c.env.OPENROUTER_API_KEY),
    detail: c.env.OPENROUTER_API_KEY
      ? `${c.env.OPENROUTER_SYNTHESIS_MODEL || "openai/gpt-5.6-terra"} configured`
      : "optional final synthesis unavailable"
  };
  checks.turnstile = {
    ok:
      !requireProductionSecrets ||
      Boolean(c.env.TURNSTILE_SITE_KEY && c.env.TURNSTILE_SECRET_KEY),
    detail:
      c.env.TURNSTILE_SITE_KEY && c.env.TURNSTILE_SECRET_KEY ? "configured" : "missing"
  };
  checks.social = {
    ok: Boolean(c.env.TWITTERAPI_KEY),
    detail: c.env.TWITTERAPI_KEY ? "configured" : "optional provider unavailable"
  };

  const requiredOk = checks.database.ok && checks.perplexity.ok && checks.turnstile.ok;
  if (authorized && c.req.query("deep") === "1") {
    const canary = `doctor/${crypto.randomUUID()}.txt`;
    try {
      await c.env.ARTIFACTS.put(canary, "ok");
      const value = await c.env.ARTIFACTS.get(canary);
      await c.env.ARTIFACTS.delete(canary);
      checks.r2 = { ok: (await value?.text()) === "ok", detail: "write/read/delete passed" };
    } catch (error) {
      checks.r2 = { ok: false, detail: error instanceof Error ? error.message : "unavailable" };
    }
    try {
      const actorHealth = await c.env.ACTOR_GATE.getByName("doctor").health();
      checks.durableObjects = { ok: actorHealth.ok, detail: "RPC passed" };
    } catch (error) {
      checks.durableObjects = {
        ok: false,
        detail: error instanceof Error ? error.message : "unavailable"
      };
    }
    try {
      const workflow = await c.env.RESEARCH_WORKFLOW.create({
        id: `health-${crypto.randomUUID()}`,
        params: { kind: "health" }
      });
      checks.workflow = { ok: Boolean(workflow.id), detail: `started ${workflow.id}` };
    } catch (error) {
      checks.workflow = {
        ok: false,
        detail: error instanceof Error ? error.message : "unavailable"
      };
    }
    checks.browserRun = {
      ok: Boolean(c.env.BROWSER),
      detail: "binding present; paid capture is tested by the pilot"
    };
  }

  return c.json({
    ok: requiredOk,
    mode: resolveAppMode(c.env),
    status:
      resolveAppMode(c.env) === "locked" ? "setup_required" : requiredOk ? "ready" : "degraded",
    checks: authorized ? checks : undefined,
    summary: {
      required: Object.values(checks).filter((check) => check.ok).length,
      total: Object.keys(checks).length
    }
  });
});

app.get("/favicon.ico", (c) => c.body(null, 204));
app.all("*", async (c) => {
  if (!c.env.ASSETS) return c.text("Not found", 404);
  const response = await c.env.ASSETS.fetch(c.req.raw);
  if (response.status !== 404 || c.req.method !== "GET") return response;
  const accept = c.req.header("accept") ?? "";
  if (!accept.includes("text/html")) return response;
  return c.env.ASSETS.fetch(new Request(new URL("/", c.req.url), c.req.raw));
});

async function cleanupExpired(env: AppEnv): Promise<void> {
  const artifactCutoff = new Date(
    Date.now() - Number(env.ARTIFACT_TTL_DAYS || 7) * 86_400_000
  ).toISOString();
  const staleArtifacts = await env.DB.prepare(
    `SELECT id, r2_key
     FROM source_artifacts
     WHERE r2_key IS NOT NULL AND retrieved_at <= ?1
     LIMIT 250`
  )
    .bind(artifactCutoff)
    .all<{ id: string; r2_key: string }>();
  for (const artifact of staleArtifacts.results) {
    await env.ARTIFACTS.delete(artifact.r2_key);
    await env.DB.prepare("UPDATE source_artifacts SET r2_key = NULL WHERE id = ?1")
      .bind(artifact.id)
      .run();
  }

  const expired = await env.DB.prepare(
    `SELECT j.id
     FROM jobs j
     WHERE j.expires_at <= ?1
     LIMIT 100`
  )
    .bind(new Date().toISOString())
    .all<{ id: string }>();
  for (const job of expired.results) {
    const objects = await env.ARTIFACTS.list({ prefix: `jobs/${job.id}/` });
    await Promise.all(objects.objects.map((object) => env.ARTIFACTS.delete(object.key)));
    await env.DB.prepare("DELETE FROM jobs WHERE id = ?1").bind(job.id).run();
  }
}

export default {
  fetch: app.fetch,
  scheduled(_controller: ScheduledController, env: AppEnv, ctx: ExecutionContext) {
    ctx.waitUntil(cleanupExpired(env));
  }
} satisfies ExportedHandler<AppEnv>;
