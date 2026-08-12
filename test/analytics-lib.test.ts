import { describe, expect, it, vi } from "vitest";
import {
  ANALYTICS_PROVIDERS,
  buildDesiredState,
  completePendingWorkspaceState,
  createPendingWorkspaceState,
  fetchWithSafeRetries,
  gtmLiveVersionUrl,
  gtmVersionResponseErrors,
  invalidateWorkspaceApplyState,
  inspectGtmDesiredDrift,
  inspectGtmProviderReconciliation,
  parseProviders,
  partitionProvidersByPrerequisites,
  publishedGtmResources,
  publishStateErrors
} from "../scripts/analytics-lib.mjs";

const stack = {
  site: {
    hostnames: ["example.com"],
    excludedPaths: ["/admin", "/api"]
  },
  google: {
    sendPageView: false,
    enhancedMeasurement: {
      streamEnabled: true,
      scrollsEnabled: true,
      outboundClicksEnabled: false,
      fileDownloadsEnabled: false,
      pageChangesEnabled: false,
      siteSearchEnabled: false,
      formInteractionsEnabled: false,
      videoEngagementEnabled: false
    }
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

  it("uses only the explicit SPA page-view event and disables URL-bearing enhanced events", () => {
    const desired = buildDesiredState(stack, plan, ids, ["ga4"]);
    const googleTag = desired.gtm.tags.find(
      (item) => item.name === "[managed] Google Tag"
    ) as unknown as {
      parameter: Array<{
        key: string;
        list?: Array<{ map: Array<{ key: string; value: string }> }>;
      }>;
    };
    const configSettings = googleTag.parameter.find(
      (parameter) => parameter.key === "configSettingsTable"
    );

    expect(configSettings?.list?.[0].map).toEqual([
      { type: "TEMPLATE", key: "parameter", value: "send_page_view" },
      { type: "TEMPLATE", key: "parameterValue", value: "false" }
    ]);
    expect(
      desired.gtm.tags.filter((item) => item.name === "[managed] GA4 Page View")
    ).toHaveLength(1);
    expect(desired.ga.enhancedMeasurement).toMatchObject({
      outboundClicksEnabled: false,
      fileDownloadsEnabled: false,
      pageChangesEnabled: false
    });
  });

  it("defaults URL-bearing automatic measurements and automatic page views to off", () => {
    const desired = buildDesiredState(
      { ...stack, google: undefined },
      plan,
      ids,
      ["ga4"]
    );
    const serializedGoogleTag = JSON.stringify(
      desired.gtm.tags.find((item) => item.name === "[managed] Google Tag")
    );

    expect(serializedGoogleTag).toContain('"key":"parameter","value":"send_page_view"');
    expect(serializedGoogleTag).toContain('"key":"parameterValue","value":"false"');
    expect(desired.ga.enhancedMeasurement.outboundClicksEnabled).toBe(false);
    expect(desired.ga.enhancedMeasurement.fileDownloadsEnabled).toBe(false);
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

describe("GTM provider reconciliation guard", () => {
  const ga4 = buildDesiredState(stack, plan, ids, ["ga4"]).gtm;

  it("uses the GTM live pseudo-version endpoint", () => {
    expect(
      gtmLiveVersionUrl("accounts/1/containers/2")
    ).toBe(
      "https://tagmanager.googleapis.com/tagmanager/v2/accounts/1/containers/2/versions:live"
    );
  });

  it("rejects GTM sync, preview and version error responses", () => {
    expect(
      gtmVersionResponseErrors({
        syncStatus: { syncError: true, mergeConflict: true }
      })
    ).toEqual(["syncError", "mergeConflict"]);
    expect(gtmVersionResponseErrors({ mergeConflict: [{}] })).toEqual([
      "mergeConflict"
    ]);
    expect(gtmVersionResponseErrors({ compilerError: true })).toEqual([
      "compilerError"
    ]);
    expect(gtmVersionResponseErrors({}, { requireVersionPath: true })).toEqual([
      "missingContainerVersionPath"
    ]);
    expect(
      gtmVersionResponseErrors(
        { containerVersion: { path: "accounts/1/containers/2/versions/3" } },
        { requireVersionPath: true }
      )
    ).toEqual([]);
  });

  it("verifies published live resources instead of an un-published workspace", () => {
    expect(
      publishedGtmResources({
        ...ga4,
        workspaceId: "workspace-1",
        live: { variables: [], triggers: [], tags: [] }
      })
    ).toEqual({ variables: [], triggers: [], tags: [] });
  });

  it("rejects inherited managed Clarity and Mixpanel resources for a GA4-only selection", () => {
    const result = inspectGtmProviderReconciliation(
      {
        variables: [
          ...ga4.variables,
          { name: "[managed] Clarity Project ID" },
          { name: "[managed] Mixpanel Project Token" }
        ],
        triggers: ga4.triggers,
        tags: [
          ...ga4.tags,
          { name: "[managed] Clarity Initialization", type: "html" },
          { name: "[managed] Mixpanel Initialization", type: "html" }
        ]
      },
      ga4,
      ["ga4"]
    );

    expect(result.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "[managed] Clarity Initialization",
          provider: "clarity",
          reason: "unselected-managed-provider"
        }),
        expect.objectContaining({
          name: "[managed] Mixpanel Initialization",
          provider: "mixpanel",
          reason: "unselected-managed-provider"
        })
      ])
    );
  });

  it("rejects a recognized duplicate legacy Google Analytics tag", () => {
    const result = inspectGtmProviderReconciliation(
      {
        variables: ga4.variables,
        triggers: ga4.triggers,
        tags: [
          ...ga4.tags,
          {
            name: "Legacy page-load GA",
            type: "googtag",
            parameter: [{ key: "tagId", value: "G-LEGACY123" }]
          }
        ]
      },
      ga4,
      ["ga4"]
    );

    expect(result.conflicts).toContainEqual({
      kind: "tag",
      name: "Legacy page-load GA",
      provider: "ga4",
      reason: "legacy-analytics-tag"
    });
  });

  it("allows paused legacy analytics while keeping paused managed conflicts strict", () => {
    const result = inspectGtmProviderReconciliation(
      {
        variables: ga4.variables,
        triggers: ga4.triggers,
        tags: [
          ...ga4.tags,
          {
            name: "Paused legacy Google Analytics",
            type: "googtag",
            paused: true,
            parameter: [{ key: "tagId", value: "G-LEGACY123" }]
          },
          { name: "[managed] Clarity Initialization", type: "html", paused: true }
        ]
      },
      ga4,
      ["ga4"]
    );

    expect(result.untouched).toContainEqual({
      kind: "tag",
      name: "Paused legacy Google Analytics"
    });
    expect(result.conflicts).toContainEqual({
      kind: "tag",
      name: "[managed] Clarity Initialization",
      provider: "clarity",
      reason: "unselected-managed-provider"
    });
  });

  it("leaves an AW-only Google Ads tag untouched", () => {
    const result = inspectGtmProviderReconciliation(
      {
        variables: ga4.variables,
        triggers: ga4.triggers,
        tags: [
          ...ga4.tags,
          {
            name: "Google Tag",
            type: "googtag",
            parameter: [{ key: "tagId", value: "AW-123456789" }]
          }
        ]
      },
      ga4,
      ["ga4"]
    );

    expect(result.conflicts).toEqual([]);
    expect(result.untouched).toContainEqual({
      kind: "tag",
      name: "Google Tag"
    });
  });

  it("recognizes a legacy Google tag that references a GA measurement variable", () => {
    const result = inspectGtmProviderReconciliation(
      {
        variables: ga4.variables,
        triggers: ga4.triggers,
        tags: [
          ...ga4.tags,
          {
            name: "Legacy analytics loader",
            type: "googtag",
            parameter: [{ key: "tagId", value: "{{Legacy GA Measurement ID}}" }]
          }
        ]
      },
      ga4,
      ["ga4"]
    );

    expect(result.conflicts).toContainEqual({
      kind: "tag",
      name: "Legacy analytics loader",
      provider: "ga4",
      reason: "legacy-analytics-tag"
    });
  });

  it("recognizes neutral custom HTML analytics loaders", () => {
    const result = inspectGtmProviderReconciliation(
      {
        variables: ga4.variables,
        triggers: ga4.triggers,
        tags: [
          ...ga4.tags,
          {
            name: "Legacy loader one",
            type: "html",
            parameter: [
              { key: "html", value: '<script>gtag("config","G-OTHER")</script>' }
            ]
          },
          {
            name: "Legacy loader two",
            type: "html",
            parameter: [
              { key: "html", value: '<script>clarity("event","x")</script>' }
            ]
          }
        ]
      },
      ga4,
      ["ga4"]
    );

    expect(result.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Legacy loader one",
          provider: "ga4",
          reason: "legacy-analytics-tag"
        }),
        expect.objectContaining({
          name: "Legacy loader two",
          provider: "clarity",
          reason: "legacy-analytics-tag"
        })
      ])
    );
  });

  it("accepts semantically equivalent managed tags from the GTM API", () => {
    const existing = structuredClone(ga4);
    existing.triggers = existing.triggers.map((trigger, index) => ({
      ...trigger,
      triggerId: String(index + 1)
    }));
    existing.tags = existing.tags.map((tag) => {
      const firing = existing.triggers.find(
        (trigger) => trigger.name === tag.desiredTrigger
      );
      const blocking = existing.triggers.find(
        (trigger) => trigger.name === tag.desiredBlockingTrigger
      );
      const next = {
        ...structuredClone(tag),
        firingTriggerId: firing ? [String(firing.triggerId)] : undefined,
        blockingTriggerId: blocking ? [String(blocking.triggerId)] : undefined
      };
      delete (next as Record<string, unknown>).desiredTrigger;
      delete (next as Record<string, unknown>).desiredBlockingTrigger;
      return next;
    });
    const googleTag = existing.tags.find(
      (tag) => tag.name === "[managed] Google Tag"
    ) as unknown as {
      parameter: Array<{
        key: string;
        list?: Array<{ map: Array<Record<string, string>> }>;
      }>;
    };
    const config = googleTag.parameter.find(
      (parameter) => parameter.key === "configSettingsTable"
    );
    if (config?.list?.[0]?.map) {
      config.list[0].map = config.list[0].map.map((entry) => ({
        value: entry.value,
        key: entry.key,
        type: entry.type
      }));
    }

    expect(inspectGtmDesiredDrift(existing, ga4)).toEqual([]);
  });

  it("detects same-name Google Tag configuration drift", () => {
    const existing = structuredClone(ga4);
    existing.triggers = existing.triggers.map((trigger, index) => ({
      ...trigger,
      triggerId: String(index + 1)
    }));
    existing.tags = existing.tags.map((tag) => {
      const next = structuredClone(tag) as typeof tag & {
        firingTriggerId?: string[];
        blockingTriggerId?: string[];
      };
      const firing = existing.triggers.find(
        (trigger) => trigger.name === tag.desiredTrigger
      );
      const blocking = existing.triggers.find(
        (trigger) => trigger.name === tag.desiredBlockingTrigger
      );
      next.firingTriggerId = firing ? [String(firing.triggerId)] : [];
      next.blockingTriggerId = blocking ? [String(blocking.triggerId)] : [];
      delete (next as Record<string, unknown>).desiredTrigger;
      delete (next as Record<string, unknown>).desiredBlockingTrigger;
      return next;
    });
    const googleTag = existing.tags.find(
      (tag) => tag.name === "[managed] Google Tag"
    ) as unknown as { parameter: Array<{ key: string; list?: Array<{ map: Array<{ key: string; value: string }> }> }> };
    const config = googleTag.parameter.find(
      (parameter) => parameter.key === "configSettingsTable"
    );
    const sendPageView = config?.list?.[0].map.find(
      (parameter) => parameter.key === "parameterValue"
    );
    if (sendPageView) sendPageView.value = "true";

    expect(inspectGtmDesiredDrift(existing, ga4)).toContainEqual({
      kind: "tag",
      name: "[managed] Google Tag",
      reason: "managed-resource-drift",
      differingKeys: ["parameter"]
    });
  });

  it("detects an unexpected blocking trigger on a managed tag", () => {
    const existing = structuredClone(ga4);
    existing.triggers = existing.triggers.map((trigger, index) => ({
      ...trigger,
      triggerId: String(index + 1)
    }));
    existing.tags = existing.tags.map((tag) => {
      const firing = existing.triggers.find(
        (trigger) => trigger.name === tag.desiredTrigger
      );
      const blocking = existing.triggers.find(
        (trigger) => trigger.name === tag.desiredBlockingTrigger
      );
      const next = {
        ...structuredClone(tag),
        firingTriggerId: firing ? [String(firing.triggerId)] : [],
        blockingTriggerId: blocking ? [String(blocking.triggerId)] : []
      };
      delete (next as Record<string, unknown>).desiredTrigger;
      delete (next as Record<string, unknown>).desiredBlockingTrigger;
      return next;
    });
    const googleTag = existing.tags.find(
      (tag) => tag.name === "[managed] Google Tag"
    );
    if (googleTag) googleTag.blockingTriggerId = ["999"];

    expect(inspectGtmDesiredDrift(existing, ga4)).toContainEqual({
      kind: "tag",
      name: "[managed] Google Tag",
      reason: "managed-resource-drift",
      differingKeys: ["blockingTriggerId"]
    });
  });

  it("leaves unrelated unknown tags untouched", () => {
    const result = inspectGtmProviderReconciliation(
      {
        variables: ga4.variables,
        triggers: ga4.triggers,
        tags: [
          ...ga4.tags,
          { name: "Owner custom conversion", type: "html", parameter: [] }
        ]
      },
      ga4,
      ["ga4"]
    );

    expect(result.conflicts).toEqual([]);
    expect(result.untouched).toContainEqual({
      kind: "tag",
      name: "Owner custom conversion"
    });
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
