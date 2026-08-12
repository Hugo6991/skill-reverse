export const ANALYTICS_PROVIDERS = Object.freeze([
  "ga4",
  "clarity",
  "mixpanel",
  "search-console"
]);

export const GTM_PROVIDERS = Object.freeze(["ga4", "clarity", "mixpanel"]);

const retryableStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);

export function parseProviders(args = []) {
  const options = args.filter((argument) => argument.startsWith("--providers"));
  if (options.length === 0) return [...ANALYTICS_PROVIDERS];
  if (options.length > 1) throw new Error("--providers may only be supplied once.");
  const [option] = options;
  if (!option.startsWith("--providers=")) {
    throw new Error(
      `Invalid provider option "${option}". Use --providers=${ANALYTICS_PROVIDERS.join(",")}.`
    );
  }
  const requested = option
    .slice("--providers=".length)
    .split(",")
    .map((provider) => provider.trim().toLowerCase())
    .filter(Boolean);
  if (requested.length === 0) throw new Error("--providers must include at least one provider.");
  const unknown = [...new Set(requested)].filter(
    (provider) => !ANALYTICS_PROVIDERS.includes(provider)
  );
  if (unknown.length > 0) {
    throw new Error(
      `Unknown analytics provider${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}. ` +
        `Use ${ANALYTICS_PROVIDERS.join(", ")}.`
    );
  }
  return canonicalProviders(requested);
}

export function selectedGtmProviders(providers) {
  const selected = new Set(providers);
  return GTM_PROVIDERS.filter((provider) => selected.has(provider));
}

export function partitionProvidersByPrerequisites(providers, prerequisites) {
  const runnable = [];
  const skipped = [];
  for (const provider of providers) {
    const missing = Array.isArray(prerequisites[provider])
      ? prerequisites[provider]
      : [];
    if (missing.length === 0) runnable.push(provider);
    else skipped.push({ provider, missing: [...missing] });
  }
  return { runnable, skipped };
}

export function invalidateWorkspaceApplyState(
  state,
  { checksum, providers, startedAt }
) {
  return {
    ...state,
    applyAttemptChecksum: checksum,
    applyAttemptProviders: canonicalProviders(providers),
    applyAttemptStartedAt: startedAt,
    appliedChecksum: "",
    appliedProviders: []
  };
}

export function createPendingWorkspaceState(
  state,
  { checksum, providers, google, recordedAt }
) {
  return {
    ...state,
    google: { ...(state?.google ?? {}), ...google },
    workspaceChecksum: checksum,
    workspaceProviders: canonicalProviders(providers),
    workspaceSavedAt: recordedAt,
    appliedChecksum: "",
    appliedProviders: []
  };
}

export function completePendingWorkspaceState(
  state,
  { checksum, providers, appliedAt }
) {
  const expectedProviders = canonicalProviders(providers);
  const pendingProviders = canonicalProviders(state?.workspaceProviders ?? []);
  if (
    state?.workspaceChecksum !== checksum ||
    pendingProviders.join(",") !== expectedProviders.join(",")
  ) {
    throw new Error(
      "Cannot complete analytics apply because the pending workspace does not match the manifest and provider selection."
    );
  }
  return {
    ...state,
    appliedChecksum: checksum,
    appliedProviders: expectedProviders,
    lastAppliedAt: appliedAt,
    applyAttemptChecksum: "",
    applyAttemptProviders: [],
    applyAttemptStartedAt: ""
  };
}

export function publishStateErrors(state, checksum, providers) {
  const errors = [];
  const requested = canonicalProviders(providers);
  const requestedGtm = selectedGtmProviders(requested);
  if (requestedGtm.length === 0) {
    errors.push("No GTM-backed provider was selected for publish.");
    return errors;
  }
  if (!state?.google?.gtmWorkspaceId) {
    errors.push("No managed GTM workspace is recorded. Run analytics:apply first.");
  }
  const rawWorkspaceProviders = Array.isArray(state?.workspaceProviders)
    ? state.workspaceProviders
    : [];
  const unknownWorkspaceProviders = rawWorkspaceProviders.filter(
    (provider) => !ANALYTICS_PROVIDERS.includes(provider)
  );
  const workspaceProviders = canonicalProviders(rawWorkspaceProviders);
  if (!state?.workspaceChecksum) {
    errors.push(
      "The recorded workspace has no manifest binding. Run analytics:apply again."
    );
  } else if (state.workspaceChecksum !== checksum) {
    errors.push(
      `The workspace binding ${state.workspaceChecksum} does not match the current manifest ${checksum}.`
    );
  }
  if (
    unknownWorkspaceProviders.length > 0 ||
    workspaceProviders.join(",") !== requested.join(",")
  ) {
    errors.push(
      `The workspace binding providers (${workspaceProviders.join(", ") || "none"}) do not match the requested providers (${requested.join(", ")}).`
    );
  }
  if (state?.applyAttemptChecksum) {
    errors.push(
      "An analytics apply attempt is incomplete; rerun apply successfully before publish."
    );
  }
  if (!state?.appliedChecksum) {
    if (!state?.applyAttemptChecksum) {
      errors.push(
        state?.workspaceChecksum
          ? "The recorded workspace is pending; all selected provider steps must succeed before publish."
          : "The recorded workspace predates complete apply state. Run analytics:apply again."
      );
    }
  } else if (state.appliedChecksum !== checksum) {
    errors.push(
      `The workspace checksum ${state.appliedChecksum} does not match the current manifest ${checksum}.`
    );
  }
  const rawApplied = Array.isArray(state?.appliedProviders) ? state.appliedProviders : [];
  const unknownApplied = rawApplied.filter(
    (provider) => !ANALYTICS_PROVIDERS.includes(provider)
  );
  const applied = canonicalProviders(rawApplied);
  if (unknownApplied.length > 0 || applied.join(",") !== requested.join(",")) {
    errors.push(
      `The workspace providers (${applied.join(", ") || "none"}) do not match the requested providers (${requested.join(", ")}).`
    );
  }
  return errors;
}

function canonicalProviders(providers) {
  const selected = new Set(providers);
  return ANALYTICS_PROVIDERS.filter((provider) => selected.has(provider));
}

export async function fetchWithSafeRetries(
  fetchImplementation,
  input,
  init = {},
  options = {}
) {
  const method = String(init.method ?? "GET").toUpperCase();
  const retryAllowed = method === "GET" || options.operation === "oauth-token";
  const requestedAttempts = Number(options.attempts ?? 3);
  const attempts = retryAllowed
    ? Math.min(
        5,
        Math.max(
          1,
          Math.floor(Number.isFinite(requestedAttempts) ? requestedAttempts : 3)
        )
      )
    : 1;
  const baseDelayMs = Math.max(0, Number(options.baseDelayMs ?? 200));
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImplementation(input, init);
      if (
        attempt === attempts ||
        !retryableStatuses.has(response.status)
      ) {
        return response;
      }
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !isRetryableNetworkError(error)) throw error;
    }
    await sleep(baseDelayMs * 2 ** (attempt - 1));
  }

  throw lastError ?? new Error("Retry loop ended without a response.");
}

function isRetryableNetworkError(error) {
  return error instanceof TypeError || error?.name === "AbortError";
}

export function buildDesiredState(config, plan, ids, providers = ANALYTICS_PROVIDERS) {
  const selected = new Set(providers);
  const hasGa4 = selected.has("ga4");
  const hasClarity = selected.has("clarity");
  const hasMixpanel = selected.has("mixpanel");
  const hasGtm = hasGa4 || hasClarity || hasMixpanel;
  const configuredEnhancedMeasurement = config.google?.enhancedMeasurement ?? {};
  const managed = (name) => `[managed] ${name}`;
  const common = Object.keys(plan.properties);
  const dlv = [
    ["event_name", "event_name"],
    ...common.map((property) => [property, property]),
    ["event_payload_base64", "event_payload_base64"]
  ];
  const variables = hasGtm
    ? [
        ...(hasGa4
          ? [constantVariable(managed("GA Measurement ID"), ids.gaMeasurementId)]
          : []),
        ...(hasClarity
          ? [constantVariable(managed("Clarity Project ID"), config.clarity.projectId)]
          : []),
        ...(hasMixpanel
          ? [
              constantVariable(managed("Mixpanel Project Token"), config.mixpanel.projectToken),
              constantVariable(
                managed("Mixpanel API Host"),
                mixpanelApiHost(config.mixpanel.region)
              )
            ]
          : []),
        constantVariable(managed("Production hostname"), config.site.hostnames[0]),
        constantVariable(managed("Debug mode"), "false"),
        constantVariable(managed("Route exclusion flag"), config.site.excludedPaths.join("|")),
        ...dlv.map(([name, pathName]) =>
          dataLayerVariable(managed(`DLV - ${name}`), pathName)
        )
      ]
    : [];

  const initTrigger = hasGtm
    ? {
        name: managed("Initialization - Production only"),
        type: "INITIALIZATION",
        filter: productionFilters(config.site.hostnames[0], config.site.excludedPaths)
      }
    : null;
  const productTrigger = hasGa4
    ? customEventTrigger(
        managed("Product Event"),
        "product_event",
        config.site.hostnames[0],
        config.site.excludedPaths
      )
    : null;
  const pageViewTrigger = hasGa4
    ? customEventTrigger(
        managed("Page View Event"),
        "product_event",
        config.site.hostnames[0],
        config.site.excludedPaths,
        { eventName: "page_view" }
      )
    : null;
  const clarityTrigger = hasClarity
    ? customEventTrigger(
        managed("Clarity Event"),
        "product_event",
        config.site.hostnames[0],
        config.site.excludedPaths
      )
    : null;
  const mixpanelTrigger = hasMixpanel
    ? customEventTrigger(
        managed("Mixpanel Event"),
        "product_event",
        config.site.hostnames[0],
        config.site.excludedPaths
      )
    : null;
  if (mixpanelTrigger) {
    mixpanelTrigger.filter.push(
      condition(
        "DOES_NOT_MATCH_REGEX",
        `{{${managed("DLV - event_name")}}}`,
        "^(research_queued|research_running|research_completed|research_failed|research_retried|report_published)$"
      )
    );
  }
  const excludeAdmin = hasGtm
    ? {
        name: managed("Exclude Admin"),
        type: "PAGEVIEW",
        filter: [condition("MATCH_REGEX", "{{Page Path}}", "^/(admin|api)(/|$)")]
      }
    : null;
  const previewDebug = hasGtm
    ? {
        name: managed("Preview / Debug"),
        type: "CUSTOM_EVENT",
        customEventFilter: [condition("EQUALS", "{{_event}}", "gtm.preview")]
      }
    : null;
  const triggers = [
    initTrigger,
    productTrigger,
    pageViewTrigger,
    clarityTrigger,
    mixpanelTrigger,
    excludeAdmin,
    previewDebug
  ].filter(Boolean);

  const gaParameters = common
    .filter((name) => name !== "occurred_at")
    .map((name) => mapParameter(name, `{{${managed(`DLV - ${name}`)}}}`));
  const tags = [
    ...(hasGa4
      ? [
          {
            name: managed("Google Tag"),
            type: "googtag",
            parameter: [
              templateParameter("tagId", `{{${managed("GA Measurement ID")}}}`),
              {
                type: "LIST",
                key: "configSettingsTable",
                list: [
                  {
                    type: "MAP",
                    map: [
                      templateParameter("parameter", "send_page_view"),
                      templateParameter(
                        "parameterValue",
                        config.google?.sendPageView === true ? "true" : "false"
                      )
                    ]
                  }
                ]
              }
            ],
            desiredTrigger: initTrigger.name
          },
          {
            name: managed("GA4 Product Event"),
            type: "gaawe",
            parameter: [
              templateParameter("eventName", `{{${managed("DLV - event_name")}}}`),
              templateParameter(
                "measurementIdOverride",
                `{{${managed("GA Measurement ID")}}}`
              ),
              { type: "LIST", key: "eventParameters", list: gaParameters }
            ],
            desiredTrigger: productTrigger.name,
            desiredBlockingTrigger: pageViewTrigger.name
          },
          {
            name: managed("GA4 Page View"),
            type: "gaawe",
            parameter: [
              templateParameter("eventName", "page_view"),
              templateParameter(
                "measurementIdOverride",
                `{{${managed("GA Measurement ID")}}}`
              ),
              { type: "LIST", key: "eventParameters", list: gaParameters }
            ],
            desiredTrigger: pageViewTrigger.name
          }
        ]
      : []),
    ...(hasClarity
      ? [
          {
            name: managed("Clarity Initialization"),
            type: "html",
            parameter: [
              templateParameter("html", clarityInitializationHtml(managed("Clarity Project ID")))
            ],
            desiredTrigger: initTrigger.name
          },
          {
            name: managed("Clarity Event / Custom Tags"),
            type: "html",
            parameter: [templateParameter("html", clarityEventHtml(managed))],
            desiredTrigger: clarityTrigger.name
          }
        ]
      : []),
    ...(hasMixpanel
      ? [
          {
            name: managed("Mixpanel Initialization"),
            type: "html",
            parameter: [
              templateParameter(
                "html",
                mixpanelInitializationHtml(
                  managed("Mixpanel Project Token"),
                  managed("Mixpanel API Host"),
                  config.mixpanel.persistence
                )
              )
            ],
            desiredTrigger: initTrigger.name
          },
          {
            name: managed("Mixpanel Product Event"),
            type: "html",
            parameter: [templateParameter("html", mixpanelEventHtml(managed))],
            desiredTrigger: mixpanelTrigger.name
          }
        ]
      : [])
  ];

  const customDimensions = hasGa4
    ? [
        "locale",
        "route_kind",
        "occupation_code",
        "research_stage",
        "report_type",
        "source_submission_type",
        "share_method",
        "error_code",
        "duration_bucket",
        "queue_duration_bucket"
      ].map((parameterName) => ({
        parameterName,
        displayName: parameterName,
        description: plan.properties[parameterName]?.description ?? parameterName,
        scope: "EVENT"
      }))
    : [];
  const keyEvents = hasGa4
    ? plan.events
        .filter((event) => event.keyEvent)
        .map((event) => ({ eventName: event.name, countingMethod: "ONCE_PER_EVENT" }))
    : [];
  const schemas = hasMixpanel
    ? plan.events.map((event) => ({
        eventName: event.name,
        description: event.description,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: Object.fromEntries(
            Object.entries(plan.properties).map(([name, property]) => [
              name,
              {
                type: property.type,
                description: property.enum
                  ? `${property.description} Allowed values: ${property.enum.join(", ")}.`
                  : property.description
              }
            ])
          )
        }
      }))
    : [];
  return {
    gtm: {
      folderName: "Skill Reverse / Managed",
      variables,
      triggers,
      tags,
      builtInVariables: hasGtm ? ["PAGE_HOSTNAME", "PAGE_PATH", "PAGE_URL"] : []
    },
    ga: {
      customDimensions,
      keyEvents,
      enhancedMeasurement: {
        streamEnabled: configuredEnhancedMeasurement.streamEnabled !== false,
        scrollsEnabled: configuredEnhancedMeasurement.scrollsEnabled !== false,
        outboundClicksEnabled:
          configuredEnhancedMeasurement.outboundClicksEnabled === true,
        fileDownloadsEnabled:
          configuredEnhancedMeasurement.fileDownloadsEnabled === true,
        pageChangesEnabled: configuredEnhancedMeasurement.pageChangesEnabled === true,
        siteSearchEnabled: configuredEnhancedMeasurement.siteSearchEnabled === true,
        formInteractionsEnabled:
          configuredEnhancedMeasurement.formInteractionsEnabled === true,
        videoEngagementEnabled:
          configuredEnhancedMeasurement.videoEngagementEnabled === true
      },
      retention: {
        eventDataRetention: "FOURTEEN_MONTHS",
        resetUserDataOnNewActivity: true
      },
      emailRedactionEnabled: true
    },
    mixpanel: { schemas },
    clarity: {
      projectId: hasClarity ? config.clarity.projectId : "",
      maskingMode: config.clarity.maskingMode,
      cookiesEnabled: config.clarity.cookiesEnabled,
      botDetection: config.clarity.botDetection
    }
  };
}

function constantVariable(name, value) {
  return { name, type: "c", parameter: [templateParameter("value", value)] };
}

function dataLayerVariable(name, value) {
  return {
    name,
    type: "v",
    parameter: [
      { type: "INTEGER", key: "dataLayerVersion", value: "2" },
      templateParameter("name", value)
    ]
  };
}

function customEventTrigger(name, transportEvent, hostname, excludedPaths, options = {}) {
  const filters = productionFilters(hostname, excludedPaths);
  if (options.eventName) {
    filters.push(condition("EQUALS", "{{[managed] DLV - event_name}}", options.eventName));
  }
  return {
    name,
    type: "CUSTOM_EVENT",
    customEventFilter: [condition("EQUALS", "{{_event}}", transportEvent)],
    filter: filters
  };
}

function productionFilters(hostname, excludedPaths) {
  const escapedPaths = excludedPaths.map((value) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  );
  return [
    condition("EQUALS", "{{Page Hostname}}", hostname),
    condition("DOES_NOT_MATCH_REGEX", "{{Page Path}}", `^(${escapedPaths.join("|")})(/|$)`)
  ];
}

function condition(type, left, right) {
  return {
    type,
    parameter: [
      { type: "TEMPLATE", key: "arg0", value: left },
      { type: "TEMPLATE", key: "arg1", value: right }
    ]
  };
}

function templateParameter(key, value) {
  return { type: "TEMPLATE", key, value: String(value ?? "") };
}

function mapParameter(name, value) {
  return {
    type: "MAP",
    map: [templateParameter("name", name), templateParameter("value", value)]
  };
}

function clarityInitializationHtml(projectVariable) {
  return `<script>(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};c[a]("consentv2",{ad_Storage:"denied",analytics_Storage:"granted"});t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y)})(window,document,"clarity","script","{{${projectVariable}}}");</script>`;
}

function clarityEventHtml(managed) {
  const value = (name) => `{{${managed(`DLV - ${name}`)}}}`;
  return `<script>(function(){if(typeof clarity!=="function")return;var n="${value("event_name")}";clarity("event",n);clarity("set","locale","${value("locale")}");clarity("set","route_kind","${value("route_kind")}");clarity("set","occupation_code","${value("occupation_code")}");clarity("set","research_stage","${value("research_stage")}");if(/^(research_started|research_failed|research_completed|share_completed)$/.test(n))clarity("upgrade",n);})();</script>`;
}

function mixpanelInitializationHtml(tokenVariable, hostVariable, persistence) {
  return `<script>(function(f,b){if(b.__SV)return;var e,g,i,h;window.mixpanel=b;b._i=[];b.init=function(e,f,c){function g(a,d){var b=d.split(".");2==b.length&&(a=a[b[0]],d=b[1]);a[d]=function(){a.push([d].concat(Array.prototype.slice.call(arguments,0)))}}var a=b;"undefined"!==typeof c?a=b[c]=[]:c="mixpanel";a.people=a.people||[];a.toString=function(a){var d="mixpanel";"mixpanel"!==c&&(d+="."+c);a||(d+=" (stub)");return d};a.people.toString=function(){return a.toString(1)+".people (stub)"};i="disable time_event track track_pageview track_links track_forms register register_once alias unregister identify name_tag set_config reset".split(" ");for(h=0;h<i.length;h++)g(a,i[h]);b._i.push([e,f,c])};b.__SV=1.2;e=f.createElement("script");e.type="text/javascript";e.async=!0;e.src="https://cdn.mxpnl.com/libs/mixpanel-2-latest.min.js";g=f.getElementsByTagName("script")[0];g.parentNode.insertBefore(e,g)})(document,window.mixpanel||[]);mixpanel.init("{{${tokenVariable}}}",{api_host:"{{${hostVariable}}}",persistence:"${persistence}",autocapture:false,track_pageview:false,record_sessions_percent:0});</script>`;
}

function mixpanelEventHtml(managed) {
  const name = `{{${managed("DLV - event_name")}}}`;
  const payload = `{{${managed("DLV - event_payload_base64")}}}`;
  return `<script>(function(){try{if(!window.mixpanel||!window.mixpanel.track)return;var json=decodeURIComponent(escape(atob("${payload}")));window.mixpanel.track("${name}",JSON.parse(json))}catch(e){}})();</script>`;
}

function mixpanelApiHost(region) {
  if (region === "EU") return "https://api-eu.mixpanel.com";
  if (region === "IN" || region === "India") return "https://api-in.mixpanel.com";
  return "https://api.mixpanel.com";
}
