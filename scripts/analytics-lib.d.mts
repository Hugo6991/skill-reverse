export type AnalyticsProvider =
  | "ga4"
  | "clarity"
  | "mixpanel"
  | "search-console";

export const ANALYTICS_PROVIDERS: readonly AnalyticsProvider[];
export const GTM_PROVIDERS: readonly Exclude<AnalyticsProvider, "search-console">[];

export function parseProviders(args?: string[]): AnalyticsProvider[];
export function selectedGtmProviders(
  providers: Iterable<AnalyticsProvider | string>
): Exclude<AnalyticsProvider, "search-console">[];
export function gtmLiveVersionUrl(containerPath: string): string;
export function publishedGtmResources(remoteGtm: {
  live?: AnalyticsGtmResources;
  [key: string]: unknown;
}): Required<AnalyticsGtmResources>;
export function gtmVersionResponseErrors(
  response: unknown,
  options?: { requireVersionPath?: boolean }
): string[];

export type GtmResourceKind = "variable" | "trigger" | "tag";
export type GtmReconciliationConflictReason =
  | "duplicate-managed-resource"
  | "unselected-managed-provider"
  | "stale-managed-resource"
  | "legacy-analytics-tag";

export interface AnalyticsGtmResources {
  variables?: AnalyticsNamedResource[];
  triggers?: AnalyticsNamedResource[];
  tags?: AnalyticsNamedResource[];
}

export interface GtmReconciliationConflict {
  kind: GtmResourceKind;
  name: string;
  reason: GtmReconciliationConflictReason;
  provider?: Exclude<AnalyticsProvider, "search-console">;
}

export interface GtmUntouchedResource {
  kind: GtmResourceKind;
  name: string;
}

export interface GtmReconciliationInspection {
  conflicts: GtmReconciliationConflict[];
  untouched: GtmUntouchedResource[];
}

export interface GtmDesiredDrift {
  kind: GtmResourceKind;
  name: string;
  reason: "missing-managed-resource" | "managed-resource-drift";
  differingKeys?: string[];
}

export function inspectGtmProviderReconciliation(
  existing: AnalyticsGtmResources,
  desired: AnalyticsGtmResources,
  providers?: Iterable<AnalyticsProvider>
): GtmReconciliationInspection;
export function inspectGtmDesiredDrift(
  existing: AnalyticsGtmResources,
  desired: AnalyticsGtmResources
): GtmDesiredDrift[];

export function partitionProvidersByPrerequisites(
  providers: Iterable<AnalyticsProvider>,
  prerequisites: Partial<Record<AnalyticsProvider, string[]>>
): {
  runnable: AnalyticsProvider[];
  skipped: Array<{ provider: AnalyticsProvider; missing: string[] }>;
};
export function invalidateWorkspaceApplyState<T extends Record<string, unknown>>(
  state: T,
  options: {
    checksum: string;
    providers: Iterable<AnalyticsProvider>;
    startedAt: string;
  }
): T & {
  applyAttemptChecksum: string;
  applyAttemptProviders: AnalyticsProvider[];
  applyAttemptStartedAt: string;
  appliedChecksum: "";
  appliedProviders: [];
};
export function createPendingWorkspaceState<T extends Record<string, unknown>>(
  state: T,
  options: {
    checksum: string;
    providers: Iterable<AnalyticsProvider>;
    google: Record<string, unknown>;
    recordedAt: string;
  }
): T & {
  google: Record<string, unknown>;
  workspaceChecksum: string;
  workspaceProviders: AnalyticsProvider[];
  workspaceSavedAt: string;
  appliedChecksum: "";
  appliedProviders: [];
};
export function completePendingWorkspaceState<T extends Record<string, unknown>>(
  state: T,
  options: {
    checksum: string;
    providers: Iterable<AnalyticsProvider>;
    appliedAt: string;
  }
): T & {
  appliedChecksum: string;
  appliedProviders: AnalyticsProvider[];
  lastAppliedAt: string;
  applyAttemptChecksum: "";
  applyAttemptProviders: [];
  applyAttemptStartedAt: "";
};
export function publishStateErrors(
  state: unknown,
  checksum: string,
  providers: Iterable<AnalyticsProvider>
): string[];

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  operation?: "oauth-token";
  sleep?: (milliseconds: number) => Promise<unknown>;
}

export function fetchWithSafeRetries<T extends { status: number }>(
  fetchImplementation: (input: RequestInfo | URL, init?: RequestInit) => Promise<T>,
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: RetryOptions
): Promise<T>;

export interface AnalyticsNamedResource {
  name: string;
  [key: string]: unknown;
}

export interface AnalyticsEnhancedMeasurementSettings {
  streamEnabled: boolean;
  scrollsEnabled: boolean;
  outboundClicksEnabled: boolean;
  fileDownloadsEnabled: boolean;
  pageChangesEnabled: boolean;
  siteSearchEnabled: boolean;
  formInteractionsEnabled: boolean;
  videoEngagementEnabled: boolean;
}

export interface AnalyticsDesiredState {
  gtm: {
    folderName: string;
    variables: AnalyticsNamedResource[];
    triggers: AnalyticsNamedResource[];
    tags: AnalyticsNamedResource[];
    builtInVariables: string[];
  };
  ga: {
    customDimensions: Array<Record<string, unknown>>;
    keyEvents: Array<Record<string, unknown>>;
    enhancedMeasurement: AnalyticsEnhancedMeasurementSettings;
    retention: Record<string, boolean | string>;
    emailRedactionEnabled: boolean;
  };
  mixpanel: {
    schemas: Array<Record<string, unknown>>;
  };
  clarity: Record<string, unknown>;
}

export function buildDesiredState(
  config: unknown,
  plan: unknown,
  ids: unknown,
  providers?: Iterable<AnalyticsProvider>
): AnalyticsDesiredState;
