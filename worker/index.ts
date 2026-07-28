import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { JobStatus } from "../src/types";
import { ActorGate, DailyBudget } from "./durable";
import { demoReport } from "./demo";
import { getOccupation, searchOccupations } from "./occupations";
import { createJobSchema } from "./schema";
import {
  assertSafePublicUrl,
  attachActorCookie,
  getOrCreateActor,
  isSetupAuthorized,
  sha256,
  verifyTurnstile
} from "./security";
import type { AppEnv, HonoEnv, JobRow } from "./types";
import { ResearchWorkflow } from "./workflow";

export { ActorGate, DailyBudget, ResearchWorkflow };

const app = new Hono<HonoEnv>();

export function resolveAppMode(env: AppEnv): "locked" | "demo" | "public" {
  if (env.APP_MODE === "demo") return "demo";
  return env.SETUP_COMPLETE === "true" ? "public" : "locked";
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

app.get("/api/config", (c) =>
  c.json({
    mode: resolveAppMode(c.env),
    turnstileSiteKey: c.env.TURNSTILE_SITE_KEY ?? "",
    socialEnabled: Boolean(c.env.TWITTERAPI_KEY),
    limits: {
      jobsPerDay: 2,
      maxUrls: 9,
      maxJobUsd: Number(c.env.JOB_USD_LIMIT || 0.5)
    }
  })
);

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

  const jobId = crypto.randomUUID();
  const capabilityToken = crypto.randomUUID() + crypto.randomUUID();
  const capabilityHash = await sha256(capabilityToken);
  const day = new Date().toISOString().slice(0, 10);
  const reservedCents = Math.round(Number(c.env.JOB_USD_LIMIT || 0.5) * 100);
  const dailyLimitCents = Math.round(Number(c.env.DAILY_USD_LIMIT || 5) * 100);
  const actorGate = c.env.ACTOR_GATE.getByName(actor.actorHash);
  const dailyBudget = c.env.DAILY_BUDGET.getByName(day);

  const actorReservation = await actorGate.reserve(jobId, day);
  if (!actorReservation.ok) {
    const message =
      actorReservation.reason === "concurrent_job"
        ? "One research job is already running"
        : "This anonymous session has reached its daily job limit";
    return attachActorCookie(
      c,
      c.json({ error: { code: actorReservation.reason, message } }, 429)
    );
  }

  const budgetReservation = await dailyBudget.reserve(jobId, reservedCents, dailyLimitCents);
  if (!budgetReservation.ok) {
    await actorGate.release(jobId);
    return attachActorCookie(
      c,
      c.json(
        {
          error: {
            code: "daily_budget_exhausted",
            message: "The public research budget is exhausted for today"
          }
        },
        429
      )
    );
  }

  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + Number(c.env.REPORT_TTL_DAYS || 30) * 86_400_000
  ).toISOString();
  try {
    await c.env.DB.prepare(
      `INSERT INTO jobs
       (id, actor_hash, target_url, support_urls_json, occupation_code, stage, status,
        progress, reserved_cents, actual_cents, degraded_json, created_at, updated_at, expires_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 'validate', 'queued', 4, ?6, 0, '[]', ?7, ?7, ?8)`
    )
      .bind(
        jobId,
        actor.actorHash,
        input.targetUrl,
        JSON.stringify([...new Set(input.supportUrls)]),
        input.occupationCode,
        reservedCents,
        now.toISOString(),
        expiresAt
      )
      .run();

    const workflow = await c.env.RESEARCH_WORKFLOW.create({
      id: jobId,
      params: {
        kind: "research",
        jobId,
        actorHash: actor.actorHash,
        targetUrl: input.targetUrl,
        supportUrls: [...new Set(input.supportUrls)],
        occupationCode: input.occupationCode,
        capabilityHash,
        reservedCents,
        day
      }
    });
    await c.env.DB.prepare("UPDATE jobs SET workflow_id = ?1 WHERE id = ?2")
      .bind(workflow.id, jobId)
      .run();
  } catch (error) {
    await Promise.all([actorGate.release(jobId), dailyBudget.release(jobId)]);
    await c.env.DB.prepare("DELETE FROM jobs WHERE id = ?1").bind(jobId).run().catch(() => undefined);
    throw error;
  }

  const response = c.json(
    {
      jobId,
      status: "queued",
      capabilityToken,
      budgetRemainingUsd: budgetReservation.remainingCents / 100
    },
    202
  );
  return attachActorCookie(c, response);
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
  const row = await c.env.DB.prepare("SELECT * FROM jobs WHERE id = ?1")
    .bind(c.req.param("id"))
    .first<JobRow>();
  if (!row) return c.json({ error: { code: "not_found", message: "Job not found" } }, 404);
  return c.json({
    id: row.id,
    status: row.status,
    stage: row.stage,
    progress: row.progress,
    reportId: row.report_id ?? undefined,
    degraded: JSON.parse(row.degraded_json),
    costUsd: row.actual_cents / 100,
    error: row.error_code
      ? { code: row.error_code, message: row.error_message ?? "Research failed" }
      : undefined
  });
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

  const objects = await c.env.ARTIFACTS.list({ prefix: `jobs/${row.job_id}/` });
  await Promise.all(objects.objects.map((object) => c.env.ARTIFACTS.delete(object.key)));
  await c.env.DB.prepare("DELETE FROM jobs WHERE id = ?1").bind(row.job_id).run();
  return c.body(null, 204);
});

app.get("/api/health", async (c) => {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};
  const authorized = isSetupAuthorized(c.req.raw, c.env);
  const requireProductionSecrets = resolveAppMode(c.env) === "public" || authorized;
  try {
    const schema = await c.env.DB.prepare("SELECT value FROM app_meta WHERE key = 'schema_version'")
      .first<{ value: string }>();
    checks.database = { ok: schema?.value === "1", detail: `schema ${schema?.value ?? "missing"}` };
  } catch (error) {
    checks.database = { ok: false, detail: error instanceof Error ? error.message : "unavailable" };
  }
  checks.perplexity = {
    ok: !requireProductionSecrets || Boolean(c.env.PERPLEXITY_API_KEY),
    detail: c.env.PERPLEXITY_API_KEY ? "configured" : "missing"
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
app.all("*", (c) =>
  c.env.ASSETS ? c.env.ASSETS.fetch(c.req.raw) : c.text("Not found", 404)
);

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
