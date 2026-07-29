import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { getOccupation } from "./occupations";
import {
  assembleReport,
  captureUrl,
  draftToModelResult,
  fetchSocialEvidence,
  runOpenRouterSynthesis,
  runPerplexityResearch,
  type CapturedArtifact
} from "./services";
import { loadJobSources, selectCaptureSources } from "./job-sources";
import {
  addJobCost,
  getJobCost,
  providerErrorDetails
} from "./provider-ledger";
import type { AppEnv } from "./types";
import { historyPresentation } from "./history";
import { targetKey as normalizedTargetKey } from "./publication";
import type { GameMotifId, GameProfile } from "../src/types";
import { GAME_MOTIF_IDS, type IdentitySelectionContext } from "./game-identity";

export interface ResearchWorkflowParams {
  kind?: "research" | "health";
  jobId?: string;
  actorHash?: string;
  targetUrl?: string;
  supportUrls?: string[];
  occupationCode?: string;
  capabilityHash?: string;
  reservedCents?: number;
  day?: string;
}

async function updateJob(
  db: D1Database,
  jobId: string,
  values: {
    stage?: string;
    status?: string;
    progress?: number;
    actualCents?: number;
    reportId?: string;
    degraded?: string[];
    errorCode?: string | null;
    errorMessage?: string | null;
    sourceWindowClosesAt?: string | null;
    sourcesFinalizedAt?: string | null;
    startedAt?: string | null;
    finishedAt?: string | null;
    autoRetryCount?: number;
    lastAutoRetryAt?: string | null;
  }
): Promise<void> {
  const sets: string[] = ["updated_at = ?"];
  const params: unknown[] = [new Date().toISOString()];
  const add = (column: string, value: unknown) => {
    sets.push(`${column} = ?`);
    params.push(value);
  };
  if (values.stage !== undefined) add("stage", values.stage);
  if (values.status !== undefined) add("status", values.status);
  if (values.progress !== undefined) add("progress", values.progress);
  if (values.actualCents !== undefined) add("actual_cents", values.actualCents);
  if (values.reportId !== undefined) add("report_id", values.reportId);
  if (values.degraded !== undefined) add("degraded_json", JSON.stringify(values.degraded));
  if (values.errorCode !== undefined) add("error_code", values.errorCode);
  if (values.errorMessage !== undefined) add("error_message", values.errorMessage);
  if (values.sourceWindowClosesAt !== undefined) {
    add("source_window_closes_at", values.sourceWindowClosesAt);
  }
  if (values.sourcesFinalizedAt !== undefined) {
    add("sources_finalized_at", values.sourcesFinalizedAt);
  }
  if (values.startedAt !== undefined) add("started_at", values.startedAt);
  if (values.finishedAt !== undefined) add("finished_at", values.finishedAt);
  if (values.autoRetryCount !== undefined) add("auto_retry_count", values.autoRetryCount);
  if (values.lastAutoRetryAt !== undefined) {
    add("last_auto_retry_at", values.lastAutoRetryAt);
  }
  params.push(jobId);
  await db
    .prepare(`UPDATE jobs SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...params)
    .run();
}

export class ResearchWorkflow extends WorkflowEntrypoint<AppEnv, ResearchWorkflowParams> {
  async run(event: WorkflowEvent<ResearchWorkflowParams>, step: WorkflowStep): Promise<unknown> {
    if (event.payload.kind === "health") {
      return step.do("health noop", async () => ({ ok: true, at: new Date().toISOString() }));
    }

    const params = event.payload;
    const {
      jobId,
      actorHash,
      targetUrl,
      occupationCode,
      capabilityHash,
      day = new Date().toISOString().slice(0, 10),
      reservedCents = 50
    } = params;
    if (!jobId || !actorHash || !targetUrl || !occupationCode || !capabilityHash) {
      throw new Error("Invalid research workflow payload");
    }

    const actor = this.env.ACTOR_GATE.getByName(actorHash);
    const budget = this.env.DAILY_BUDGET.getByName(day);
    const degraded: string[] = [];
    try {
      await step.do("mark job running", async () => {
        const startedAt = new Date().toISOString();
        await updateJob(this.env.DB, jobId, {
          stage: "capture",
          status: "running",
          progress: 12,
          startedAt
        });
      });

      const primaryCapture = await step.do(
        "capture primary artifact",
        { retries: { limit: 2, delay: "10 seconds", backoff: "linear" } },
        async () => captureUrl(this.env, jobId, targetUrl, 1)
      );

      const sourceCollection = await step.do("open optional source collection", async () => {
        const current = await this.env.DB.prepare(
          "SELECT sources_finalized_at FROM jobs WHERE id = ?1"
        )
          .bind(jobId)
          .first<{ sources_finalized_at: string | null }>();
        if (current?.sources_finalized_at) {
          return { finalized: true, sourceWindowClosesAt: null };
        }
        const sourceWindowClosesAt = new Date(Date.now() + 90_000).toISOString();
        await updateJob(this.env.DB, jobId, {
          stage: "source_collection",
          status: "running",
          progress: 22,
          sourceWindowClosesAt
        });
        return { finalized: false, sourceWindowClosesAt };
      });

      if (!sourceCollection.finalized) {
        try {
          await step.waitForEvent<{ urls?: string[] }>("wait for optional supporting sources", {
            type: "sources-ready",
            timeout: "90 seconds"
          });
        } catch (error) {
          console.info(
            JSON.stringify({
              event: "source_collection_timeout",
              jobId,
              message: error instanceof Error ? error.message : "timeout"
            })
          );
        }
      }

      const supportingUrls = await step.do("finalize optional sources", async () => {
        const values = await loadJobSources(this.env.DB, jobId);
        await updateJob(this.env.DB, jobId, {
          sourcesFinalizedAt: new Date().toISOString()
        });
        return selectCaptureSources(targetUrl, values);
      });

      const supportingCaptures = await step.do(
        "capture supporting artifacts",
        { retries: { limit: 1, delay: "10 seconds", backoff: "linear" } },
        async () => {
          const results: CapturedArtifact[] = [];
          for (let index = 0; index < supportingUrls.length; index += 1) {
            const url = supportingUrls[index];
            try {
              results.push(await captureUrl(this.env, jobId, url, index + 2));
            } catch (error) {
              degraded.push(
                `Supporting source skipped (${new URL(url).hostname}): ${
                  error instanceof Error ? error.message : "capture error"
                }`
              );
            }
          }
          return results;
        }
      );
      const captured = [primaryCapture, ...supportingCaptures];

      const occupation = await step.do("load professional baseline", async () => {
        await updateJob(this.env.DB, jobId, {
          stage: "professional_baseline",
          progress: 36,
          degraded
        });
        const profile = await getOccupation(this.env.DB, occupationCode);
        if (!profile) throw new Error(`Occupation ${occupationCode} is unavailable`);
        return profile;
      });

      const social = await step.do(
        "collect targeted social provenance",
        { retries: { limit: 1, delay: "15 seconds" } },
        async () => {
          await updateJob(this.env.DB, jobId, {
            stage: "research",
            progress: 46,
            degraded
          });
          const result = await fetchSocialEvidence(this.env, captured, targetUrl);
          if (result.degraded) degraded.push(result.degraded);
          await addJobCost(
            this.env.DB,
            jobId,
            Math.ceil(result.posts.length * 0.015)
          );
          return result;
        }
      );

      const researched = await step.do(
        "reverse research with structured evidence",
        {
          retries: {
            limit: Math.max(1, Number(this.env.AUTO_RETRY_LIMIT || 1) + 1),
            delay: ({ error }) =>
              providerErrorDetails(error).code === "provider_rate_limited"
                ? "60 seconds"
                : "20 seconds",
            backoff: "exponential"
          }
        },
        async (context) => {
          if (context.attempt > 1) {
            const retriedAt = new Date().toISOString();
            await updateJob(this.env.DB, jobId, {
              autoRetryCount: context.attempt - 1,
              lastAutoRetryAt: retriedAt
            });
          }
          await updateJob(this.env.DB, jobId, {
            stage: "source_verification",
            progress: 62,
            degraded
          });
          try {
            return await runPerplexityResearch(
              this.env,
              targetUrl,
              occupation,
              captured,
              social.posts,
              jobId
            );
          } catch (error) {
            const details = providerErrorDetails(error);
            if (!details.retryable) {
              throw new NonRetryableError(details.internalMessage);
            }
            throw error;
          }
        }
      );

      await updateJob(this.env.DB, jobId, {
        stage: "hypothesis_generation",
        progress: 76,
        degraded
      });
      const identityContext = await step.do("load collection identity context", async () => {
        const result = await this.env.DB.prepare(
          `SELECT game_profile_json
           FROM skill_cards
           WHERE actor_hash = ?1
           ORDER BY created_at ASC, id ASC
           LIMIT 200`
        )
          .bind(actorHash)
          .all<{ game_profile_json: string }>();
        const context: IdentitySelectionContext = {
          usedTitles: [],
          motifUsage: Object.fromEntries(
            GAME_MOTIF_IDS.map((motif) => [motif, 0])
          ) as Record<GameMotifId, number>
        };
        for (const row of result.results ?? []) {
          try {
            const profile = JSON.parse(row.game_profile_json) as Partial<GameProfile>;
            if (profile.rubricVersion !== "game-profile-v2" || !profile.identity) continue;
            context.usedTitles?.push(profile.identity.title);
            context.motifUsage![profile.identity.motifId] =
              (context.motifUsage![profile.identity.motifId] ?? 0) + 1;
          } catch {
            // A malformed historical card must not block a new report.
          }
        }
        return context;
      });
      let synthesized:
        | { result: ReturnType<typeof draftToModelResult>; estimatedCents: number; degraded?: undefined }
        | { result: ReturnType<typeof draftToModelResult>; estimatedCents: 0; degraded: string };
      if (!this.env.OPENROUTER_API_KEY) {
        synthesized = {
          result: draftToModelResult(researched.result, targetUrl),
          estimatedCents: 0,
          degraded: "OpenRouter synthesis unavailable; Perplexity research draft was used"
        };
      } else {
        try {
          const result = await step.do(
            "synthesize final report with OpenAI via OpenRouter",
            {
              retries: {
                limit: Math.max(1, Number(this.env.AUTO_RETRY_LIMIT || 1) + 1),
                delay: ({ error }) =>
                  providerErrorDetails(error).code === "provider_rate_limited"
                    ? "60 seconds"
                    : "20 seconds",
                backoff: "exponential"
              }
            },
            async (context) => {
              if (context.attempt > 1) {
                await updateJob(this.env.DB, jobId, {
                  autoRetryCount: context.attempt - 1,
                  lastAutoRetryAt: new Date().toISOString()
                });
              }
              try {
                return await runOpenRouterSynthesis(
                  this.env,
                  targetUrl,
                  occupation,
                  captured,
                  researched.result,
                  researched.citations,
                  jobId,
                  identityContext
                );
              } catch (error) {
                const details = providerErrorDetails(error);
                if (!details.retryable) {
                  throw new NonRetryableError(details.internalMessage);
                }
                throw error;
              }
            }
          );
          synthesized = { ...result, degraded: undefined };
        } catch (error) {
          synthesized = {
            result: draftToModelResult(researched.result, targetUrl),
            estimatedCents: 0,
            degraded: `OpenRouter synthesis unavailable: ${
              providerErrorDetails(error).publicMessage
            }`
          };
        }
      }
      if (synthesized.degraded) degraded.push(synthesized.degraded);

      const report = await step.do("assemble evidence graph", async () => {
        await updateJob(this.env.DB, jobId, {
          stage: "hypothesis_generation",
          progress: 82,
          degraded
        });
        return assembleReport({
          id: crypto.randomUUID(),
          targetUrl,
          occupation,
          model: synthesized.result,
          captured,
          posts: social.posts,
          citations: researched.citations,
          degraded,
          identityContext,
          useFallbackIdentity: Boolean(synthesized.degraded)
        });
      });

      await step.do("persist report", async () => {
        const now = new Date();
        const publishedAt = now.toISOString();
        const permanentExpiry = "9999-12-31T23:59:59.999Z";
        const cardExpires = new Date(now.getTime() + 365 * 86_400_000).toISOString();
        const presentation = historyPresentation(targetUrl, JSON.stringify(report));
        const targetKey = normalizedTargetKey(targetUrl);
        const statements = captured.map((artifact) =>
          this.env.DB.prepare(
            `INSERT OR REPLACE INTO source_artifacts
             (id, job_id, url, kind, status, title, retrieved_at, r2_key, excerpt, metadata_json)
             VALUES (?1, ?2, ?3, ?4, 'verified_at_retrieval', ?5, ?6, ?7, ?8, ?9)`
          ).bind(
            `${jobId}-${artifact.id}`,
            jobId,
            artifact.url,
            artifact.url.includes("github.com") ? "github" : "website",
            artifact.title,
            publishedAt,
            artifact.r2Key,
            artifact.excerpt,
            JSON.stringify({
              screenshotKey: artifact.screenshotKey ?? null,
              repositoryMetrics: artifact.repositoryMetrics ?? null
            })
          )
        );
        const reportInsert = this.env.DB.prepare(
          `INSERT INTO reports
           (id, job_id, capability_hash, title, payload_json, created_at, expires_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
        ).bind(
          report.id,
          jobId,
          capabilityHash,
          report.title,
          JSON.stringify(report),
          publishedAt,
          permanentExpiry
        );
        const skillCardUpsert = this.env.DB.prepare(
          `INSERT INTO skill_cards
           (id, actor_hash, job_id, report_id, target_key, target_url, display_name,
            occupation_code, occupation_title, game_profile_json, created_at, updated_at, expires_at)
           VALUES (?1, ?2, ?3, ?1, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10, ?11)
           ON CONFLICT(actor_hash, target_key, occupation_code) DO UPDATE SET
             id = excluded.id,
             job_id = excluded.job_id,
             report_id = excluded.report_id,
             target_url = excluded.target_url,
             display_name = excluded.display_name,
             occupation_title = excluded.occupation_title,
             game_profile_json = excluded.game_profile_json,
             updated_at = excluded.updated_at,
             expires_at = excluded.expires_at`
        ).bind(
          report.id,
          actorHash,
          jobId,
          targetKey,
          targetUrl,
          presentation.displayName,
          occupation.code,
          occupation.title,
          JSON.stringify(report.gameProfile),
          publishedAt,
          cardExpires
        );
        const publishJob = this.env.DB.prepare(
          `UPDATE jobs
           SET stage = 'report', status = 'completed', progress = 100, report_id = ?1,
               degraded_json = ?2, finished_at = ?3, publication_status = 'published',
               published_at = ?3, hidden_at = NULL, moderation_note = NULL, updated_at = ?3
           WHERE id = ?4`
        ).bind(report.id, JSON.stringify(degraded), publishedAt, jobId);
        await this.env.DB.batch([
          ...statements,
          reportInsert,
          skillCardUpsert,
          publishJob
        ]);
      });

      await step.do("settle gates", async () => {
        const actualCents = await getJobCost(this.env.DB, jobId);
        await Promise.all([
          actor.release(jobId),
          budget.settle(jobId, actualCents),
          this.env.RESEARCH_SCHEDULER.getByName("global").complete(jobId)
        ]);
      });
      const actualCents = await getJobCost(this.env.DB, jobId);
      return { reportId: report.id, actualCents, degraded };
    } catch (error) {
      const details = providerErrorDetails(error);
      await updateJob(this.env.DB, jobId, {
        status: "failed",
        degraded,
        errorCode: details.code,
        errorMessage: details.internalMessage.slice(0, 500),
        finishedAt: new Date().toISOString()
      });
      const actualCents = await getJobCost(this.env.DB, jobId);
      await Promise.allSettled([
        actor.release(jobId),
        budget.settle(jobId, actualCents),
        this.env.RESEARCH_SCHEDULER.getByName("global").complete(jobId)
      ]);
      throw error;
    }
  }
}
