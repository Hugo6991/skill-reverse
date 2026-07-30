import stack from "../analytics/stack.json";
import analyticsState from "../analytics/state.json";
import type { Locale } from "./types";

export type AnalyticsEventName =
  | "page_view"
  | "target_url_entered"
  | "occupation_selected"
  | "research_started"
  | "source_collection_viewed"
  | "sources_submitted"
  | "sources_skipped"
  | "job_stage_viewed"
  | "research_completed"
  | "research_failed"
  | "report_viewed"
  | "report_section_expanded"
  | "evidence_opened"
  | "source_link_opened"
  | "share_created"
  | "share_completed"
  | "collection_viewed"
  | "card_removed"
  | "language_changed";

export interface AnalyticsProperties {
  locale?: Locale;
  route_kind?: string;
  occupation_code?: string;
  research_stage?: string;
  report_type?: "demo" | "private" | "published";
  source_count?: number;
  source_submission_type?: "submitted" | "skipped";
  duration_bucket?: string;
  queue_duration_bucket?: string;
  degraded_count?: number;
  error_code?: string;
  share_method?: "native" | "clipboard" | "download";
}

type AnalyticsPayload = AnalyticsProperties & {
  event_id: string;
  occurred_at: string;
};

declare global {
  interface Window {
    dataLayer: Array<Record<string, unknown>>;
  }
}

const allowedKeys = new Set<keyof AnalyticsProperties>([
  "locale",
  "route_kind",
  "occupation_code",
  "research_stage",
  "report_type",
  "source_count",
  "source_submission_type",
  "duration_bucket",
  "queue_duration_bucket",
  "degraded_count",
  "error_code",
  "share_method"
]);
const excludedPaths = stack.site.excludedPaths;
let sharedContext: AnalyticsProperties = {};
let initialized = false;

export function initializeAnalytics(): void {
  if (initialized || !isTrackablePage()) return;
  initialized = true;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({
    "gtm.start": Date.now(),
    event: "gtm.js"
  });
  const publicId = stack.google.gtmPublicId || analyticsState.google.gtmPublicId;
  if (!publicId) return;
  const script = document.createElement("script");
  script.async = true;
  const nonce = document.querySelector<HTMLMetaElement>('meta[name="csp-nonce"]')?.content;
  if (nonce) script.nonce = nonce;
  script.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(publicId)}`;
  script.referrerPolicy = "strict-origin-when-cross-origin";
  document.head.appendChild(script);
}

export function setAnalyticsContext(context: AnalyticsProperties): void {
  sharedContext = sanitizeProperties({ ...sharedContext, ...context });
}

export function track(
  eventName: AnalyticsEventName,
  properties: AnalyticsProperties = {}
): string | undefined {
  if (!isTrackablePage()) return undefined;
  window.dataLayer = window.dataLayer || [];
  const payload: AnalyticsPayload = {
    event_id: crypto.randomUUID(),
    occurred_at: new Date().toISOString(),
    ...sanitizeProperties(sharedContext),
    ...sanitizeProperties(properties)
  };
  window.dataLayer.push({
    event: "product_event",
    event_name: eventName,
    ...payload,
    event_payload_base64: encodePayload(payload)
  });
  return payload.event_id;
}

export function routeKindFromPath(pathname = window.location.pathname): string {
  const [first = "home"] = pathname.split("/").filter(Boolean);
  if (first === "reports") return "report";
  if (first === "jobs") return "job";
  if (first === "c") return "public_card";
  return first;
}

export function analyticsDurationBucket(
  from: string | undefined,
  to: string | undefined
): string | undefined {
  if (!from || !to) return undefined;
  const seconds = Math.max(0, (Date.parse(to) - Date.parse(from)) / 1_000);
  if (!Number.isFinite(seconds)) return undefined;
  if (seconds < 10) return "under_10s";
  if (seconds < 30) return "10_29s";
  if (seconds < 60) return "30_59s";
  if (seconds < 180) return "1_2m";
  if (seconds < 600) return "3_9m";
  return "10m_plus";
}

function isTrackablePage(): boolean {
  const pathname = window.location.pathname;
  const hostnameAllowed =
    stack.site.hostnames.includes(window.location.hostname) ||
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";
  return (
    hostnameAllowed &&
    !excludedPaths.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
    )
  );
}

function sanitizeProperties(input: AnalyticsProperties): AnalyticsProperties {
  const output: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!allowedKeys.has(key as keyof AnalyticsProperties)) continue;
    if (typeof value === "string") {
      const normalized = value.trim().slice(0, 100);
      if (normalized) output[key] = normalized;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      output[key] = Math.max(0, Math.round(value));
    }
  }
  return output as AnalyticsProperties;
}

function encodePayload(payload: AnalyticsPayload): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return window.btoa(binary);
}
