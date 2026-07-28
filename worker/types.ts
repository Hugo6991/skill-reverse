import type { ActorGate, DailyBudget, ResearchScheduler } from "./durable";
import type { ResearchWorkflowParams } from "./workflow";

export interface ResearchQueueMessage {
  jobId: string;
}

export interface BrowserRunBinding {
  quickAction(
    action: "markdown" | "snapshot" | "screenshot" | "links",
    input: Record<string, unknown>
  ): Promise<Response>;
}

export interface WorkflowInstance {
  id: string;
  status(): Promise<{
    status:
      | "queued"
      | "running"
      | "paused"
      | "errored"
      | "terminated"
      | "complete"
      | "waiting"
      | "waitingForPause"
      | "unknown";
    error?: { name: string; message: string };
    output?: unknown;
  }>;
  sendEvent<T>(options: { type: string; payload: T }): Promise<void>;
  restart(options?: { from?: { name: string } }): Promise<void>;
}

export interface WorkflowBinding<T> {
  create(options?: { id?: string; params?: T }): Promise<WorkflowInstance>;
  get(id: string): Promise<WorkflowInstance>;
}

export interface RateLimitBinding {
  limit(input: { key: string }): Promise<{ success: boolean }>;
}

export interface AppEnv {
  DB: D1Database;
  ARTIFACTS: R2Bucket;
  BROWSER: BrowserRunBinding;
  RESEARCH_WORKFLOW: WorkflowBinding<ResearchWorkflowParams>;
  ACTOR_GATE: DurableObjectNamespace<ActorGate>;
  DAILY_BUDGET: DurableObjectNamespace<DailyBudget>;
  RESEARCH_SCHEDULER: DurableObjectNamespace<ResearchScheduler>;
  RESEARCH_QUEUE: Queue<ResearchQueueMessage>;
  BURST_LIMITER: RateLimitBinding;
  ASSETS: Fetcher;
  APP_MODE: "locked" | "demo" | "public";
  JOB_USD_LIMIT: string;
  DAILY_USD_LIMIT: string;
  ANON_DAILY_JOB_LIMIT: string;
  GLOBAL_RESEARCH_CONCURRENCY: string;
  ACTOR_ACTIVE_JOB_LIMIT: string;
  ACTOR_OUTSTANDING_JOB_LIMIT: string;
  AUTO_RETRY_LIMIT: string;
  PUBLIC_APP_URL: string;
  OPENROUTER_SYNTHESIS_MODEL: string;
  REPORT_TTL_DAYS: string;
  ARTIFACT_TTL_DAYS: string;
  PERPLEXITY_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  TWITTERAPI_KEY?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  ANON_SESSION_SECRET?: string;
  SETUP_CAPABILITY?: string;
  SETUP_COMPLETE?: string;
}

export type AppVariables = {
  actorId: string;
  actorHash: string;
  setActorCookie?: string;
};

export type HonoEnv = {
  Bindings: AppEnv;
  Variables: AppVariables;
};

export interface JobRow {
  id: string;
  actor_hash: string;
  target_url: string;
  support_urls_json: string;
  occupation_code: string;
  stage: string;
  status: string;
  progress: number;
  reserved_cents: number;
  actual_cents: number;
  capability_hash: string | null;
  workflow_id: string | null;
  report_id: string | null;
  degraded_json: string;
  error_code: string | null;
  error_message: string | null;
  source_window_closes_at: string | null;
  sources_finalized_at: string | null;
  retry_count: number;
  last_retry_at: string | null;
  queued_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  auto_retry_count: number;
  last_auto_retry_at: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
}
