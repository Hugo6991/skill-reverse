import { describe, expect, it, vi } from "vitest";
import {
  ANALYTICS_PROVIDERS,
  buildDesiredState,
  completePendingWorkspaceState,
  createPendingWorkspaceState,
  fetchWithSafeRetries,
  invalidateWorkspaceApplyState,
  parseProviders,
  partitionProvidersByPrerequisites,
  publishStateErrors
} from "../scripts/analytics-lib.mjs";

const stack = {
  site: {
    hostnames: ["example.com"],
    excludedPaths: ["/admin", "/api"]
  },
  clarity: {
    projectId: "clarity-project",
    maskingMode: "balanced",
    cookiesEnabled: true,
    botDetection: true
  },
  mixpanel: {
    projectToken: "mixpanel-token",
    region: "US",
    persistence: "localStorage"
  }
};

const plan = {
  properties: {
    locale: { type: "string", description: "Locale" },
    occurred_at: { type: "string", description: "Timestamp" }
  },
  events: [
    {
      name: "research_started",
      description: "Research started",
      keyEvent: true
    }
  ]
};

const ids = { gaMeasurementId: "G-TEST" };

describe("analytics provider selection", () => {
  it("defaults to the complete stack and canonicalizes an explicit subset", () => {
    expect(parseProviders([])).toEqual(ANALYTICS_PROVIDERS);
    expect(parseProviders(["--providers=mixpanel,ga4,mixpanel"])).toEqual([
      "ga4",
      "mixpanel"
    ]);
  });

  it("rejects unknown and empty provider selections", () => {
    expect(() => parseProviders(["--providers=ga4,unknown"])).toThrow(
      "Unknown analytics provider"
    );
    expect(() => parseProviders(["--providers="])).toThrow(
      "at least one provider"
    );
  });

  it("reports every selected provider that cannot be verified", () => {
    const result = partitionProvidersByPrerequisites(ANALYTICS_PROVIDERS, {
      ga4: ["google credentials"],
      clarity: ["clarity.projectId"],
      mixpanel: ["mixpanel.projectId"],
      "search-console": []
    });
    expect(result.runnable).toEqual(["search-console"]);
    expect(result.skipped).toEqual([
      { provider: "ga4", missing: ["google credentials"] },
      { provider: "clarity", missing: ["clarity.projectId"] },
      { provider: "mixpanel", missing: ["mixpanel.projectId"] }
    ]);
  });

  it("keeps shared data-layer variables but omits unselected provider resources", () => {
    const desired = buildDesiredState(stack, plan, ids, ["ga4"]);
    const variableNames = desired.gtm.variables.map((item: { name: string }) => item.name);
    const triggerNames = desired.gtm.triggers.map((item: { name: string }) => item.name);
    const tagNames = desired.gtm.tags.map((item: { name: string }) => item.name);

    expect(variableNames).toContain("[managed] GA Measurement ID");
    expect(variableNames).toContain("[managed] DLV - locale");
    expect(variableNames).not.toContain("[managed] Clarity Project ID");
    expect(variableNames).not.toContain("[managed] Mixpanel Project Token");
    expect(triggerNames).not.toContain("[managed] Clarity Event");
    expect(triggerNames).not.toContain("[managed] Mixpanel Event");
    expect(tagNames).toEqual([
      "[managed] Google Tag",
      "[managed] GA4 Product Event",
      "[managed] GA4 Page View"
    ]);
  });

  it("generates only the selected Clarity or Mixpanel GTM resources", () => {
    const clarity = buildDesiredState(stack, plan, ids, ["clarity"]);
    expect(clarity.gtm.tags.map((item: { name: string }) => item.name)).toEqual([
      "[managed] Clarity Initialization",
      "[managed] Clarity Event / Custom Tags"
    ]);
    const clarityInitHtml = String(
      (
        clarity.gtm.tags[0] as unknown as {
          parameter: Array<{ value: string }>;
        }
      ).parameter[0].value
    );
    expect(clarityInitHtml).toContain('"consentv2"');
    expect(clarityInitHtml).toContain('ad_Storage:"denied"');
    expect(clarityInitHtml).toContain('analytics_Storage:"granted"');
    expect(clarityInitHtml).not.toContain("identify");
    expect(clarityInitHtml).not.toContain("localStorage");
    expect(clarity.ga.customDimensions).toEqual([]);
    expect(clarity.mixpanel.schemas).toEqual([]);

    const mixpanel = buildDesiredState(stack, plan, ids, ["mixpanel"]);
    expect(mixpanel.gtm.tags.map((item: { name: string }) => item.name)).toEqual([
      "[managed] Mixpanel Initialization",
      "[managed] Mixpanel Product Event"
    ]);
    expect(mixpanel.gtm.variables.map((item: { name: string }) => item.name)).not.toContain(
      "[managed] Clarity Project ID"
    );
    expect(mixpanel.mixpanel.schemas).toHaveLength(1);
  });

  it("keeps the existing complete-stack desired state as the default", () => {
    const desired = buildDesiredState(stack, plan, ids);
    expect(desired.gtm.triggers).toHaveLength(7);
    expect(desired.gtm.tags).toHaveLength(7);
    expect(desired.ga.customDimensions).toHaveLength(10);
    expect(desired.mixpanel.schemas).toHaveLength(1);
  });

  it("does not generate GTM resources for Search Console alone", () => {
    const desired = buildDesiredState(stack, plan, ids, ["search-console"]);
    expect(desired.gtm.variables).toEqual([]);
    expect(desired.gtm.triggers).toEqual([]);
    expect(desired.gtm.tags).toEqual([]);
  });
});

describe("analytics publish guard", () => {
  const state = {
    google: { gtmWorkspaceId: "workspace-1" },
    workspaceChecksum: "checksum-1",
    workspaceProviders: ["ga4", "clarity", "search-console"],
    appliedChecksum: "checksum-1",
    appliedProviders: ["ga4", "clarity", "search-console"]
  };

  it("accepts the exact checksum and provider set", () => {
    expect(
      publishStateErrors(state, "checksum-1", ["clarity", "ga4", "search-console"])
    ).toEqual([]);
  });

  it("rejects checksum and provider mismatches", () => {
    expect(publishStateErrors(state, "checksum-2", ["ga4", "mixpanel"]).join("\n"))
      .toContain("does not match the current manifest");
    expect(publishStateErrors(state, "checksum-2", ["ga4", "mixpanel"]).join("\n"))
      .toContain("do not match the requested providers");
  });

  it("handles legacy state without the new fields without crashing", () => {
    expect(
      publishStateErrors({ google: { gtmWorkspaceId: "legacy" } }, "checksum-1", ["ga4"])
        .join("\n")
    ).toContain("predates complete apply state");
  });

  it("invalidates an earlier complete apply before any new remote mutation", () => {
    const invalidated = invalidateWorkspaceApplyState(state, {
      checksum: "checksum-1",
      providers: ["ga4", "clarity", "search-console"],
      startedAt: "2026-08-05T00:00:00.000Z"
    });
    expect(invalidated).toMatchObject({
      google: { gtmWorkspaceId: "workspace-1" },
      workspaceChecksum: "checksum-1",
      applyAttemptChecksum: "checksum-1",
      applyAttemptProviders: ["ga4", "clarity", "search-console"],
      appliedChecksum: "",
      appliedProviders: []
    });
    expect(
      publishStateErrors(invalidated, "checksum-1", [
        "ga4",
        "clarity",
        "search-console"
      ]).join("\n")
    ).toContain("apply attempt is incomplete");

    const pending = createPendingWorkspaceState(invalidated, {
      checksum: "checksum-1",
      providers: ["ga4", "clarity", "search-console"],
      google: { gtmWorkspaceId: "workspace-1" },
      recordedAt: "2026-08-05T00:00:30.000Z"
    });
    const completed = completePendingWorkspaceState(pending, {
      checksum: "checksum-1",
      providers: ["ga4", "clarity", "search-console"],
      appliedAt: "2026-08-05T00:01:00.000Z"
    });
    expect(completed).toMatchObject({
      applyAttemptChecksum: "",
      applyAttemptProviders: [],
      applyAttemptStartedAt: "",
      appliedChecksum: "checksum-1"
    });
  });

  it("records a resumable pending workspace but refuses publish until completion", () => {
    const pending = createPendingWorkspaceState(
      {
        google: { gtmContainerId: "container-1" },
        appliedChecksum: "previous-checksum",
        appliedProviders: ["ga4"]
      },
      {
        checksum: "checksum-1",
        providers: ["ga4", "mixpanel", "search-console"],
        google: { gtmWorkspaceId: "workspace-1" },
        recordedAt: "2026-08-05T00:00:00.000Z"
      }
    );
    expect(pending).toMatchObject({
      google: {
        gtmContainerId: "container-1",
        gtmWorkspaceId: "workspace-1"
      },
      workspaceChecksum: "checksum-1",
      workspaceProviders: ["ga4", "mixpanel", "search-console"],
      appliedChecksum: "",
      appliedProviders: []
    });
    expect(
      publishStateErrors(pending, "checksum-1", [
        "ga4",
        "mixpanel",
        "search-console"
      ]).join("\n")
    ).toContain("workspace is pending");

    const complete = completePendingWorkspaceState(pending, {
      checksum: "checksum-1",
      providers: ["ga4", "mixpanel", "search-console"],
      appliedAt: "2026-08-05T00:01:00.000Z"
    });
    expect(
      publishStateErrors(complete, "checksum-1", [
        "ga4",
        "mixpanel",
        "search-console"
      ])
    ).toEqual([]);
    expect(
      publishStateErrors(complete, "checksum-1", ["ga4", "mixpanel"]).join("\n")
    ).toContain("do not match the requested providers");
  });

  it("cannot complete a pending workspace for a different provider set", () => {
    const pending = createPendingWorkspaceState(
      { google: {} },
      {
        checksum: "checksum-1",
        providers: ["ga4"],
        google: { gtmWorkspaceId: "workspace-1" },
        recordedAt: "2026-08-05T00:00:00.000Z"
      }
    );
    expect(() =>
      completePendingWorkspaceState(pending, {
        checksum: "checksum-1",
        providers: ["ga4", "mixpanel"],
        appliedAt: "2026-08-05T00:01:00.000Z"
      })
    ).toThrow("pending workspace does not match");
  });
});

describe("safe analytics retries", () => {
  it("retries transient GET responses with a finite budget", async () => {
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce({ status: 503 })
      .mockResolvedValueOnce({ status: 429 })
      .mockResolvedValueOnce({ status: 200 });
    const response = await fetchWithSafeRetries(fetchImplementation, "https://example.com", {}, {
      sleep: async () => undefined
    });
    expect(response.status).toBe(200);
    expect(fetchImplementation).toHaveBeenCalledTimes(3);
  });

  it("does not retry writes, except the explicitly safe OAuth token exchange", async () => {
    const write = vi.fn().mockResolvedValue({ status: 503 });
    await fetchWithSafeRetries(write, "https://example.com/write", { method: "POST" }, {
      sleep: async () => undefined
    });
    expect(write).toHaveBeenCalledTimes(1);

    const token = vi
      .fn()
      .mockResolvedValueOnce({ status: 503 })
      .mockResolvedValueOnce({ status: 200 });
    await fetchWithSafeRetries(
      token,
      "https://example.com/token",
      { method: "POST" },
      { operation: "oauth-token", sleep: async () => undefined }
    );
    expect(token).toHaveBeenCalledTimes(2);
  });
});
