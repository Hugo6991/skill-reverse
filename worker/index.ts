import { Hono, type Context } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { isBilingualReportBundle, resolveReport } from "../src/bilingual";
import type {
  GameProfile,
  JobStatus,
  Locale,
  ReportPayload,
  ReverseReport,
  SkillCardSummary
} from "../src/types";
import { authorizeAdmin } from "./access";
import { ActorGate, DailyBudget, ResearchScheduler } from "./durable";
import { demoReportBundle } from "./demo";
import { historyOccupationTitle, historyPresentation } from "./history";
import { normalizeSourceUrl, replaceJobSources } from "./job-sources";
import {
  getOccupation,
  localizedOccupationTitle,
  searchOccupations
} from "./occupations";
import { createJobSchema, retryJobSchema, updateJobSourcesSchema } from "./schema";
import { isRetryableJobError } from "./provider-ledger";
import { ReportUpgradeError, upgradeStoredReport } from "./report-compat";
import {
  decodeHistoryCursor,
  encodeHistoryCursor,
  targetKey,
  type PublicationStatus
} from "./publication";
import {
  assertSafePublicUrl,
  attachActorCookie,
  getOrCreateActor,
  isSetupAuthorized,
  sha256,
  verifyTurnstile
} from "./security";
import type { AppEnv, HonoEnv, JobRow, ResearchQueueMessage } from "./types";
import { ResearchWorkflow } from "./workflow";

export { ActorGate, DailyBudget, ResearchScheduler, ResearchWorkflow };

const app = new Hono<HonoEnv>();

function requestedLocale(value: string | undefined): Locale | null {
  if (value === undefined || value === "") return "zh-TW";
  return value === "zh-TW" || value === "en" ? value : null;
}

function withViewerCanShare(payload: ReportPayload, viewerCanShare: boolean): ReportPayload {
  if (!isBilingualReportBundle(payload)) return { ...payload, viewerCanShare };
  return {
    ...payload,
    locales: Object.fromEntries(
      Object.entries(payload.locales).map(([locale, report]) => [
        locale,
        report ? { ...report, viewerCanShare } : report
      ])
    ) as Partial<Record<Locale, ReverseReport>>
  };
}

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

function currentGameProfile(profileJson: string, reportPayloadJson?: string): GameProfile {
  const stored = JSON.parse(profileJson) as Partial<GameProfile>;
  if (stored.rubricVersion === "game-profile-v2" && stored.identity) {
    return stored as GameProfile;
  }
  if (!reportPayloadJson) throw new ReportUpgradeError();
  return upgradeStoredReport(JSON.parse(reportPayloadJson)).gameProfile;
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

const MAX_MANUAL_RETRIES = 2;

function publicResearchError(code: string): string {
  switch (code) {
    case "provider_timeout":
      return "The research provider timed out before completing this step";
    case "provider_rate_limited":
      return "The research provider is busy right now";
    case "provider_unavailable":
      return "The research provider is temporarily unavailable";
    case "provider_empty_response":
      return "The research provider returned an empty result";
    case "provider_output_truncated":
    case "provider_schema_invalid":
      return "The research provider returned an incomplete result";
    case "provider_authentication_failed":
      return "The research service needs owner attention";
    default:
      return "Research could not be completed";
  }
}

async function enqueueResearchJob(
  env: AppEnv,
  input: {
    actorHash: string;
    targetUrl: string;
    supportUrls?: string[];
    occupationCode: string;
    sourcesFinalized?: boolean;
  }
): Promise<{
  jobId: string;
  capabilityToken: string;
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
  const configuredOutstandingLimit = Number(env.ACTOR_OUTSTANDING_JOB_LIMIT || 10);
  const actorOutstandingJobLimit =
    Number.isFinite(configuredOutstandingLimit) && configuredOutstandingLimit > 0
      ? Math.max(1, Math.min(100, Math.floor(configuredOutstandingLimit)))
      : 10;
  const actorGate = env.ACTOR_GATE.getByName(input.actorHash);
  const dailyBudget = env.DAILY_BUDGET.getByName(day);

  const actorReservation = await actorGate.reserve(
    jobId,
    day,
    actorDailyJobLimit,
    actorOutstandingJobLimit
  );
  if (!actorReservation.ok) {
    throw new JobGateError(
      actorReservation.reason ?? "actor_limited",
      actorReservation.reason === "outstanding_job_limit"
        ? `This session already has ${actorOutstandingJobLimit} unfinished research jobs`
        : `This anonymous session has reached its daily limit of ${actorDailyJobLimit} research jobs`
    );
  }

  const budgetReservation = await dailyBudget.reserve(jobId, reservedCents, dailyLimitCents);
  if (!budgetReservation.ok) {
    await actorGate.rollback(jobId);
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
        progress, reserved_cents, actual_cents, capability_hash, degraded_json,
        sources_finalized_at, queued_at, target_key, publication_status,
        created_at, updated_at, expires_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 'validate', 'queued', 4, ?6, 0, ?7, '[]',
               ?8, ?9, ?10, 'unpublished', ?9, ?9, ?11)`
    )
      .bind(
        jobId,
        input.actorHash,
        input.targetUrl,
        JSON.stringify(normalizedSupportUrls),
        input.occupationCode,
        reservedCents,
        capabilityHash,
        input.sourcesFinalized ? now.toISOString() : null,
        now.toISOString(),
        targetKey(input.targetUrl),
        expiresAt
      )
      .run();
    if (normalizedSupportUrls.length) {
      await replaceJobSources(env.DB, jobId, normalizedSupportUrls);
    }

    await env.RESEARCH_QUEUE.send({ jobId } satisfies ResearchQueueMessage);
    return {
      jobId,
      capabilityToken,
      remainingCents: budgetReservation.remainingCents
    };
  } catch (error) {
    await Promise.all([actorGate.rollback(jobId), dailyBudget.release(jobId)]);
    try {
      await env.DB.prepare("DELETE FROM jobs WHERE id = ?1").bind(jobId).run();
    } catch {
      const failedAt = new Date().toISOString();
      await env.DB.prepare(
        `UPDATE jobs
         SET status = 'failed', error_code = 'queue_enqueue_failed',
             error_message = 'The research request could not be queued',
             finished_at = ?1, updated_at = ?1
         WHERE id = ?2 AND status = 'queued'`
      )
        .bind(failedAt, jobId)
        .run()
        .catch(() => undefined);
    }
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

app.use("/api/admin/*", async (c, next) => {
  const authorization = await authorizeAdmin(c.req.raw, c.env);
  if (!authorization.ok) {
    return c.json(
      {
        error: {
          code: authorization.code,
          message: authorization.message
        }
      },
      authorization.status
    );
  }
  await next();
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
  const locale = requestedLocale(c.req.query("lang"));
  if (!locale) {
    return c.json(
      { error: { code: "invalid_locale", message: "Supported locales are zh-TW and en" } },
      400
    );
  }
  const query = c.req.query("q") ?? "";
  try {
    return c.json({ occupations: await searchOccupations(c.env.DB, query, locale) });
  } catch (error) {
    console.warn(JSON.stringify({ event: "occupation_fallback", message: String(error) }));
    const pilot = await Promise.resolve(getOccupation(c.env.DB, "15-1255.00", locale)).catch(
      () => null
    );
    return c.json({
      occupations: pilot
        ? [pilot]
        : [demoReportBundle.locales[locale]?.occupation ?? demoReportBundle.locales["zh-TW"]!.occupation],
      degraded: true
    });
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
      degraded: demoReportBundle.locales["zh-TW"]!.degraded,
      costUsd: 0
    } satisfies JobStatus);
  }
  const row = await c.env.DB.prepare(
    `SELECT j.*,
       (SELECT COUNT(*) FROM job_sources s WHERE s.job_id = j.id) AS submitted_count,
       (SELECT COUNT(*) + 1
        FROM jobs q
        WHERE q.status = 'queued'
          AND (
            q.queued_at < j.queued_at
            OR (q.queued_at = j.queued_at AND q.id < j.id)
          )) AS queue_position
     FROM jobs j WHERE j.id = ?1`
  )
    .bind(c.req.param("id"))
    .first<JobRow & { submitted_count: number; queue_position: number }>();
  if (!row) return c.json({ error: { code: "not_found", message: "Job not found" } }, 404);
  if (row.publication_status === "hidden") {
    return c.json({ error: { code: "not_found", message: "Job not found" } }, 404);
  }
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
    queuedAt: row.queued_at ?? row.created_at,
    startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
    queuePosition: row.status === "queued" ? Number(row.queue_position) : undefined,
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
      ? { code: row.error_code, message: publicResearchError(row.error_code) }
      : undefined,
    retry: {
      allowed:
        row.status === "failed" &&
        isRetryableJobError(row.error_code) &&
        row.retry_count < MAX_MANUAL_RETRIES &&
        new Date(row.expires_at).getTime() > Date.now() &&
        row.actual_cents < row.reserved_cents,
      count: row.retry_count,
      max: MAX_MANUAL_RETRIES,
      automaticCount: row.auto_retry_count,
      automaticMax: Math.max(0, Number(c.env.AUTO_RETRY_LIMIT || 1))
    }
  });
});

app.get("/api/my-jobs", async (c) => {
  const locale = requestedLocale(c.req.query("lang"));
  if (!locale) {
    return c.json(
      { error: { code: "invalid_locale", message: "Supported locales are zh-TW and en" } },
      400
    );
  }
  if (!c.env.ANON_SESSION_SECRET) {
    return c.json({ items: [] });
  }
  const actor = await getOrCreateActor(c.req.raw, c.env);
  c.set("actorId", actor.actorId);
  c.set("actorHash", actor.actorHash);
  if (actor.setCookie) c.set("setActorCookie", actor.setCookie);

  const rows = await c.env.DB.prepare(
    `SELECT j.id, j.target_url, j.occupation_code, o.title AS occupation_title,
            o.localizations_json AS occupation_localizations_json,
            j.status, j.stage, j.progress, j.queued_at, j.started_at, j.finished_at,
            j.auto_retry_count, j.updated_at,
            CASE WHEN j.status = 'queued' THEN (
              SELECT COUNT(*) + 1
              FROM jobs q
              WHERE q.status = 'queued'
                AND (
                  q.queued_at < j.queued_at
                  OR (q.queued_at = j.queued_at AND q.id < j.id)
                )
            ) END AS queue_position
     FROM jobs j
     LEFT JOIN occupations o ON o.code = j.occupation_code
     WHERE j.actor_hash = ?1
       AND j.status IN ('queued', 'running', 'failed')
     ORDER BY
       CASE j.status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END,
       j.updated_at DESC
     LIMIT 20`
  )
    .bind(actor.actorHash)
    .all<{
      id: string;
      target_url: string;
      occupation_code: string;
      occupation_title: string | null;
      occupation_localizations_json: string | null;
      status: "queued" | "running" | "failed";
      stage: JobStatus["stage"];
      progress: number;
      queued_at: string | null;
      started_at: string | null;
      finished_at: string | null;
      auto_retry_count: number;
      updated_at: string;
      queue_position: number | null;
    }>();

  return attachActorCookie(
    c,
    c.json({
      items: rows.results.map((row) => ({
        jobId: row.id,
        targetUrl: row.target_url,
        occupationCode: row.occupation_code,
        occupationTitle: localizedOccupationTitle(
          row.occupation_title ?? row.occupation_code,
          row.occupation_localizations_json ?? "{}",
          locale
        ),
        status: row.status,
        stage: row.stage,
        progress: row.progress,
        queuedAt: row.queued_at ?? row.updated_at,
        startedAt: row.started_at ?? undefined,
        finishedAt: row.finished_at ?? undefined,
        queuePosition:
          row.status === "queued" && row.queue_position !== null
            ? Number(row.queue_position)
            : undefined,
        autoRetryCount: Number(row.auto_retry_count),
        updatedAt: row.updated_at
      }))
    })
  );
});

app.post("/api/jobs/:id/retry", async (c) => {
  if (resolveAppMode(c.env) !== "public") {
    return c.json(
      { error: { code: "setup_required", message: "Public research is not available" } },
      503
    );
  }
  const parsed = retryJobSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json(
      { error: { code: "invalid_request", message: "Complete human verification first" } },
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
    `SELECT id, actor_hash, status, stage, progress, workflow_id, reserved_cents,
            actual_cents, error_code, error_message, retry_count, expires_at, created_at,
            finished_at, auto_retry_count, last_auto_retry_at
     FROM jobs WHERE id = ?1`
  )
    .bind(c.req.param("id"))
    .first<
      Pick<
        JobRow,
        | "id"
        | "actor_hash"
        | "status"
        | "stage"
        | "progress"
        | "workflow_id"
        | "reserved_cents"
        | "actual_cents"
        | "error_code"
        | "error_message"
        | "retry_count"
        | "expires_at"
        | "created_at"
        | "finished_at"
        | "auto_retry_count"
        | "last_auto_retry_at"
      >
    >();
  if (!row || row.actor_hash !== actor.actorHash) {
    return attachActorCookie(
      c,
      c.json({ error: { code: "not_found", message: "Research job not found" } }, 404)
    );
  }
  if (
    row.status !== "failed" ||
    !isRetryableJobError(row.error_code) ||
    row.retry_count >= MAX_MANUAL_RETRIES ||
    !row.workflow_id ||
    new Date(row.expires_at).getTime() <= Date.now()
  ) {
    return attachActorCookie(
      c,
      c.json(
        {
          error: {
            code: "retry_unavailable",
            message: "This research can no longer be retried"
          }
        },
        409
      )
    );
  }
  const remainingCents = Math.max(0, row.reserved_cents - row.actual_cents);
  if (remainingCents <= 0) {
    return attachActorCookie(
      c,
      c.json(
        { error: { code: "job_budget_exhausted", message: "This research reached its cost limit" } },
        409
      )
    );
  }

  const burst = await c.env.BURST_LIMITER.limit({ key: `retry:${actor.actorHash}` });
  if (!burst.success) {
    return attachActorCookie(
      c,
      c.json({ error: { code: "rate_limited", message: "Try again in a moment" } }, 429)
    );
  }
  const turnstile = await verifyTurnstile(
    parsed.data.turnstileToken,
    c.req.raw,
    c.env,
    "retry_research_job"
  );
  if (!turnstile.success) {
    return attachActorCookie(
      c,
      c.json(
        {
          error: {
            code: turnstile.code,
            message: "Human verification expired or could not be confirmed"
          }
        },
        400
      )
    );
  }

  const budgetDay = row.created_at.slice(0, 10);
  const actorDay = new Date().toISOString().slice(0, 10);
  const dailyLimitCents = Math.round(Number(c.env.DAILY_USD_LIMIT || 5) * 100);
  const configuredActorLimit = Number(c.env.ANON_DAILY_JOB_LIMIT || 20);
  const actorDailyJobLimit =
    Number.isFinite(configuredActorLimit) && configuredActorLimit > 0
      ? Math.max(1, Math.min(100, Math.floor(configuredActorLimit)))
      : 20;
  const configuredOutstandingLimit = Number(c.env.ACTOR_OUTSTANDING_JOB_LIMIT || 10);
  const actorOutstandingJobLimit =
    Number.isFinite(configuredOutstandingLimit) && configuredOutstandingLimit > 0
      ? Math.max(1, Math.min(100, Math.floor(configuredOutstandingLimit)))
      : 10;
  const actorGate = c.env.ACTOR_GATE.getByName(actor.actorHash);
  const dailyBudget = c.env.DAILY_BUDGET.getByName(budgetDay);
  const actorReservation = await actorGate.reserve(
    row.id,
    actorDay,
    actorDailyJobLimit,
    actorOutstandingJobLimit
  );
  if (!actorReservation.ok) {
    return attachActorCookie(
      c,
      c.json(
        {
          error: {
            code: actorReservation.reason ?? "actor_limited",
            message:
              actorReservation.reason === "outstanding_job_limit"
                ? "This session has too many unfinished research jobs"
                : "This session reached its daily research limit"
          }
        },
        429
      )
    );
  }
  const budgetReservation = await dailyBudget.reserve(
    row.id,
    remainingCents,
    dailyLimitCents
  );
  if (!budgetReservation.ok) {
    await actorGate.rollback(row.id);
    return attachActorCookie(
      c,
      c.json(
        { error: { code: "daily_budget_exhausted", message: "The research budget is unavailable" } },
        503
      )
    );
  }

  const retriedAt = new Date().toISOString();
  const claimed = await c.env.DB.prepare(
    `UPDATE jobs
     SET status = 'queued', stage = 'source_verification', progress = 62,
         error_code = NULL, error_message = NULL, retry_count = retry_count + 1,
         last_retry_at = ?1, queued_at = ?1, finished_at = NULL,
         auto_retry_count = 0, last_auto_retry_at = NULL, updated_at = ?1
     WHERE id = ?2 AND actor_hash = ?3 AND status = 'failed'
       AND retry_count = ?4 AND retry_count < ?5`
  )
    .bind(retriedAt, row.id, actor.actorHash, row.retry_count, MAX_MANUAL_RETRIES)
    .run();
  if (!claimed.meta.changes) {
    await Promise.all([actorGate.rollback(row.id), dailyBudget.release(row.id)]);
    return attachActorCookie(
      c,
      c.json(
        { error: { code: "retry_in_progress", message: "This retry is already running" } },
        409
      )
    );
  }

  try {
    await c.env.RESEARCH_QUEUE.send({ jobId: row.id } satisfies ResearchQueueMessage);
  } catch (error) {
    await c.env.DB.prepare(
      `UPDATE jobs
       SET status = 'failed', stage = ?1, progress = ?2, error_code = ?3,
           error_message = ?4, retry_count = ?5, last_retry_at = NULL,
           finished_at = ?6, auto_retry_count = ?7, last_auto_retry_at = ?8,
           updated_at = ?9
       WHERE id = ?10 AND status = 'queued' AND last_retry_at = ?11`
    )
      .bind(
        row.stage,
        row.progress,
        row.error_code,
        row.error_message,
        row.retry_count,
        row.finished_at,
        row.auto_retry_count,
        row.last_auto_retry_at,
        new Date().toISOString(),
        row.id,
        retriedAt
      )
      .run();
    await Promise.all([actorGate.rollback(row.id), dailyBudget.release(row.id)]);
    console.error(
      JSON.stringify({
        event: "workflow_restart_failed",
        jobId: row.id,
        message: error instanceof Error ? error.message : "restart failed"
      })
    );
    return attachActorCookie(
      c,
      c.json(
        {
          error: {
            code: "retry_queue_failed",
            message: "The retry could not be queued"
          }
        },
        503
      )
    );
  }

  return attachActorCookie(
    c,
    c.json(
      {
        id: row.id,
        status: "queued",
        stage: "source_verification",
        progress: 62,
        retry: { allowed: false, count: row.retry_count + 1, max: MAX_MANUAL_RETRIES }
      },
      202
    )
  );
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
  const locale = requestedLocale(c.req.query("lang"));
  if (!locale) {
    return c.json(
      { error: { code: "invalid_locale", message: "Supported locales are zh-TW and en" } },
      400
    );
  }
  const requestedLimit = Number(c.req.query("limit") ?? 20);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(50, Math.floor(requestedLimit)))
    : 20;
  const cursor = decodeHistoryCursor(c.req.query("cursor"));
  if (c.req.query("cursor") && !cursor) {
    return c.json(
      { error: { code: "invalid_cursor", message: "The history cursor is invalid" } },
      400
    );
  }
  let requestedTargetKey: string | null = null;
  const targetUrl = c.req.query("targetUrl");
  if (targetUrl) {
    try {
      assertSafePublicUrl(targetUrl);
      requestedTargetKey = targetKey(targetUrl);
    } catch (error) {
      return c.json(
        {
          error: {
            code: "invalid_target",
            message: error instanceof Error ? error.message : "The target URL is invalid"
          }
        },
        400
      );
    }
  }
  const rows = await c.env.DB.prepare(
    `SELECT j.id, j.target_url, j.occupation_code, o.title AS occupation_title,
            j.status, j.stage, j.progress, j.report_id, j.created_at, j.updated_at,
            j.published_at, r.payload_json AS report_payload_json
     FROM jobs j
     LEFT JOIN occupations o ON o.code = j.occupation_code
     JOIN reports r ON r.id = j.report_id
     WHERE j.status = 'completed'
       AND j.publication_status = 'published'
       AND j.published_at IS NOT NULL
       AND (?1 IS NULL OR j.target_key = ?1)
       AND (
         ?2 IS NULL
         OR j.published_at < ?2
         OR (j.published_at = ?2 AND j.id < ?3)
       )
     ORDER BY j.published_at DESC, j.id DESC
     LIMIT ?4`
  )
    .bind(
      requestedTargetKey,
      cursor?.publishedAt ?? null,
      cursor?.jobId ?? null,
      limit + 1
    )
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
      published_at: string;
    }>();
  const page = rows.results.slice(0, limit);
  return c.json({
    items: page.map((item) => {
      const presentation = historyPresentation(
        item.target_url,
        item.report_payload_json,
        locale
      );
      return {
        jobId: item.id,
        targetUrl: item.target_url,
        occupationCode: item.occupation_code,
        occupationTitle: historyOccupationTitle(
          item.report_payload_json,
          locale,
          item.occupation_title ?? item.occupation_code
        ),
        ...presentation,
        status: "completed" as const,
        stage: "report" as const,
        progress: 100,
        reportId: item.report_id,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
        publishedAt: item.published_at
      };
    }),
    nextCursor:
      rows.results.length > limit && page.at(-1)
        ? encodeHistoryCursor({
            publishedAt: page.at(-1)!.published_at,
            jobId: page.at(-1)!.id
          })
        : undefined
  });
});

app.get("/api/collection", async (c) => {
  if (!c.env.ANON_SESSION_SECRET) return c.json({ cards: [], activity: [] });
  const actor = await getOrCreateActor(c.req.raw, c.env);
  c.set("actorId", actor.actorId);
  c.set("actorHash", actor.actorHash);
  if (actor.setCookie) c.set("setActorCookie", actor.setCookie);
  const now = new Date().toISOString();
  const [cardRows, activityRows] = await Promise.all([
    c.env.DB.prepare(
      `SELECT sc.id, sc.report_id, sc.target_url, sc.display_name, sc.occupation_code,
              sc.occupation_title, sc.game_profile_json, sc.share_slug,
              sc.created_at, sc.updated_at, r.payload_json AS report_payload_json
       FROM skill_cards sc
       JOIN jobs j ON j.id = sc.job_id
       JOIN reports r ON r.id = sc.report_id
       WHERE sc.actor_hash = ?1
         AND sc.expires_at > ?2
         AND j.publication_status = 'published'
       ORDER BY sc.updated_at DESC
       LIMIT 50`
    )
      .bind(actor.actorHash, now)
      .all<{
        id: string;
        report_id: string | null;
        target_url: string;
        display_name: string;
        occupation_code: string;
        occupation_title: string;
        game_profile_json: string;
        share_slug: string | null;
        created_at: string;
        updated_at: string;
        report_payload_json: string;
      }>(),
    c.env.DB.prepare(
      `SELECT j.id, j.target_url, j.occupation_code, o.title AS occupation_title,
              j.status, j.stage, j.progress, j.queued_at, j.started_at, j.finished_at,
              j.auto_retry_count, j.updated_at,
              CASE WHEN j.status = 'queued' THEN (
                SELECT COUNT(*) + 1
                FROM jobs q
                WHERE q.status = 'queued'
                  AND (
                    q.queued_at < j.queued_at
                    OR (q.queued_at = j.queued_at AND q.id < j.id)
                  )
              ) END AS queue_position
       FROM jobs j
       LEFT JOIN occupations o ON o.code = j.occupation_code
       WHERE j.actor_hash = ?1
         AND j.expires_at > ?2
         AND j.status != 'completed'
       ORDER BY j.updated_at DESC
       LIMIT 20`
    )
      .bind(actor.actorHash, now)
      .all<{
        id: string;
        target_url: string;
        occupation_code: string;
        occupation_title: string | null;
        status: string;
        stage: JobStatus["stage"];
        progress: number;
        queued_at: string | null;
        started_at: string | null;
        finished_at: string | null;
        auto_retry_count: number;
        queue_position: number | null;
        updated_at: string;
      }>()
  ]);
  const cards: SkillCardSummary[] = cardRows.results.map((row) => ({
    id: row.id,
    reportId: row.report_id ?? undefined,
    targetUrl: row.target_url,
    displayName: row.display_name,
    occupationCode: row.occupation_code,
    occupationTitle: row.occupation_title,
    gameProfile: currentGameProfile(row.game_profile_json, row.report_payload_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    shareSlug: row.share_slug ?? undefined
  }));
  const activity = activityRows.results.map((row) => ({
    jobId: row.id,
    targetUrl: row.target_url,
    occupationCode: row.occupation_code,
    occupationTitle: row.occupation_title ?? row.occupation_code,
    ...historyPresentation(row.target_url),
    status: row.status,
    stage: row.stage,
    progress: row.progress,
    queuedAt: row.queued_at ?? row.updated_at,
    startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
    queuePosition:
      row.status === "queued" && row.queue_position !== null
        ? Number(row.queue_position)
        : undefined,
    autoRetryCount: Number(row.auto_retry_count),
    updatedAt: row.updated_at
  }));
  return attachActorCookie(c, c.json({ cards, activity }));
});

app.delete("/api/cards/:id", async (c) => {
  if (!c.env.ANON_SESSION_SECRET) {
    return c.json({ error: { code: "setup_required", message: "Collection is unavailable" } }, 503);
  }
  const actor = await getOrCreateActor(c.req.raw, c.env);
  c.set("actorId", actor.actorId);
  c.set("actorHash", actor.actorHash);
  if (actor.setCookie) c.set("setActorCookie", actor.setCookie);
  const deleted = await c.env.DB.prepare(
    "DELETE FROM skill_cards WHERE id = ?1 AND actor_hash = ?2"
  )
    .bind(c.req.param("id"), actor.actorHash)
    .run();
  if (!deleted.meta.changes) {
    return attachActorCookie(
      c,
      c.json({ error: { code: "not_found", message: "Manual not found" } }, 404)
    );
  }
  return attachActorCookie(c, c.body(null, 204));
});

app.post("/api/cards/:id/share", async (c) => {
  if (!c.env.ANON_SESSION_SECRET) {
    return c.json({ error: { code: "setup_required", message: "Sharing is unavailable" } }, 503);
  }
  const actor = await getOrCreateActor(c.req.raw, c.env);
  c.set("actorId", actor.actorId);
  c.set("actorHash", actor.actorHash);
  if (actor.setCookie) c.set("setActorCookie", actor.setCookie);
  const existing = await c.env.DB.prepare(
    `SELECT sc.id, sc.share_slug
     FROM skill_cards sc
     JOIN jobs j ON j.id = sc.job_id
     WHERE sc.id = ?1
       AND sc.actor_hash = ?2
       AND sc.expires_at > ?3
       AND j.publication_status = 'published'`
  )
    .bind(c.req.param("id"), actor.actorHash, new Date().toISOString())
    .first<{ id: string; share_slug: string | null }>();
  if (!existing) {
    return attachActorCookie(
      c,
      c.json({ error: { code: "not_found", message: "Manual not found" } }, 404)
    );
  }
  const shareSlug =
    existing.share_slug ?? crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  if (!existing.share_slug) {
    await c.env.DB.prepare(
      `UPDATE skill_cards
       SET share_slug = ?1, updated_at = ?2
       WHERE id = ?3 AND actor_hash = ?4 AND share_slug IS NULL`
    )
      .bind(shareSlug, new Date().toISOString(), existing.id, actor.actorHash)
      .run();
  }
  const baseUrl = (c.env.PUBLIC_APP_URL || new URL(c.req.url).origin).replace(/\/$/, "");
  return attachActorCookie(
    c,
    c.json({
      shareSlug,
      shareUrl: `${baseUrl}/c/${shareSlug}`
    })
  );
});

app.get("/api/public/cards/:slug", async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT sc.id, sc.target_url, sc.display_name, sc.occupation_title,
            sc.game_profile_json, sc.created_at, r.payload_json AS report_payload_json
     FROM skill_cards sc
     JOIN jobs j ON j.id = sc.job_id
     JOIN reports r ON r.id = sc.report_id
     WHERE sc.share_slug = ?1
       AND sc.expires_at > ?2
       AND j.publication_status = 'published'`
  )
    .bind(c.req.param("slug"), new Date().toISOString())
    .first<{
      id: string;
      target_url: string;
      display_name: string;
      occupation_title: string;
      game_profile_json: string;
      created_at: string;
      report_payload_json: string;
    }>();
  if (!row) {
    return c.json({ error: { code: "not_found", message: "Shared manual not found" } }, 404);
  }
  const storedProfile = currentGameProfile(row.game_profile_json, row.report_payload_json);
  const publicProfile: GameProfile = {
    ...storedProfile,
    axes: storedProfile.axes.map((axis) => ({
      ...axis,
      evidenceIds: [],
      signalIds: [],
      signalDetails: axis.signalDetails?.map((signal) => ({
        ...signal,
        evidenceIds: []
      }))
    }))
  };
  return c.json({
    id: row.id,
    targetUrl: row.target_url,
    displayName: row.display_name,
    occupationTitle: row.occupation_title,
    gameProfile: publicProfile,
    createdAt: row.created_at
  });
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
      occupationCode: occupation.code,
      sourcesFinalized: true
    });
    return c.json({ jobId: result.jobId, capabilityToken: result.capabilityToken }, 202);
  } catch (error) {
    if (error instanceof JobGateError) {
      return c.json({ error: { code: error.code, message: error.message } }, error.status);
    }
    throw error;
  }
});

app.get("/api/reports/:id", async (c) => {
  if (c.req.query("lang") !== undefined && !requestedLocale(c.req.query("lang"))) {
    return c.json(
      { error: { code: "invalid_locale", message: "Supported locales are zh-TW and en" } },
      400
    );
  }
  if (c.req.param("id") === "demo") return c.json(demoReportBundle);
  const row = await c.env.DB.prepare(
    `SELECT r.payload_json, r.job_id
     FROM reports r
     JOIN jobs j ON j.id = r.job_id
     WHERE r.id = ?1
       AND j.status = 'completed'
       AND j.publication_status = 'published'`
  )
    .bind(c.req.param("id"))
    .first<{ payload_json: string; job_id: string }>();
  if (!row) return c.json({ error: { code: "not_found", message: "Report not found" } }, 404);
  let report: ReportPayload;
  try {
    const stored = JSON.parse(row.payload_json) as unknown;
    if (isBilingualReportBundle(stored)) {
      report = {
        ...stored,
        locales: Object.fromEntries(
          Object.entries(stored.locales).map(([locale, localized]) => [
            locale,
            localized ? upgradeStoredReport(localized) : localized
          ])
        ) as Partial<Record<Locale, ReverseReport>>
      };
    } else {
      report = upgradeStoredReport(stored);
    }
  } catch (error) {
    if (error instanceof ReportUpgradeError || error instanceof SyntaxError) {
      return c.json(
        {
          error: {
            code: "report_upgrade_required",
            message: "This report needs owner attention before it can be opened"
          }
        },
        409
      );
    }
    throw error;
  }
  const localizedReports: ReverseReport[] = isBilingualReportBundle(report)
    ? Object.values(report.locales).filter(
        (value): value is ReverseReport => Boolean(value)
      )
    : [report];
  if (localizedReports.some((localized) => Array.isArray(localized.sources))) {
    const artifacts = await c.env.DB.prepare(
      `SELECT id, r2_key, metadata_json
       FROM source_artifacts
       WHERE job_id = ?1 AND r2_key IS NOT NULL`
    )
      .bind(row.job_id)
      .all<{ id: string; r2_key: string; metadata_json: string }>();
    const archived = new Map(
      artifacts.results.map((artifact) => {
        let screenshotKey: string | undefined;
        try {
          const metadata = JSON.parse(artifact.metadata_json) as { screenshotKey?: unknown };
          if (typeof metadata.screenshotKey === "string") screenshotKey = metadata.screenshotKey;
        } catch {
          // Older archived sources only have the text snapshot.
        }
        return [
          artifact.id.slice(`${row.job_id}-`.length),
          {
            snapshot: true,
            screenshot: Boolean(screenshotKey)
          }
        ] as const;
      })
    );
    for (const localized of localizedReports) {
      localized.sources = localized.sources.map((source) => {
        const artifact = archived.get(source.id);
        return artifact
          ? {
              ...source,
              archive: {
                snapshotUrl: `/api/reports/${encodeURIComponent(c.req.param("id"))}/artifacts/${encodeURIComponent(source.id)}`,
                screenshotUrl: artifact.screenshot
                  ? `/api/reports/${encodeURIComponent(c.req.param("id"))}/artifacts/${encodeURIComponent(source.id)}?view=screenshot`
                  : undefined
              }
            }
          : source;
      });
    }
  }
  if (!c.env.ANON_SESSION_SECRET) {
    return c.json(withViewerCanShare(report, false));
  }
  const actor = await getOrCreateActor(c.req.raw, c.env);
  c.set("actorId", actor.actorId);
  c.set("actorHash", actor.actorHash);
  if (actor.setCookie) c.set("setActorCookie", actor.setCookie);
  const ownedCard = await c.env.DB.prepare(
    `SELECT 1 AS owned
     FROM skill_cards
     WHERE report_id = ?1
       AND actor_hash = ?2
       AND expires_at > ?3`
  )
    .bind(c.req.param("id"), actor.actorHash, new Date().toISOString())
    .first<{ owned: number }>();
  return attachActorCookie(
    c,
    c.json(withViewerCanShare(report, Boolean(ownedCard)))
  );
});

app.get("/api/reports/:reportId/artifacts/:sourceId", async (c) => {
  const view = c.req.query("view") === "screenshot" ? "screenshot" : "snapshot";
  const row = await c.env.DB.prepare(
    `SELECT a.r2_key, a.metadata_json
     FROM source_artifacts a
     JOIN reports r ON r.job_id = a.job_id
     JOIN jobs j ON j.id = a.job_id
     WHERE r.id = ?1
       AND a.id = a.job_id || '-' || ?2
       AND j.status = 'completed'
       AND j.publication_status = 'published'`
  )
    .bind(c.req.param("reportId"), c.req.param("sourceId"))
    .first<{ r2_key: string | null; metadata_json: string }>();
  if (!row?.r2_key) {
    return c.json({ error: { code: "not_found", message: "Archived source not found" } }, 404);
  }
  let objectKey = row.r2_key;
  if (view === "screenshot") {
    try {
      const metadata = JSON.parse(row.metadata_json) as { screenshotKey?: unknown };
      if (typeof metadata.screenshotKey !== "string") {
        return c.json({ error: { code: "not_found", message: "Archived screenshot not found" } }, 404);
      }
      objectKey = metadata.screenshotKey;
    } catch {
      return c.json({ error: { code: "not_found", message: "Archived screenshot not found" } }, 404);
    }
  }
  const object = await c.env.ARTIFACTS.get(objectKey);
  if (!object?.body) {
    return c.json({ error: { code: "not_found", message: "Archived source not found" } }, 404);
  }
  const extension = view === "screenshot" ? "png" : "md";
  return new Response(object.body, {
    headers: {
      "content-type": view === "screenshot" ? "image/png" : "text/plain; charset=utf-8",
      "content-disposition": `inline; filename="${c.req.param("sourceId")}.${extension}"`,
      "x-content-type-options": "nosniff",
      "cross-origin-resource-policy": "same-origin",
      "content-security-policy": "default-src 'none'; sandbox"
    }
  });
});

app.get("/api/admin/reports", async (c) => {
  const locale = requestedLocale(c.req.query("lang"));
  if (!locale) {
    return c.json(
      { error: { code: "invalid_locale", message: "Supported locales are zh-TW and en" } },
      400
    );
  }
  const statusQuery = c.req.query("status");
  const status: PublicationStatus | null =
    statusQuery === "published" || statusQuery === "hidden" ? statusQuery : null;
  const query = (c.req.query("query") ?? "").trim().slice(0, 160);
  const requestedLimit = Number(c.req.query("limit") ?? 50);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(100, Math.floor(requestedLimit)))
    : 50;
  const rows = await c.env.DB.prepare(
    `SELECT r.id AS report_id, r.title, r.payload_json, j.id AS job_id, j.target_url,
            j.publication_status, j.published_at, j.hidden_at, j.moderation_note,
            o.title AS occupation_title, o.localizations_json AS occupation_localizations_json
     FROM reports r
     JOIN jobs j ON j.id = r.job_id
     LEFT JOIN occupations o ON o.code = j.occupation_code
     WHERE j.publication_status IN ('published', 'hidden')
       AND (?1 IS NULL OR j.publication_status = ?1)
       AND (
         ?2 = ''
         OR lower(r.title) LIKE '%' || lower(?2) || '%'
         OR lower(j.target_url) LIKE '%' || lower(?2) || '%'
       )
     ORDER BY COALESCE(j.published_at, j.created_at) DESC, j.id DESC
     LIMIT ?3`
  )
    .bind(status, query, limit)
    .all<{
      report_id: string;
      title: string;
      payload_json: string;
      job_id: string;
      target_url: string;
      publication_status: PublicationStatus;
      published_at: string | null;
      hidden_at: string | null;
      moderation_note: string | null;
      occupation_title: string | null;
      occupation_localizations_json: string | null;
    }>();
  return c.json({
    items: rows.results.map((row) => ({
      reportId: row.report_id,
      jobId: row.job_id,
      title: (() => {
        try {
          const payload = JSON.parse(row.payload_json) as ReportPayload;
          return resolveReport(payload, locale).title;
        } catch {
          return row.title;
        }
      })(),
      targetUrl: row.target_url,
      publicationStatus: row.publication_status,
      publishedAt: row.published_at,
      hiddenAt: row.hidden_at,
      moderationNote: row.moderation_note,
      occupationTitle: row.occupation_title
        ? localizedOccupationTitle(
            row.occupation_title,
            row.occupation_localizations_json ?? "{}",
            locale
          )
        : null
    }))
  });
});

app.patch("/api/admin/reports/:id", async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | { action?: unknown; reason?: unknown }
    | null;
  const action = body?.action;
  if (action !== "hide" && action !== "restore") {
    return c.json(
      { error: { code: "invalid_request", message: "Choose hide or restore" } },
      400
    );
  }
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) : "";
  const now = new Date().toISOString();
  const updated =
    action === "hide"
      ? await c.env.DB.prepare(
          `UPDATE jobs
           SET publication_status = 'hidden', hidden_at = ?1, moderation_note = ?2,
               updated_at = ?1
           WHERE report_id = ?3 AND publication_status = 'published'`
        )
          .bind(now, reason || null, c.req.param("id"))
          .run()
      : await c.env.DB.prepare(
          `UPDATE jobs
           SET publication_status = 'published', hidden_at = NULL, moderation_note = NULL,
               updated_at = ?1
           WHERE report_id = ?2 AND publication_status = 'hidden'`
        )
          .bind(now, c.req.param("id"))
          .run();
  if (!updated.meta.changes) {
    return c.json(
      { error: { code: "not_found", message: "Report was not found in that state" } },
      404
    );
  }
  return c.json({
    reportId: c.req.param("id"),
    publicationStatus: action === "hide" ? "hidden" : "published"
  });
});

app.delete("/api/admin/reports/:id", async (c) => {
  const row = await c.env.DB.prepare("SELECT job_id FROM reports WHERE id = ?1")
    .bind(c.req.param("id"))
    .first<{ job_id: string }>();
  if (!row) return c.json({ error: { code: "not_found", message: "Report not found" } }, 404);
  await c.env.DB.prepare("DELETE FROM skill_cards WHERE job_id = ?1")
    .bind(row.job_id)
    .run();
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
    checks.database = {
      ok: schema?.value === "7",
      detail: `schema ${schema?.value ?? "missing"}`
    };
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
    checks.adminAccess = {
      ok: Boolean(c.env.CF_ACCESS_TEAM_DOMAIN && c.env.CF_ACCESS_AUD),
      detail:
        c.env.CF_ACCESS_TEAM_DOMAIN && c.env.CF_ACCESS_AUD
          ? "team domain and audience configured"
          : "owner moderation is fail-closed until Access is configured"
    };
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
      const scheduler = await c.env.RESEARCH_SCHEDULER.getByName("global").health();
      checks.scheduler = {
        ok: scheduler.ok,
        detail: `${scheduler.active} active · ${scheduler.pending} pending`
      };
    } catch (error) {
      checks.scheduler = {
        ok: false,
        detail: error instanceof Error ? error.message : "unavailable"
      };
    }
    try {
      await c.env.RESEARCH_QUEUE.metrics();
      checks.queue = { ok: true, detail: "binding responded" };
    } catch (error) {
      checks.queue = {
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
    version: c.env.CF_VERSION_METADATA
      ? {
          id: c.env.CF_VERSION_METADATA.id,
          tag: c.env.CF_VERSION_METADATA.tag || undefined,
          createdAt: c.env.CF_VERSION_METADATA.timestamp
        }
      : undefined,
    status:
      resolveAppMode(c.env) === "locked" ? "setup_required" : requiredOk ? "ready" : "degraded",
    checks: authorized ? checks : undefined,
    summary: {
      required: Object.values(checks).filter((check) => check.ok).length,
      total: Object.keys(checks).length
    }
  });
});

async function serveAdminShell(c: Context<HonoEnv>) {
  const authorization = await authorizeAdmin(c.req.raw, c.env);
  if (!authorization.ok) {
    return c.json(
      { error: { code: authorization.code, message: authorization.message } },
      authorization.status
    );
  }
  if (!c.env.ASSETS) return c.text("Not found", 404);
  return c.env.ASSETS.fetch(new Request(new URL("/", c.req.url), c.req.raw));
}

app.get("/admin", serveAdminShell);
app.get("/admin/*", serveAdminShell);
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
    `SELECT a.id, a.r2_key, a.metadata_json
     FROM source_artifacts a
     JOIN jobs j ON j.id = a.job_id
     WHERE a.r2_key IS NOT NULL
       AND a.retrieved_at <= ?1
       AND j.publication_status != 'published'
     LIMIT 250`
  )
    .bind(artifactCutoff)
    .all<{ id: string; r2_key: string; metadata_json: string }>();
  for (const artifact of staleArtifacts.results) {
    let screenshotKey: string | undefined;
    try {
      const metadata = JSON.parse(artifact.metadata_json) as { screenshotKey?: unknown };
      if (typeof metadata.screenshotKey === "string") screenshotKey = metadata.screenshotKey;
    } catch {
      // Older artifacts may not have structured metadata.
    }
    await Promise.all([
      env.ARTIFACTS.delete(artifact.r2_key),
      screenshotKey ? env.ARTIFACTS.delete(screenshotKey) : Promise.resolve()
    ]);
    await env.DB.prepare("UPDATE source_artifacts SET r2_key = NULL WHERE id = ?1")
      .bind(artifact.id)
      .run();
  }

  const expired = await env.DB.prepare(
    `SELECT j.id
     FROM jobs j
     WHERE j.expires_at <= ?1
       AND j.publication_status != 'published'
     LIMIT 100`
  )
    .bind(new Date().toISOString())
    .all<{ id: string }>();
  for (const job of expired.results) {
    const objects = await env.ARTIFACTS.list({ prefix: `jobs/${job.id}/` });
    await Promise.all(objects.objects.map((object) => env.ARTIFACTS.delete(object.key)));
    await env.DB.prepare("DELETE FROM jobs WHERE id = ?1").bind(job.id).run();
  }
  await env.DB.prepare("DELETE FROM skill_cards WHERE expires_at <= ?1")
    .bind(new Date().toISOString())
    .run();
}

async function failDeadLetterJob(env: AppEnv, jobId: string): Promise<void> {
  const row = await env.DB.prepare(
    `SELECT actor_hash, created_at
     FROM jobs WHERE id = ?1 AND status = 'queued'`
  )
    .bind(jobId)
    .first<{ actor_hash: string; created_at: string }>();
  if (!row) return;
  const now = new Date().toISOString();
  const failed = await env.DB.prepare(
    `UPDATE jobs
     SET status = 'failed', error_code = 'queue_delivery_failed',
         error_message = 'The research request could not reach the scheduler',
         finished_at = ?1, updated_at = ?1
     WHERE id = ?2 AND status = 'queued'`
  )
    .bind(now, jobId)
    .run();
  if (!failed.meta.changes) return;
  await Promise.all([
    env.ACTOR_GATE.getByName(row.actor_hash).release(jobId),
    env.DAILY_BUDGET.getByName(row.created_at.slice(0, 10)).release(jobId),
    env.RESEARCH_SCHEDULER.getByName("global").complete(jobId)
  ]);
}

export default {
  fetch: app.fetch,
  async queue(
    batch: MessageBatch<ResearchQueueMessage>,
    env: AppEnv
  ): Promise<void> {
    const deadLetter = batch.queue === "skill-reverse-jobs-dlq";
    for (const message of batch.messages) {
      try {
        if (!message.body?.jobId) {
          message.ack();
          continue;
        }
        if (deadLetter) {
          await failDeadLetterJob(env, message.body.jobId);
        } else {
          await env.RESEARCH_SCHEDULER.getByName("global").enqueue(message.body.jobId);
        }
        message.ack();
      } catch (error) {
        console.error(
          JSON.stringify({
            event: deadLetter ? "dead_letter_handler_failed" : "queue_admission_failed",
            jobId: message.body?.jobId,
            attempts: message.attempts,
            message: error instanceof Error ? error.message : "unknown error"
          })
        );
        message.retry({ delaySeconds: deadLetter ? 60 : 10 });
      }
    }
  },
  scheduled(_controller: ScheduledController, env: AppEnv, ctx: ExecutionContext) {
    ctx.waitUntil(cleanupExpired(env));
  }
} satisfies ExportedHandler<AppEnv, ResearchQueueMessage>;
