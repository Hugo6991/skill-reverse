import { createHash, createSign, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stackPath = path.join(root, "analytics", "stack.json");
const eventsPath = path.join(root, "analytics", "events.json");
const statePath = path.join(root, "analytics", "state.json");
const backupDir = path.join(root, ".analytics-backups");
const localSecretDir = path.join(root, ".analytics-secrets");
const exportDir = path.join(root, "analytics", "export");
const command = process.argv[2] ?? "plan";
const supportedCommands = new Set(["plan", "apply", "publish", "verify", "export"]);

if (!supportedCommands.has(command)) {
  fail(`Unknown command "${command}". Use plan, apply, publish, verify, or export.`);
}

const [stack, trackingPlan, persistedState] = await Promise.all([
  readJson(stackPath),
  readJson(eventsPath),
  readJson(statePath)
]);
validateLocalConfig(stack, trackingPlan);

const state = structuredClone(persistedState);
const resolved = {
  gtmContainerId: stack.google.gtmContainerId || state.google.gtmContainerId,
  gtmPublicId: stack.google.gtmPublicId || state.google.gtmPublicId,
  gaPropertyId: normalizeResourceId(stack.google.gaPropertyId || state.google.gaPropertyId),
  gaWebStreamId: normalizeResourceId(stack.google.gaWebStreamId || state.google.gaWebStreamId),
  gaMeasurementId: stack.google.gaMeasurementId || state.google.gaMeasurementId
};
const checksum = createHash("sha256")
  .update(JSON.stringify({ stack, trackingPlan }))
  .digest("hex")
  .slice(0, 12);

let desired = buildDesiredState(stack, trackingPlan, resolved);
const prerequisites = getMissingPrerequisites(stack, resolved);

if (command === "plan") await plan();
if (command === "apply") await apply();
if (command === "publish") await publish();
if (command === "verify") await verify();
if (command === "export") await exportBundle();

async function plan() {
  heading("Analytics plan");
  printLocalSummary();
  if (prerequisites.google.length > 0) {
    note("Google remote plan skipped", prerequisites.google);
  } else {
    const google = await googleClient();
    const remote = await readGoogleState(google);
    printDiff("GTM variables", desired.gtm.variables, remote.gtm.variables);
    printDiff("GTM triggers", desired.gtm.triggers, remote.gtm.triggers);
    printDiff("GTM tags", desired.gtm.tags, remote.gtm.tags);
    printDiff(
      "GA4 custom dimensions",
      desired.ga.customDimensions,
      remote.ga.customDimensions,
      (item) => item.parameterName
    );
    printDiff(
      "GA4 key events",
      desired.ga.keyEvents,
      remote.ga.keyEvents,
      (item) => item.eventName
    );
  }

  if (prerequisites.mixpanel.length > 0) {
    note("Mixpanel remote plan skipped", prerequisites.mixpanel);
  } else {
    const schemas = await readMixpanelSchemas();
    printDiff(
      "Mixpanel Lexicon schemas",
      desired.mixpanel.schemas,
      schemas,
      (item) => item.eventName ?? item.name
    );
  }

  if (!stack.clarity.projectId) {
    note("Clarity remote check skipped", ["analytics/stack.json: clarity.projectId"]);
  } else {
    console.log(`  KEEP   Clarity project ${stack.clarity.projectId} (project settings remain manual)`);
  }
}

async function apply() {
  requirePrerequisites("Google", prerequisites.google);
  requirePrerequisites("Mixpanel", prerequisites.mixpanel);
  if (!stack.clarity.projectId) {
    fail("Clarity prerequisite is missing: clarity.projectId");
  }
  heading("Applying analytics desired state");
  const google = await googleClient();
  const [beforeGoogle, beforeMixpanel] = await Promise.all([
    readGoogleState(google, { allowMissing: true }),
    readMixpanelSchemas()
  ]);
  await saveSnapshot(
    "before-apply",
    sanitize({ google: beforeGoogle, mixpanelSchemas: beforeMixpanel })
  );

  const ga = await applyGa(google);
  resolved.gaPropertyId = ga.propertyId;
  resolved.gaWebStreamId = ga.streamId;
  resolved.gaMeasurementId = ga.measurementId;
  desired = buildDesiredState(stack, trackingPlan, resolved);
  const gtm = await applyGtm(google);
  await applyMixpanelSchemas();
  await submitSitemap(google);

  state.google = {
    ...state.google,
    gtmContainerId: gtm.containerId,
    gtmPublicId: gtm.publicId,
    gtmWorkspaceId: gtm.workspaceId,
    gaPropertyId: ga.propertyId,
    gaWebStreamId: ga.streamId,
    gaMeasurementId: ga.measurementId
  };
  state.lastAppliedAt = new Date().toISOString();
  await writeState();
  console.log("\nApply complete. GTM is not published; inspect the workspace, then run pnpm analytics:publish.");
}

async function publish() {
  requirePrerequisites("Google", prerequisites.google);
  if (!state.google.gtmWorkspaceId) {
    fail("No managed GTM workspace is recorded. Run pnpm analytics:apply first.");
  }
  heading("Publishing GTM version");
  const google = await googleClient();
  const workspacePath = gtmWorkspacePath(state.google.gtmWorkspaceId);
  const sync = await google.post(`https://tagmanager.googleapis.com/tagmanager/v2/${workspacePath}:sync`, {});
  if ((sync.mergeConflict ?? []).length > 0) {
    fail("GTM workspace has merge conflicts. Resolve them in GTM before publishing.");
  }
  const preview = await google.post(
    `https://tagmanager.googleapis.com/tagmanager/v2/${workspacePath}:quick_preview`,
    {}
  );
  if (preview.compilerError) {
    fail("GTM quick preview reported a compiler error; publish was stopped.");
  }

  const gitCommit = git("rev-parse", "--short=12", "HEAD") || "no-git-commit";
  const date = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const version = await google.post(
    `https://tagmanager.googleapis.com/tagmanager/v2/${workspacePath}:create_version`,
    {
      name: `[managed] ${date} ${gitCommit} ${checksum}`,
      notes: `Skill Reverse Analytics Stack as Code\ncommit=${gitCommit}\nmanifest=${checksum}`
    }
  );
  if ((version.compilerError ?? false) || !(version.containerVersion?.path)) {
    fail(`GTM rejected the container version: ${JSON.stringify(version.compilerError ?? version)}`);
  }
  await google.post(
    `https://tagmanager.googleapis.com/tagmanager/v2/${version.containerVersion.path}:publish`,
    {}
  );
  state.lastPublishedVersionPath = version.containerVersion.path;
  state.google.gtmWorkspaceId = "";
  await writeState();
  console.log(`Published ${version.containerVersion.path}`);
}

async function verify() {
  heading("Verifying analytics stack");
  printLocalSummary();
  const failures = [];
  const warnings = [];

  if (prerequisites.google.length === 0) {
    try {
      const google = await googleClient();
      const remote = await readGoogleState(google);
      verifyNames("GTM variables", desired.gtm.variables, remote.gtm.variables, failures);
      verifyNames("GTM triggers", desired.gtm.triggers, remote.gtm.triggers, failures);
      verifyNames("GTM tags", desired.gtm.tags, remote.gtm.tags, failures);
      verifyNames(
        "GA4 custom dimensions",
        desired.ga.customDimensions,
        remote.ga.customDimensions,
        failures,
        (item) => item.parameterName
      );
      verifyNames(
        "GA4 key events",
        desired.ga.keyEvents,
        remote.ga.keyEvents,
        failures,
        (item) => item.eventName
      );
      if (!state.lastPublishedVersionPath) {
        warnings.push("No GTM version has been published by this automation yet.");
      }
      await verifySearchConsole(google, warnings);
      await sendSyntheticGaEvent(warnings);
    } catch (error) {
      failures.push(`Google verification failed: ${errorMessage(error)}`);
    }
  } else {
    warnings.push(`Google live verification skipped: ${prerequisites.google.join(", ")}`);
  }

  if (prerequisites.mixpanel.length === 0) {
    try {
      const schemas = await readMixpanelSchemas();
      verifyNames(
        "Mixpanel schemas",
        desired.mixpanel.schemas,
        schemas,
        failures,
        (item) => item.eventName ?? item.name
      );
      await sendSyntheticMixpanelEvent();
    } catch (error) {
      failures.push(`Mixpanel verification failed: ${errorMessage(error)}`);
    }
  } else {
    warnings.push(`Mixpanel live verification skipped: ${prerequisites.mixpanel.join(", ")}`);
  }
  if (process.env.CLARITY_EXPORT_TOKEN) {
    try {
      const clarity = await readClarityExport();
      bundle.remoteState.clarityInsights = sanitize(clarity);
    } catch (error) {
      bundle.remoteState.clarityError = errorMessage(error);
    }
  }

  await verifyProductionShell(failures, warnings);
  warnings.forEach((message) => console.warn(`  WARN   ${message}`));
  failures.forEach((message) => console.error(`  FAIL   ${message}`));
  if (failures.length > 0) process.exitCode = 1;
  else console.log("\nVerification passed.");
}

async function exportBundle() {
  heading("Exporting sanitized analytics bundle");
  const bundle = {
    exportedAt: new Date().toISOString(),
    manifestChecksum: checksum,
    stack,
    trackingPlan,
    state: sanitize(state),
    desiredState: desired,
    remoteState: {}
  };

  if (prerequisites.google.length === 0) {
    try {
      const google = await googleClient();
      bundle.remoteState.google = sanitize(await readGoogleState(google, { allowMissing: true }));
      if (state.lastPublishedVersionPath) {
        bundle.remoteState.gtmPublishedVersion = sanitize(
          await google.get(
            `https://tagmanager.googleapis.com/tagmanager/v2/${state.lastPublishedVersionPath}`
          )
        );
      }
    } catch (error) {
      bundle.remoteState.googleError = errorMessage(error);
    }
  }
  if (prerequisites.mixpanel.length === 0) {
    try {
      bundle.remoteState.mixpanelSchemas = sanitize(await readMixpanelSchemas());
    } catch (error) {
      bundle.remoteState.mixpanelError = errorMessage(error);
    }
  }

  await mkdir(exportDir, { recursive: true });
  const output = path.join(exportDir, `analytics-bundle-${checksum}.json`);
  await writeFile(output, `${JSON.stringify(bundle, null, 2)}\n`, { mode: 0o600 });
  console.log(`Wrote ${path.relative(root, output)} (secrets removed).`);
}

function buildDesiredState(config, plan, ids) {
  const managed = (name) => `[managed] ${name}`;
  const common = Object.keys(plan.properties);
  const dlv = [
    ["event_name", "event_name"],
    ...common.map((property) => [property, property]),
    ["event_payload_base64", "event_payload_base64"]
  ];
  const variables = [
    constantVariable(managed("GA Measurement ID"), ids.gaMeasurementId),
    constantVariable(managed("Clarity Project ID"), config.clarity.projectId),
    constantVariable(managed("Mixpanel Project Token"), config.mixpanel.projectToken),
    constantVariable(managed("Mixpanel API Host"), mixpanelApiHost(config.mixpanel.region)),
    constantVariable(managed("Production hostname"), config.site.hostnames[0]),
    constantVariable(managed("Debug mode"), "false"),
    constantVariable(managed("Route exclusion flag"), config.site.excludedPaths.join("|")),
    ...dlv.map(([name, pathName]) => dataLayerVariable(managed(`DLV - ${name}`), pathName))
  ];

  const productTrigger = customEventTrigger(
    managed("Product Event"),
    "product_event",
    config.site.hostnames[0],
    config.site.excludedPaths
  );
  const pageViewTrigger = customEventTrigger(
    managed("Page View Event"),
    "product_event",
    config.site.hostnames[0],
    config.site.excludedPaths,
    { eventName: "page_view" }
  );
  const clarityTrigger = customEventTrigger(
    managed("Clarity Event"),
    "product_event",
    config.site.hostnames[0],
    config.site.excludedPaths
  );
  const mixpanelTrigger = customEventTrigger(
    managed("Mixpanel Event"),
    "product_event",
    config.site.hostnames[0],
    config.site.excludedPaths
  );
  mixpanelTrigger.filter.push(
    condition(
      "DOES_NOT_MATCH_REGEX",
      `{{${managed("DLV - event_name")}}}`,
      "^(research_queued|research_running|research_completed|research_failed|research_retried|report_published)$"
    )
  );
  const initTrigger = {
    name: managed("Initialization - Production only"),
    type: "INITIALIZATION",
    filter: productionFilters(config.site.hostnames[0], config.site.excludedPaths)
  };
  const excludeAdmin = {
    name: managed("Exclude Admin"),
    type: "PAGEVIEW",
    filter: [
      condition("MATCH_REGEX", "{{Page Path}}", "^/(admin|api)(/|$)")
    ]
  };
  const previewDebug = {
    name: managed("Preview / Debug"),
    type: "CUSTOM_EVENT",
    customEventFilter: [condition("EQUALS", "{{_event}}", "gtm.preview")]
  };
  const triggers = [
    initTrigger,
    productTrigger,
    pageViewTrigger,
    clarityTrigger,
    mixpanelTrigger,
    excludeAdmin,
    previewDebug
  ];

  const gaParameters = common
    .filter((name) => name !== "occurred_at")
    .map((name) => mapParameter(name, `{{${managed(`DLV - ${name}`)}}}`));
  const tags = [
    {
      name: managed("Google Tag"),
      type: "googtag",
      parameter: [templateParameter("tagId", `{{${managed("GA Measurement ID")}}}`)],
      desiredTrigger: initTrigger.name
    },
    {
      name: managed("GA4 Product Event"),
      type: "gaawe",
      parameter: [
        templateParameter("eventName", `{{${managed("DLV - event_name")}}}`),
        templateParameter("measurementIdOverride", `{{${managed("GA Measurement ID")}}}`),
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
        templateParameter("measurementIdOverride", `{{${managed("GA Measurement ID")}}}`),
        { type: "LIST", key: "eventParameters", list: gaParameters }
      ],
      desiredTrigger: pageViewTrigger.name
    },
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
    },
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
  ];

  const customDimensions = [
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
  }));
  const keyEvents = plan.events
    .filter((event) => event.keyEvent)
    .map((event) => ({ eventName: event.name, countingMethod: "ONCE_PER_EVENT" }));
  const schemas = plan.events.map((event) => ({
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
  }));
  return {
    gtm: {
      folderName: "Skill Reverse / Managed",
      variables,
      triggers,
      tags,
      builtInVariables: ["PAGE_HOSTNAME", "PAGE_PATH", "PAGE_URL"]
    },
    ga: {
      customDimensions,
      keyEvents,
      enhancedMeasurement: {
        streamEnabled: true,
        scrollsEnabled: true,
        outboundClicksEnabled: true,
        fileDownloadsEnabled: true,
        pageChangesEnabled: false,
        siteSearchEnabled: false,
        formInteractionsEnabled: false,
        videoEngagementEnabled: false
      },
      retention: {
        eventDataRetention: "FOURTEEN_MONTHS",
        resetUserDataOnNewActivity: true
      },
      emailRedactionEnabled: true
    },
    mixpanel: { schemas },
    clarity: {
      projectId: config.clarity.projectId,
      maskingMode: config.clarity.maskingMode,
      cookiesEnabled: config.clarity.cookiesEnabled,
      botDetection: config.clarity.botDetection
    }
  };
}

async function applyGtm(google) {
  const accountId = stack.google.gtmAccountId;
  let containerId = resolved.gtmContainerId;
  let container;
  if (containerId) {
    container = await google.get(
      `https://tagmanager.googleapis.com/tagmanager/v2/accounts/${accountId}/containers/${containerId}`
    );
  } else {
    container = await google.post(
      `https://tagmanager.googleapis.com/tagmanager/v2/accounts/${accountId}/containers`,
      {
        name: stack.site.name,
        usageContext: ["WEB"],
        domainName: stack.site.hostnames
      }
    );
    containerId = container.containerId;
  }
  const containerPath = `accounts/${accountId}/containers/${containerId}`;
  const workspaceName = `[managed] Analytics Stack ${checksum}`;
  const workspaces = await paginatedGoogle(
    google,
    `https://tagmanager.googleapis.com/tagmanager/v2/${containerPath}/workspaces`,
    "workspace"
  );
  let workspace = workspaces.find((item) => item.name === workspaceName);
  if (!workspace) {
    workspace = await google.post(
      `https://tagmanager.googleapis.com/tagmanager/v2/${containerPath}/workspaces`,
      {
        name: workspaceName,
        description: `Managed from analytics manifests. checksum=${checksum}`
      }
    );
  }
  const workspacePath = workspace.path;

  await enableBuiltInVariables(google, workspacePath, desired.gtm.builtInVariables);
  const folders = await paginatedGoogle(
    google,
    `https://tagmanager.googleapis.com/tagmanager/v2/${workspacePath}/folders`,
    "folder"
  );
  let folder = folders.find((item) => item.name === desired.gtm.folderName);
  if (!folder) {
    folder = await google.post(
      `https://tagmanager.googleapis.com/tagmanager/v2/${workspacePath}/folders`,
      { name: desired.gtm.folderName, notes: "Managed by scripts/analytics.mjs" }
    );
  }

  const variables = await reconcileCollection(
    google,
    workspacePath,
    "variables",
    "variable",
    desired.gtm.variables.map((item) => ({ ...item, parentFolderId: folder.folderId }))
  );
  const triggers = await reconcileCollection(
    google,
    workspacePath,
    "triggers",
    "trigger",
    desired.gtm.triggers.map((item) => ({ ...item, parentFolderId: folder.folderId }))
  );
  const triggerIds = new Map(triggers.map((item) => [item.name, item.triggerId]));
  const tags = desired.gtm.tags.map((item) => {
    const next = { ...item, parentFolderId: folder.folderId };
    next.firingTriggerId = [triggerIds.get(item.desiredTrigger)].filter(Boolean);
    next.blockingTriggerId = [triggerIds.get(item.desiredBlockingTrigger)].filter(Boolean);
    delete next.desiredTrigger;
    delete next.desiredBlockingTrigger;
    return next;
  });
  await reconcileCollection(google, workspacePath, "tags", "tag", tags);
  console.log(`  READY  GTM workspace ${workspace.name}`);
  return {
    containerId,
    publicId: container.publicId ?? "",
    workspaceId: workspace.workspaceId,
    variables
  };
}

async function applyGa(google) {
  let propertyId = resolved.gaPropertyId;
  let property;
  if (!propertyId) {
    property = await google.post("https://analyticsadmin.googleapis.com/v1beta/properties", {
      parent: `accounts/${stack.google.gaAccountId}`,
      displayName: stack.site.name,
      timeZone: stack.site.timezone,
      currencyCode: stack.site.currency,
      industryCategory: "OTHER"
    });
    propertyId = normalizeResourceId(property.name);
  } else {
    property = await google.patch(
      `https://analyticsadmin.googleapis.com/v1beta/properties/${propertyId}?updateMask=timeZone,currencyCode,displayName`,
      {
        name: `properties/${propertyId}`,
        displayName: stack.site.name,
        timeZone: stack.site.timezone,
        currencyCode: stack.site.currency
      }
    );
  }
  const propertyName = `properties/${propertyId}`;
  let streams = await paginatedGoogle(
    google,
    `https://analyticsadmin.googleapis.com/v1beta/${propertyName}/dataStreams`,
    "dataStreams"
  );
  let stream = streams.find(
    (item) =>
      item.type === "WEB_DATA_STREAM" &&
      stack.site.hostnames.includes(new URL(item.webStreamData.defaultUri).hostname)
  );
  if (!stream) {
    stream = await google.post(
      `https://analyticsadmin.googleapis.com/v1beta/${propertyName}/dataStreams`,
      {
        type: "WEB_DATA_STREAM",
        displayName: stack.site.name,
        webStreamData: { defaultUri: stack.site.productionUrl }
      }
    );
  }
  const streamId = normalizeResourceId(stream.name);
  const measurementId = stream.webStreamData.measurementId;

  const dimensions = await paginatedGoogle(
    google,
    `https://analyticsadmin.googleapis.com/v1beta/${propertyName}/customDimensions`,
    "customDimensions"
  );
  for (const dimension of desired.ga.customDimensions) {
    const existing = dimensions.find((item) => item.parameterName === dimension.parameterName);
    if (!existing) {
      await google.post(
        `https://analyticsadmin.googleapis.com/v1beta/${propertyName}/customDimensions`,
        dimension
      );
      console.log(`  CREATE GA4 dimension ${dimension.parameterName}`);
    } else {
      console.log(`  KEEP   GA4 dimension ${dimension.parameterName}`);
    }
  }
  const keyEvents = await paginatedGoogle(
    google,
    `https://analyticsadmin.googleapis.com/v1beta/${propertyName}/keyEvents`,
    "keyEvents"
  );
  for (const keyEvent of desired.ga.keyEvents) {
    if (!keyEvents.some((item) => item.eventName === keyEvent.eventName)) {
      await google.post(
        `https://analyticsadmin.googleapis.com/v1beta/${propertyName}/keyEvents`,
        keyEvent
      );
      console.log(`  CREATE GA4 key event ${keyEvent.eventName}`);
    } else {
      console.log(`  KEEP   GA4 key event ${keyEvent.eventName}`);
    }
  }

  const streamName = `${propertyName}/dataStreams/${streamId}`;
  await google.patch(
    `https://analyticsadmin.googleapis.com/v1alpha/${streamName}/enhancedMeasurementSettings?updateMask=streamEnabled,scrollsEnabled,outboundClicksEnabled,fileDownloadsEnabled,pageChangesEnabled,siteSearchEnabled,formInteractionsEnabled,videoEngagementEnabled`,
    { name: `${streamName}/enhancedMeasurementSettings`, ...desired.ga.enhancedMeasurement }
  );
  await google.patch(
    `https://analyticsadmin.googleapis.com/v1alpha/${propertyName}/dataRetentionSettings?updateMask=eventDataRetention,resetUserDataOnNewActivity`,
    { name: `${propertyName}/dataRetentionSettings`, ...desired.ga.retention }
  );
  try {
    await google.patch(
      `https://analyticsadmin.googleapis.com/v1alpha/${streamName}/dataRedactionSettings?updateMask=emailRedactionEnabled`,
      {
        name: `${streamName}/dataRedactionSettings`,
        emailRedactionEnabled: desired.ga.emailRedactionEnabled
      }
    );
  } catch (error) {
    console.warn(`  WARN   GA4 email redaction setting was not updated: ${errorMessage(error)}`);
  }
  const protocolSecrets = await paginatedGoogle(
    google,
    `https://analyticsadmin.googleapis.com/v1beta/${streamName}/measurementProtocolSecrets`,
    "measurementProtocolSecrets"
  );
  const protocolDisplayName = "[managed] Analytics Stack";
  let protocolSecret = protocolSecrets.find(
    (item) => item.displayName === protocolDisplayName
  );
  if (!protocolSecret) {
    protocolSecret = await google.post(
      `https://analyticsadmin.googleapis.com/v1beta/${streamName}/measurementProtocolSecrets`,
      { displayName: protocolDisplayName }
    );
    if (protocolSecret.secretValue) {
      await mkdir(localSecretDir, { recursive: true });
      await writeFile(
        path.join(localSecretDir, "ga-measurement-protocol-secret"),
        `${protocolSecret.secretValue}\n`,
        { mode: 0o600 }
      );
      console.log("  CREATE GA4 Measurement Protocol secret (saved to ignored local secret file)");
    }
  } else {
    console.log("  KEEP   GA4 Measurement Protocol secret");
  }
  state.google.gaMeasurementProtocolSecretName = protocolSecret.name ?? "";
  console.log(`  READY  GA4 property ${propertyId}, stream ${streamId}, ${measurementId}`);
  return { propertyId, streamId, measurementId };
}

async function applyMixpanelSchemas() {
  for (const schema of desired.mixpanel.schemas) {
    const response = await fetch(
      `${mixpanelManagementHost(stack.mixpanel.region)}/api/app/projects/${encodeURIComponent(stack.mixpanel.projectId)}/schemas/event/${encodeURIComponent(schema.eventName)}`,
      {
        method: "POST",
        headers: {
          authorization: `Basic ${basicAuth()}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          description: schema.description,
          properties: schema.schema.properties,
          metadata: {
            "com.mixpanel": {
              "$source": "skill-reverse-analytics-as-code",
              "displayName": schema.eventName
            }
          }
        })
      }
    );
    if (!response.ok) throw await httpError("Mixpanel schema", response);
    console.log(`  UPSERT Mixpanel schema ${schema.eventName}`);
  }
}

async function submitSitemap(google) {
  const siteUrl = stack.google.searchConsoleSiteUrl;
  if (!siteUrl) return;
  const sitemap = `${stack.site.productionUrl}/sitemap.xml`;
  const response = await google.raw(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/sitemaps/${encodeURIComponent(sitemap)}`,
    { method: "PUT" }
  );
  if (!response.ok) throw await httpError("Search Console sitemap submission", response);
  console.log(`  SUBMIT Search Console sitemap ${sitemap}`);
}

async function readGoogleState(google, { allowMissing = false } = {}) {
  const result = {
    gtm: { variables: [], triggers: [], tags: [], folders: [], versions: [] },
    ga: { customDimensions: [], keyEvents: [], property: null, stream: null }
  };
  if (stack.google.gtmAccountId && resolved.gtmContainerId) {
    const workspaces = await paginatedGoogle(
      google,
      `https://tagmanager.googleapis.com/tagmanager/v2/accounts/${stack.google.gtmAccountId}/containers/${resolved.gtmContainerId}/workspaces`,
      "workspace"
    );
    const workspace =
      workspaces.find((item) => item.workspaceId === state.google.gtmWorkspaceId) ??
      workspaces.find((item) => item.name?.startsWith("[managed] Analytics Stack"));
    if (workspace) {
      const workspacePath = gtmWorkspacePath(workspace.workspaceId);
      const [variables, triggers, tags, folders] = await Promise.all([
        paginatedGoogle(google, `https://tagmanager.googleapis.com/tagmanager/v2/${workspacePath}/variables`, "variable"),
        paginatedGoogle(google, `https://tagmanager.googleapis.com/tagmanager/v2/${workspacePath}/triggers`, "trigger"),
        paginatedGoogle(google, `https://tagmanager.googleapis.com/tagmanager/v2/${workspacePath}/tags`, "tag"),
        paginatedGoogle(google, `https://tagmanager.googleapis.com/tagmanager/v2/${workspacePath}/folders`, "folder")
      ]);
      result.gtm = { ...result.gtm, variables, triggers, tags, folders };
    } else if (state.lastPublishedVersionPath) {
      const version = await google.get(
        `https://tagmanager.googleapis.com/tagmanager/v2/${state.lastPublishedVersionPath}`
      );
      result.gtm = {
        ...result.gtm,
        variables: version.variable ?? [],
        triggers: version.trigger ?? [],
        tags: version.tag ?? [],
        folders: version.folder ?? [],
        versions: [version]
      };
    } else if (!allowMissing) {
      console.warn("  WARN   No managed GTM workspace exists yet.");
    }
  }
  if (resolved.gaPropertyId) {
    const propertyName = `properties/${resolved.gaPropertyId}`;
    const [property, dimensions, keyEvents, streams] = await Promise.all([
      google.get(`https://analyticsadmin.googleapis.com/v1beta/${propertyName}`),
      paginatedGoogle(
        google,
        `https://analyticsadmin.googleapis.com/v1beta/${propertyName}/customDimensions`,
        "customDimensions"
      ),
      paginatedGoogle(
        google,
        `https://analyticsadmin.googleapis.com/v1beta/${propertyName}/keyEvents`,
        "keyEvents"
      ),
      paginatedGoogle(
        google,
        `https://analyticsadmin.googleapis.com/v1beta/${propertyName}/dataStreams`,
        "dataStreams"
      )
    ]);
    result.ga = {
      property,
      customDimensions: dimensions,
      keyEvents,
      stream: streams.find((item) => normalizeResourceId(item.name) === resolved.gaWebStreamId)
    };
  }
  return result;
}

async function readMixpanelSchemas() {
  const response = await fetch(
    `${mixpanelManagementHost(stack.mixpanel.region)}/api/app/projects/${encodeURIComponent(stack.mixpanel.projectId)}/schemas`,
    { headers: { authorization: `Basic ${basicAuth()}` } }
  );
  if (!response.ok) throw await httpError("Mixpanel schemas", response);
  const body = await response.json();
  const entries = body.results ?? body.schemas ?? body;
  return (Array.isArray(entries) ? entries : []).map((entry) => ({
    eventName: entry.eventName ?? entry.name,
    description: entry.description ?? entry.schemaJson?.description,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: entry.schema?.properties ?? entry.schemaJson?.properties ?? {}
    }
  }));
}

async function readClarityExport() {
  const response = await fetch(
    "https://www.clarity.ms/export-data/api/v1/project-live-insights?numOfDays=1&dimension1=URL",
    {
      headers: {
        authorization: `Bearer ${process.env.CLARITY_EXPORT_TOKEN}`,
        accept: "application/json"
      }
    }
  );
  if (!response.ok) throw await httpError("Clarity Data Export", response);
  return response.json();
}

async function sendSyntheticMixpanelEvent() {
  const eventId = randomUUID();
  const response = await fetch(`${mixpanelApiHost(stack.mixpanel.region)}/track?strict=1`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify([
      {
        event: "analytics_verification",
        properties: {
          token: stack.mixpanel.projectToken,
          distinct_id: "analytics-stack-verifier",
          $insert_id: eventId,
          event_id: eventId,
          occurred_at: new Date().toISOString(),
          source: "scripts/analytics.mjs"
        }
      }
    ])
  });
  if (!response.ok) throw await httpError("Mixpanel synthetic event", response);
  console.log(`  SENT   Mixpanel synthetic event ${eventId}`);
}

async function sendSyntheticGaEvent(warnings) {
  if (!resolved.gaMeasurementId) {
    warnings.push("GA4 synthetic event skipped because gaMeasurementId is blank.");
    return;
  }
  let secret = process.env.GA_MEASUREMENT_PROTOCOL_SECRET?.trim();
  if (!secret) {
    secret = await readFile(
      path.join(localSecretDir, "ga-measurement-protocol-secret"),
      "utf8"
    )
      .then((value) => value.trim())
      .catch(() => "");
  }
  if (!secret) {
    warnings.push(
      "GA4 synthetic event skipped because the local Measurement Protocol secret is unavailable."
    );
    return;
  }
  const eventId = randomUUID();
  const query = new URLSearchParams({
    measurement_id: resolved.gaMeasurementId,
    api_secret: secret
  });
  const payload = {
    client_id: "analytics-stack-verifier",
    events: [
      {
        name: "analytics_verification",
        params: {
          event_id: eventId,
          occurred_at: new Date().toISOString(),
          engagement_time_msec: 1
        }
      }
    ]
  };
  const debug = await fetch(
    `https://www.google-analytics.com/debug/mp/collect?${query}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    }
  );
  if (!debug.ok) throw await httpError("GA4 Measurement Protocol validation", debug);
  const validation = await debug.json();
  if ((validation.validationMessages ?? []).length > 0) {
    warnings.push("GA4 Measurement Protocol validation returned warnings.");
    return;
  }
  const collect = await fetch(`https://www.google-analytics.com/mp/collect?${query}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!collect.ok) throw await httpError("GA4 synthetic event", collect);
  console.log(`  SENT   GA4 synthetic event ${eventId}`);
}

async function verifySearchConsole(google, warnings) {
  if (!stack.google.searchConsoleSiteUrl) return;
  const response = await google.raw(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(stack.google.searchConsoleSiteUrl)}`
  );
  if (!response.ok) {
    warnings.push(`Search Console property is not accessible (${response.status}).`);
    return;
  }
  const inspect = await google.raw(
    "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        inspectionUrl: stack.site.productionUrl,
        siteUrl: stack.google.searchConsoleSiteUrl,
        languageCode: "zh-TW"
      })
    }
  );
  if (!inspect.ok) {
    warnings.push(`Search Console URL Inspection failed (${inspect.status}).`);
  } else {
    const body = await inspect.json();
    const verdict = body.inspectionResult?.indexStatusResult?.verdict ?? "UNKNOWN";
    console.log(`  OK     Search Console URL Inspection: ${verdict}`);
  }
}

async function verifyProductionShell(failures, warnings) {
  try {
    const response = await fetch(stack.site.productionUrl, {
      headers: { "user-agent": "Skill-Reverse-Analytics-Verifier/1.0" }
    });
    const html = await response.text();
    if (!response.ok) failures.push(`Production homepage returned ${response.status}.`);
    if (/noindex/i.test(html)) failures.push("Production homepage still contains noindex.");
    if (resolved.gtmPublicId && !html.includes(resolved.gtmPublicId)) {
      failures.push(`Production HTML does not contain GTM public ID ${resolved.gtmPublicId}.`);
    }
    if (!resolved.gtmPublicId) {
      warnings.push("GTM public ID is blank, so production GTM installation could not be checked.");
    }
    if (stack.clarity.projectId) {
      warnings.push("Clarity collect delivery requires a browser session; use GTM Preview once after publish.");
    }
  } catch (error) {
    warnings.push(`Production HTML check skipped: ${errorMessage(error)}`);
  }
}

async function enableBuiltInVariables(google, workspacePath, variableTypes) {
  const url = new URL(
    `https://tagmanager.googleapis.com/tagmanager/v2/${workspacePath}/built_in_variables`
  );
  variableTypes.forEach((type) => url.searchParams.append("type", type));
  const response = await google.raw(
    url.toString(),
    {
      method: "POST"
    }
  );
  if (!response.ok && response.status !== 409) {
    throw await httpError("GTM built-in variables", response);
  }
}

async function reconcileCollection(google, workspacePath, plural, responseKey, desiredItems) {
  const base = `https://tagmanager.googleapis.com/tagmanager/v2/${workspacePath}/${plural}`;
  const existing = await paginatedGoogle(google, base, responseKey);
  const result = [];
  for (const desiredItem of desiredItems) {
    const current = existing.find((item) => item.name === desiredItem.name);
    if (!current) {
      const created = await google.post(base, desiredItem);
      console.log(`  CREATE GTM ${responseKey} ${desiredItem.name}`);
      result.push(created);
      continue;
    }
    const comparableCurrent = sanitizeResource(current);
    const comparableDesired = sanitizeResource({ ...current, ...desiredItem });
    if (stableJson(comparableCurrent) === stableJson(comparableDesired)) {
      console.log(`  KEEP   GTM ${responseKey} ${desiredItem.name}`);
      result.push(current);
      continue;
    }
    const updated = await google.put(
      `https://tagmanager.googleapis.com/tagmanager/v2/${current.path}`,
      { ...desiredItem, fingerprint: current.fingerprint }
    );
    console.log(`  UPDATE GTM ${responseKey} ${desiredItem.name}`);
    result.push(updated);
  }
  return result;
}

async function googleClient() {
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credentialsPath) fail("GOOGLE_APPLICATION_CREDENTIALS is required for Google API calls.");
  const credentials = await readJson(path.resolve(credentialsPath));
  if (!credentials.client_email || !credentials.private_key) {
    fail("Google credentials file must contain client_email and private_key.");
  }
  const token = await serviceAccountAccessToken(credentials);
  const raw = (url, init = {}) =>
    fetch(url, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.headers ?? {})
      }
    });
  const jsonRequest = async (url, init = {}) => {
    const response = await raw(url, init);
    if (!response.ok) throw await httpError("Google API", response);
    if (response.status === 204) return {};
    return response.json();
  };
  return {
    raw,
    get: (url) => jsonRequest(url),
    post: (url, body) =>
      jsonRequest(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      }),
    put: (url, body) =>
      jsonRequest(url, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      }),
    patch: (url, body) =>
      jsonRequest(url, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      })
  };
}

async function serviceAccountAccessToken(credentials) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      iss: credentials.client_email,
      scope: [
        "https://www.googleapis.com/auth/tagmanager.edit.containers",
        "https://www.googleapis.com/auth/tagmanager.edit.containerversions",
        "https://www.googleapis.com/auth/tagmanager.publish",
        "https://www.googleapis.com/auth/analytics.edit",
        "https://www.googleapis.com/auth/analytics.readonly",
        "https://www.googleapis.com/auth/webmasters"
      ].join(" "),
      aud: credentials.token_uri ?? "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600
    })
  );
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  const assertion = `${unsigned}.${base64Url(signer.sign(credentials.private_key))}`;
  const response = await fetch(credentials.token_uri ?? "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  if (!response.ok) throw await httpError("Google OAuth", response);
  const body = await response.json();
  return body.access_token;
}

async function paginatedGoogle(google, url, key) {
  const result = [];
  let pageToken = "";
  do {
    const nextUrl = new URL(url);
    if (pageToken) nextUrl.searchParams.set("pageToken", pageToken);
    const page = await google.get(nextUrl.toString());
    const items = page[key] ?? [];
    result.push(...(Array.isArray(items) ? items : []));
    pageToken = page.nextPageToken ?? "";
  } while (pageToken);
  return result;
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
    filters.push(
      condition("EQUALS", `{{[managed] DLV - event_name}}`, options.eventName)
    );
  }
  return {
    name,
    type: "CUSTOM_EVENT",
    customEventFilter: [condition("EQUALS", "{{_event}}", transportEvent)],
    filter: filters
  };
}

function productionFilters(hostname, excludedPaths) {
  const escapedPaths = excludedPaths.map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return [
    condition("EQUALS", "{{Page Hostname}}", hostname),
    condition(
      "DOES_NOT_MATCH_REGEX",
      "{{Page Path}}",
      `^(${escapedPaths.join("|")})(/|$)`
    )
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
    map: [
      templateParameter("name", name),
      templateParameter("value", value)
    ]
  };
}

function clarityInitializationHtml(projectVariable) {
  return `<script>(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);try{var k="skill-reverse:clarity-id",v=localStorage.getItem(k);if(!v){v=crypto.randomUUID();localStorage.setItem(k,v)}c[a]("identify",v)}catch(e){}})(window,document,"clarity","script","{{${projectVariable}}}");</script>`;
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

function getMissingPrerequisites(config, ids) {
  const google = [];
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) google.push("GOOGLE_APPLICATION_CREDENTIALS");
  if (!config.google.gtmAccountId) google.push("google.gtmAccountId");
  if (!config.google.gaAccountId && !ids.gaPropertyId) google.push("google.gaAccountId");
  const mixpanel = [];
  if (!config.mixpanel.projectId) mixpanel.push("mixpanel.projectId");
  if (!config.mixpanel.projectToken) mixpanel.push("mixpanel.projectToken");
  if (!process.env.MIXPANEL_SERVICE_ACCOUNT_USERNAME) {
    mixpanel.push("MIXPANEL_SERVICE_ACCOUNT_USERNAME");
  }
  if (!process.env.MIXPANEL_SERVICE_ACCOUNT_SECRET) {
    mixpanel.push("MIXPANEL_SERVICE_ACCOUNT_SECRET");
  }
  return { google, mixpanel };
}

function validateLocalConfig(config, plan) {
  const errors = [];
  if (config.schemaVersion !== 1) errors.push("analytics/stack.json schemaVersion must be 1.");
  if (plan.schemaVersion !== 1) errors.push("analytics/events.json schemaVersion must be 1.");
  try {
    new URL(config.site.productionUrl);
  } catch {
    errors.push("site.productionUrl must be an absolute URL.");
  }
  if (!Array.isArray(config.site.hostnames) || config.site.hostnames.length === 0) {
    errors.push("site.hostnames must contain at least one hostname.");
  }
  if (!["US", "EU", "IN", "India"].includes(config.mixpanel.region)) {
    errors.push("mixpanel.region must be US, EU, IN, or India.");
  }
  const names = plan.events.map((event) => event.name);
  if (new Set(names).size !== names.length) errors.push("Event names must be unique.");
  const forbidden = new Set(plan.forbiddenProperties);
  for (const property of Object.keys(plan.properties)) {
    if (forbidden.has(property)) errors.push(`Forbidden property declared: ${property}`);
  }
  if (errors.length > 0) fail(errors.join("\n"));
}

function printLocalSummary() {
  console.log(`  OK     stack schema v${stack.schemaVersion}`);
  console.log(`  OK     tracking plan: ${trackingPlan.events.length} events`);
  console.log(`  OK     GTM desired state: ${desired.gtm.variables.length} variables, ${desired.gtm.triggers.length} triggers, ${desired.gtm.tags.length} tags`);
  console.log(`  OK     GA4: ${desired.ga.customDimensions.length} dimensions, ${desired.ga.keyEvents.length} key events`);
  console.log(`  OK     manifest checksum ${checksum}`);
}

function printDiff(label, expected, actual, key = (item) => item.name) {
  console.log(`\n${label}:`);
  const remote = new Map(actual.map((item) => [key(item), item]));
  for (const item of expected) {
    const name = key(item);
    const current = remote.get(name);
    if (!current) console.log(`  CREATE ${name}`);
    else if (sameDesired(item, current)) console.log(`  KEEP   ${name}`);
    else console.log(`  UPDATE ${name}`);
  }
}

function verifyNames(label, expected, actual, failures, key = (item) => item.name) {
  const actualNames = new Set(actual.map(key));
  const missing = expected.map(key).filter((name) => !actualNames.has(name));
  if (missing.length > 0) failures.push(`${label} missing: ${missing.join(", ")}`);
  else console.log(`  OK     ${label}`);
}

function sameDesired(expected, actual) {
  const desiredKeys = Object.keys(expected).filter(
    (key) => !["desiredTrigger", "desiredBlockingTrigger"].includes(key)
  );
  return desiredKeys.every(
    (key) => stableJson(expected[key]) === stableJson(actual[key])
  );
}

function sanitizeResource(resource) {
  const ignored = new Set([
    "accountId",
    "containerId",
    "workspaceId",
    "variableId",
    "triggerId",
    "tagId",
    "path",
    "fingerprint",
    "parentFolderId"
  ]);
  return Object.fromEntries(
    Object.entries(resource).filter(([key]) => !ignored.has(key))
  );
}

function sanitize(value) {
  const secretPattern = /secret|private.?key|access.?token|refresh.?token|authorization/i;
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (secretPattern.test(key)) return [key, "[REDACTED]"];
      if (/url|referrer/i.test(key) && typeof item === "string") {
        return [key, sanitizeUrl(item)];
      }
      return [key, sanitize(item)];
    })
  );
}

function sanitizeUrl(value) {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "[REDACTED_URL]";
  }
}

async function saveSnapshot(prefix, value) {
  await mkdir(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = path.join(backupDir, `${prefix}-${stamp}.json`);
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  console.log(`  SNAPSHOT ${path.relative(root, target)}`);
}

async function writeState() {
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

function gtmWorkspacePath(workspaceId) {
  return `accounts/${stack.google.gtmAccountId}/containers/${resolved.gtmContainerId || state.google.gtmContainerId}/workspaces/${workspaceId}`;
}

function normalizeResourceId(value) {
  if (!value) return "";
  return String(value).split("/").filter(Boolean).at(-1);
}

function mixpanelApiHost(region) {
  if (region === "EU") return "https://api-eu.mixpanel.com";
  if (region === "IN" || region === "India") return "https://api-in.mixpanel.com";
  return "https://api.mixpanel.com";
}

function mixpanelManagementHost(region) {
  if (region === "EU") return "https://eu.mixpanel.com";
  if (region === "IN" || region === "India") return "https://in.mixpanel.com";
  return "https://mixpanel.com";
}

function basicAuth() {
  return Buffer.from(
    `${process.env.MIXPANEL_SERVICE_ACCOUNT_USERNAME}:${process.env.MIXPANEL_SERVICE_ACCOUNT_SECRET}`
  ).toString("base64");
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function stableJson(value) {
  if (Array.isArray(value)) return JSON.stringify(value.map(stableObject));
  return JSON.stringify(stableObject(value));
}

function stableObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, Array.isArray(item) ? item.map(stableObject) : stableObject(item)])
  );
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function httpError(label, response) {
  const body = await response.text();
  return new Error(`${label} returned ${response.status}: ${body.slice(0, 500)}`);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function git(...args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function requirePrerequisites(label, missing) {
  if (missing.length > 0) {
    fail(`${label} prerequisites are missing:\n- ${missing.join("\n- ")}`);
  }
}

function heading(message) {
  console.log(`\n${message}\n${"=".repeat(message.length)}`);
}

function note(message, items) {
  console.log(`\n${message}:`);
  items.forEach((item) => console.log(`  NEED   ${item}`));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
