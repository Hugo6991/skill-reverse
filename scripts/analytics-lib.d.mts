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
