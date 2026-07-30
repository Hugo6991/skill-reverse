import type { AppEnv } from "./types";
import stack from "../analytics/stack.json";

export type WorkerAnalyticsEvent =
  | "research_queued"
  | "research_running"
  | "research_completed"
  | "research_failed"
  | "research_retried"
  | "report_published";

export interface WorkerAnalyticsProperties {
  jobId: string;
  eventId?: string;
  reportId?: string;
  occupationCode?: string;
  researchStage?: string;
  reportType?: "private" | "published";
  sourceCount?: number;
  durationBucket?: string;
  queueDurationBucket?: string;
  degradedCount?: number;
  errorCode?: string;
}

export async function trackWorkerEvent(
  env: AppEnv,
  event: WorkerAnalyticsEvent,
  input: WorkerAnalyticsProperties
): Promise<void> {
  const token = env.MIXPANEL_TOKEN?.trim() || stack.mixpanel.projectToken.trim();
  if (!token) return;
  const eventId = input.eventId ?? crypto.randomUUID();
  const properties = compact({
    token,
    distinct_id: `job:${input.jobId}`,
    $insert_id: eventId,
    event_id: eventId,
    occurred_at: new Date().toISOString(),
    job_id: input.jobId,
    report_id: input.reportId,
    occupation_code: input.occupationCode,
    research_stage: input.researchStage,
    report_type: input.reportType,
    source_count: input.sourceCount,
    duration_bucket: input.durationBucket,
    queue_duration_bucket: input.queueDurationBucket,
    degraded_count: input.degradedCount,
    error_code: input.errorCode
  });
  try {
    const response = await fetch(`${mixpanelApiHost(env)}/track?strict=1`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json"
      },
      body: JSON.stringify([{ event, properties }]),
      signal: AbortSignal.timeout(2_000)
    });
    if (!response.ok) {
      console.warn(
        JSON.stringify({
          event: "analytics_delivery_failed",
          provider: "mixpanel",
          analyticsEvent: event,
          status: response.status
        })
      );
    }
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "analytics_delivery_failed",
        provider: "mixpanel",
        analyticsEvent: event,
        reason: error instanceof Error ? error.name : "unknown"
      })
    );
  }
}

export function durationBucket(
  from: string | null | undefined,
  to = new Date().toISOString()
): string | undefined {
  if (!from) return undefined;
  const seconds = Math.max(0, (Date.parse(to) - Date.parse(from)) / 1_000);
  if (!Number.isFinite(seconds)) return undefined;
  if (seconds < 10) return "under_10s";
  if (seconds < 30) return "10_29s";
  if (seconds < 60) return "30_59s";
  if (seconds < 180) return "1_2m";
  if (seconds < 600) return "3_9m";
  return "10m_plus";
}

function mixpanelApiHost(env: AppEnv): string {
  if (env.MIXPANEL_API_HOST?.startsWith("https://")) {
    return env.MIXPANEL_API_HOST.replace(/\/+$/, "");
  }
  const region = env.MIXPANEL_REGION || stack.mixpanel.region;
  if (region === "EU") return "https://api-eu.mixpanel.com";
  if (region === "IN" || region === "India") return "https://api-in.mixpanel.com";
  return "https://api.mixpanel.com";
}

function compact(
  input: Record<string, string | number | undefined>
): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(input).filter(
      (entry): entry is [string, string | number] => entry[1] !== undefined
    )
  );
}
