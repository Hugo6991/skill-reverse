import type { AppEnv } from "./types";

export type ProviderName = "perplexity" | "openrouter";
export type ProviderOutcome =
  | "success"
  | "http_error"
  | "empty_response"
  | "truncated"
  | "schema_error"
  | "network_error";

export class ProviderCallError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly publicMessage: string,
    message?: string
  ) {
    super(`[${code}] ${message ?? publicMessage}`);
    this.name = "ProviderCallError";
  }
}

export function providerErrorDetails(error: unknown): {
  code: string;
  retryable: boolean;
  publicMessage: string;
  internalMessage: string;
} {
  if (error instanceof ProviderCallError) {
    return {
      code: error.code,
      retryable: error.retryable,
      publicMessage: error.publicMessage,
      internalMessage: error.message
    };
  }
  if (error instanceof Error) {
    const code = error.message.match(/\[([a-z0-9_]+)\](?:\s|$)/)?.[1];
    if (code) {
      return {
        code,
        retryable: isRetryableJobError(code),
        publicMessage:
          code === "provider_output_truncated" || code === "provider_schema_invalid"
            ? "The research provider returned an incomplete result"
            : code === "provider_empty_response"
              ? "The research provider returned an empty result"
              : code === "provider_timeout"
                ? "The research provider timed out"
                : code === "provider_rate_limited" || code === "provider_unavailable"
                  ? "The research provider is temporarily unavailable"
                  : "Research could not be completed",
        internalMessage: error.message
      };
    }
  }
  return {
    code: "research_failed",
    retryable: false,
    publicMessage: "Research could not be completed",
    internalMessage: error instanceof Error ? error.message : "Unknown workflow error"
  };
}

export const RETRYABLE_JOB_ERRORS = new Set([
  "provider_timeout",
  "provider_rate_limited",
  "provider_unavailable",
  "provider_empty_response",
  "provider_output_truncated",
  "provider_schema_invalid"
]);

export function isRetryableJobError(code: string | null | undefined): boolean {
  return Boolean(code && RETRYABLE_JOB_ERRORS.has(code));
}

interface ProviderLedgerEntry {
  jobId: string;
  provider: ProviderName;
  model: string;
  requestId?: string;
  httpStatus?: number;
  finishReason?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  costMicrousd?: number;
  outcome: ProviderOutcome;
  errorCode?: string;
  errorMessage?: string;
}

export async function recordProviderCall(
  env: AppEnv,
  entry: ProviderLedgerEntry
): Promise<number> {
  if (!env.DB) return 0;
  const attemptRow = await env.DB.prepare(
    `SELECT COUNT(*) AS count
     FROM provider_calls
     WHERE job_id = ?1 AND provider = ?2`
  )
    .bind(entry.jobId, entry.provider)
    .first<{ count: number }>();
  const attempt = Number(attemptRow?.count ?? 0) + 1;
  const costMicrousd = Math.max(0, Math.round(entry.costMicrousd ?? 0));
  const chargedCents = costMicrousd > 0 ? Math.max(1, Math.ceil(costMicrousd / 10_000)) : 0;
  const statement = env.DB.prepare(
    `INSERT INTO provider_calls
     (id, job_id, provider, model, request_id, http_status, finish_reason,
      prompt_tokens, completion_tokens, total_tokens, cost_microusd, attempt,
      outcome, error_code, error_message, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)`
  ).bind(
    crypto.randomUUID(),
    entry.jobId,
    entry.provider,
    entry.model,
    entry.requestId ?? null,
    entry.httpStatus ?? null,
    entry.finishReason ?? null,
    entry.promptTokens ?? null,
    entry.completionTokens ?? null,
    entry.totalTokens ?? null,
    costMicrousd || null,
    attempt,
    entry.outcome,
    entry.errorCode ?? null,
    entry.errorMessage?.slice(0, 300) ?? null,
    new Date().toISOString()
  );
  if (chargedCents > 0) {
    await env.DB.batch([
      statement,
      env.DB.prepare(
        `UPDATE jobs
         SET actual_cents = actual_cents + ?1, updated_at = ?2
         WHERE id = ?3`
      ).bind(chargedCents, new Date().toISOString(), entry.jobId)
    ]);
  } else {
    await statement.run();
  }
  return chargedCents;
}

export async function addJobCost(db: D1Database, jobId: string, cents: number): Promise<void> {
  if (cents <= 0) return;
  await db.prepare(
    `UPDATE jobs
     SET actual_cents = actual_cents + ?1, updated_at = ?2
     WHERE id = ?3`
  )
    .bind(Math.ceil(cents), new Date().toISOString(), jobId)
    .run();
}

export async function getJobCost(db: D1Database, jobId: string): Promise<number> {
  const row = await db.prepare("SELECT actual_cents FROM jobs WHERE id = ?1")
    .bind(jobId)
    .first<{ actual_cents: number }>();
  return Number(row?.actual_cents ?? 0);
}
