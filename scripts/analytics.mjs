import { createHash, createSign, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  buildDesiredState,
  completePendingWorkspaceState,
  createPendingWorkspaceState,
  fetchWithSafeRetries,
  invalidateWorkspaceApplyState,
  parseProviders,
  partitionProvidersByPrerequisites,
  publishStateErrors,
  selectedGtmProviders
} from "./analytics-lib.mjs";

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
let providers;
try {
  providers = parseProviders(process.argv.slice(3));
} catch (error) {
  fail(errorMessage(error));
}
const providerSet = new Set(providers);
const gtmProviders = selectedGtmProviders(providers);

const [stack, trackingPlan, persistedState] = await Promise.all([
  readJson(stackPath),
  readJson(eventsPath),
  readJson(statePath)
]);
validateLocalConfig(stack, trackingPlan);

let state = structuredClone(persistedState);
state.google ??= {};
state.workspaceChecksum ??= "";
state.workspaceProviders = Array.isArray(state.workspaceProviders)
  ? state.workspaceProviders
  : [];
state.workspaceSavedAt ??= "";
state.applyAttemptChecksum ??= "";
state.applyAttemptProviders = Array.isArray(state.applyAttemptProviders)
  ? state.applyAttemptProviders
  : [];
state.applyAttemptStartedAt ??= "";
state.appliedChecksum ??= "";
state.appliedProviders = Array.isArray(state.appliedProviders) ? state.appliedProviders : [];
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

let desired = buildDesiredState(stack, trackingPlan, resolved, providers);
const prerequisites = getMissingPrerequisites(stack, resolved);

if (command === "plan") await plan();
if (command === "apply") await apply();
if (command === "publish") await publish();
if (command === "verify") await verify();
if (command === "export") await exportBundle();

async function plan() {
  heading("Analytics plan");
  printLocalSummary();
  const { runnable: runnableProviders, skipped } =
    partitionProvidersByPrerequisites(providers, prerequisites);
  for (const { provider, missing } of skipped) {
    note(`${providerLabel(provider)} remote plan skipped`, missing);
  }

  let google;
  const runnableGtmProviders = selectedGtmProviders(runnableProviders);
  if (runnableGtmProviders.length > 0) {
    google = await googleClient();
    const remoteDesired = buildDesiredState(
      stack,
      trackingPlan,
      resolved,
      runnableGtmProviders
    );
    const remote = await readGoogleState(google, {
      providers: runnableGtmProviders
    });
    printDiff("GTM variables", remoteDesired.gtm.variables, remote.gtm.variables);
    printDiff("GTM triggers", remoteDesired.gtm.triggers, remote.gtm.triggers);
    printDiff("GTM tags", remoteDesired.gtm.tags, remote.gtm.tags);
    if (runnableGtmProviders.includes("ga4")) {
      printDiff(
        "GA4 custom dimensions",
        remoteDesired.ga.customDimensions,
        remote.ga.customDimensions,
        (item) => item.parameterName
      );
      printDiff(
        "GA4 key events",
        remoteDesired.ga.keyEvents,
        remote.ga.keyEvents,
        (item) => item.eventName
      );
    }
  }

  if (runnableProviders.includes("mixpanel")) {
    const schemas = await readMixpanelSchemas();
    printDiff(
      "Mixpanel Lexicon schemas",
      desired.mixpanel.schemas,
      schemas,
      (item) => item.eventName ?? item.name
    );
  }

  if (runnableProviders.includes("clarity")) {
    console.log(
      `  KEEP   Clarity project ${stack.clarity.projectId} (project settings remain manual)`
    );
  }

  if (runnableProviders.includes("search-console")) {
    google ??= await googleClient();
    await planSearchConsole(google);
  }
}

async function apply() {
  for (const provider of providers) {
    requirePrerequisites(providerLabel(provider), prerequisites[provider]);
  }
  heading("Applying analytics desired state");
  let google;
  if (gtmProviders.length > 0 || providerSet.has("search-console")) {
    google = await googleClient();
  }

  const [beforeGoogle, beforeMixpanel] = await Promise.all([
    gtmProviders.length > 0
      ? readGoogleState(google, { allowMissing: true, providers: gtmProviders })
      : Promise.resolve(null),
    providerSet.has("mixpanel") ? readMixpanelSchemas() : Promise.resolve(null)
  ]);
  const beforeApply = {};
  if (beforeGoogle) beforeApply.google = beforeGoogle;
  if (beforeMixpanel) beforeApply.mixpanelSchemas = beforeMixpanel;
  if (Object.keys(beforeApply).length > 0) {
    await saveSnapshot("before-apply", sanitize(beforeApply));
  }

  if (gtmProviders.length > 0) {
    state = invalidateWorkspaceApplyState(state, {
      checksum,
      providers,
      startedAt: new Date().toISOString()
    });
    await writeState();
  }

  if (providerSet.has("ga4")) {
    const ga = await applyGa(google);
    resolved.gaPropertyId = ga.propertyId;
    resolved.gaWebStreamId = ga.streamId;
    resolved.gaMeasurementId = ga.measurementId;
    state.google = {
      ...state.google,
      gaPropertyId: ga.propertyId,
      gaWebStreamId: ga.streamId,
      gaMeasurementId: ga.measurementId
    };
    await writeState();
    desired = buildDesiredState(stack, trackingPlan, resolved, providers);
  }

  if (gtmProviders.length > 0) {
    const gtm = await applyGtm(google);
    resolved.gtmContainerId = gtm.containerId;
    resolved.gtmPublicId = gtm.publicId;
    state = createPendingWorkspaceState(state, {
      checksum,
      providers,
      google: {
        gtmContainerId: gtm.containerId,
        gtmPublicId: gtm.publicId,
        gtmWorkspaceId: gtm.workspaceId
      },
      recordedAt: new Date().toISOString()
    });
    await writeState();
  }

  const providerFailures = [];
  if (providerSet.has("search-console")) {
    try {
      await submitSitemap(google);
    } catch (error) {
      providerFailures.push(`Search Console apply failed: ${errorMessage(error)}`);
    }
  }
  if (providerSet.has("mixpanel")) {
    try {
      await applyMixpanelSchemas();
    } catch (error) {
      providerFailures.push(`Mixpanel apply failed: ${errorMessage(error)}`);
    }
  }
  if (providerFailures.length > 0) fail(providerFailures.join("\n"));

  if (gtmProviders.length > 0) {
    state = completePendingWorkspaceState(state, {
      checksum,
      providers,
      appliedAt: new Date().toISOString()
    });
    await writeState();
  } else {
    state.lastAppliedAt = new Date().toISOString();
    await writeState();
  }

  if (gtmProviders.length > 0) {
    console.log(
      "\nApply complete. GTM is not published; inspect the workspace, then run pnpm analytics:publish with the same --providers selection."
    );
  } else {
    console.log("\nApply complete.");
  }
}

async function publish() {
  const mismatches = publishStateErrors(state, checksum, providers);
  if (mismatches.length > 0) fail(mismatches.join("\n"));
  requirePrerequisites("Google Tag Manager", prerequisites.gtmPublish);
  heading("Publishing GTM version");
  const google = await googleClient();
  const workspacePath = gtmWorkspacePath(state.google.gtmWorkspaceId);
  const sync = await google.post(
    `https://tagmanager.googleapis.com/tagmanager/v2/${workspacePath}:sync`,
    {}
  );
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
      notes:
        `Skill Reverse Analytics Stack as Code\ncommit=${gitCommit}\nmanifest=${checksum}\nproviders=${providers.join(",")}`
    }
  );
  if ((version.compilerError ?? false) || !version.containerVersion?.path) {
    fail(
      `GTM rejected the container version: ${JSON.stringify(
        version.compilerError ?? version
      )}`
    );
  }
  await google.post(
    `https://tagmanager.googleapis.com/tagmanager/v2/${version.containerVersion.path}:publish`,
    {}
  );
  state.lastPublishedVersionPath = version.containerVersion.path;
  state.google.gtmWorkspaceId = "";
  state.workspaceChecksum = "";
  state.workspaceProviders = [];
  state.workspaceSavedAt = "";
  await writeState();
  console.log(`Published ${version.containerVersion.path}`);
}

async function verify() {
  heading("Verifying analytics stack");
  printLocalSummary();
  const failures = [];
  const warnings = [];
  const { runnable: runnableProviders, skipped } =
    partitionProvidersByPrerequisites(providers, prerequisites);
  for (const { provider, missing } of skipped) {
    failures.push(
      `${providerLabel(provider)} verification skipped: ${missing.join(", ")}`
    );
  }

  let google;
  const runnableGtmProviders = selectedGtmProviders(runnableProviders);
  if (runnableGtmProviders.length > 0) {
    try {
      google = await googleClient();
      const remoteDesired = buildDesiredState(
        stack,
        trackingPlan,
        resolved,
        runnableGtmProviders
      );
      const remote = await readGoogleState(google, {
        providers: runnableGtmProviders
      });
      verifyNames(
        "GTM variables",
        remoteDesired.gtm.variables,
        remote.gtm.variables,
        failures
      );
      verifyNames(
        "GTM triggers",
        remoteDesired.gtm.triggers,
        remote.gtm.triggers,
        failures
      );
      verifyNames("GTM tags", remoteDesired.gtm.tags, remote.gtm.tags, failures);
      if (runnableGtmProviders.includes("ga4")) {
        verifyNames(
          "GA4 custom dimensions",
          remoteDesired.ga.customDimensions,
          remote.ga.customDimensions,
          failures,
          (item) => item.parameterName
        );
        verifyNames(
          "GA4 key events",
          remoteDesired.ga.keyEvents,
          remote.ga.keyEvents,
          failures,
          (item) => item.eventName
        );
        await sendSyntheticGaEvent(warnings);
      }
      if (!state.lastPublishedVersionPath) {
        warnings.push("No GTM version has been published by this automation yet.");
      }
    } catch (error) {
      failures.push(`Google/GTM verification failed: ${errorMessage(error)}`);
    }
  }

  if (runnableProviders.includes("search-console")) {
    try {
      google ??= await googleClient();
      await verifySearchConsole(google, failures);
    } catch (error) {
      failures.push(`Search Console verification failed: ${errorMessage(error)}`);
    }
  }

  if (runnableProviders.includes("mixpanel")) {
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
  }

  if (runnableProviders.includes("clarity")) {
    if (process.env.CLARITY_EXPORT_TOKEN) {
      try {
        await readClarityExport();
        console.log("  OK     Clarity Data Export API");
      } catch (error) {
        failures.push(`Clarity verification failed: ${errorMessage(error)}`);
      }
    } else {
      warnings.push(
        "Optional CLARITY_EXPORT_TOKEN is unavailable; Clarity delivery still requires the browser runtime gate."
      );
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
    providers,
    stack,
    trackingPlan,
    state: sanitize(state),
    desiredState: desired,
    remoteState: {}
  };
  const { runnable: runnableProviders } = partitionProvidersByPrerequisites(
    providers,
    prerequisites
  );
  const runnableGtmProviders = selectedGtmProviders(runnableProviders);
  let google;

  if (runnableGtmProviders.length > 0) {
    try {
      google = await googleClient();
      bundle.remoteState.google = sanitize(
        await readGoogleState(google, {
          allowMissing: true,
          providers: runnableGtmProviders
        })
      );
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
  if (runnableProviders.includes("search-console")) {
    try {
      google ??= await googleClient();
      bundle.remoteState.searchConsole = sanitize(
        await readSearchConsoleSite(google)
      );
    } catch (error) {
      bundle.remoteState.searchConsoleError = errorMessage(error);
    }
  }
  if (runnableProviders.includes("mixpanel")) {
    try {
      bundle.remoteState.mixpanelSchemas = sanitize(await readMixpanelSchemas());
    } catch (error) {
      bundle.remoteState.mixpanelError = errorMessage(error);
    }
  }
  if (
    runnableProviders.includes("clarity") &&
    process.env.CLARITY_EXPORT_TOKEN
  ) {
    try {
      bundle.remoteState.clarityInsights = sanitize(await readClarityExport());
    } catch (error) {
      bundle.remoteState.clarityError = errorMessage(error);
    }
  }

  await mkdir(exportDir, { recursive: true });
  const output = path.join(exportDir, `analytics-bundle-${checksum}.json`);
  await writeFile(output, `${JSON.stringify(bundle, null, 2)}\n`, { mode: 0o600 });
  console.log(`Wrote ${path.relative(root, output)} (secrets removed).`);
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
  const workspaceName = managedWorkspaceName(gtmProviders);
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
        description: `Managed from analytics manifests. checksum=${checksum}; providers=${gtmProviders.join(",")}`
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

async function readSearchConsoleSite(google) {
  const response = await google.raw(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(stack.google.searchConsoleSiteUrl)}`
  );
  if (!response.ok) throw await httpError("Search Console property", response);
  return response.json();
}

async function planSearchConsole(google) {
  const site = await readSearchConsoleSite(google);
  console.log(
    `  KEEP   Search Console ${site.siteUrl ?? stack.google.searchConsoleSiteUrl} (${site.permissionLevel ?? "accessible"})`
  );
}

async function readGoogleState(
  google,
  { allowMissing = false, providers: requestedProviders = gtmProviders } = {}
) {
  const requested = new Set(requestedProviders);
  const result = {
    gtm: { variables: [], triggers: [], tags: [], folders: [], versions: [] },
    ga: { customDimensions: [], keyEvents: [], property: null, stream: null }
  };
  if (
    selectedGtmProviders(requestedProviders).length > 0 &&
    stack.google.gtmAccountId &&
    resolved.gtmContainerId
  ) {
    const workspaces = await paginatedGoogle(
      google,
      `https://tagmanager.googleapis.com/tagmanager/v2/accounts/${stack.google.gtmAccountId}/containers/${resolved.gtmContainerId}/workspaces`,
      "workspace"
    );
    const expectedWorkspaceName = managedWorkspaceName(
      selectedGtmProviders(requestedProviders)
    );
    const legacyWorkspaceName = `[managed] Analytics Stack ${checksum}`;
    const stateWorkspaceMatches =
      state.workspaceChecksum === checksum &&
      selectedGtmProviders(state.workspaceProviders).join(",") ===
        selectedGtmProviders(requestedProviders).join(",");
    const workspace =
      (stateWorkspaceMatches
        ? workspaces.find((item) => item.workspaceId === state.google.gtmWorkspaceId)
        : undefined) ??
      workspaces.find((item) => item.name === expectedWorkspaceName) ??
      workspaces.find((item) => item.name === legacyWorkspaceName);
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
  if (requested.has("ga4") && resolved.gaPropertyId) {
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

async function verifySearchConsole(google, failures) {
  await readSearchConsoleSite(google);
  console.log("  OK     Search Console property access");
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
    failures.push(`Search Console URL Inspection failed (${inspect.status}).`);
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
    if (gtmProviders.length > 0) {
      warnings.push(
        `Browser runtime gate required for ${gtmProviders.join(", ")}: raw HTML cannot prove GTM tag execution; verify delivery in GTM Preview and each provider's live/debug view.`
      );
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
    fetchWithSafeRetries(fetch, url, {
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
  const response = await fetchWithSafeRetries(
    fetch,
    credentials.token_uri ?? "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion
      })
    },
    { operation: "oauth-token" }
  );
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

function getMissingPrerequisites(config, ids) {
  const googleAuth = [];
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    googleAuth.push("GOOGLE_APPLICATION_CREDENTIALS");
  }
  const gtm = [...googleAuth];
  if (!config.google.gtmAccountId) gtm.push("google.gtmAccountId");
  const ga4 = [...gtm];
  if (!config.google.gaAccountId && !ids.gaPropertyId) ga4.push("google.gaAccountId");
  const clarity = [...gtm];
  if (!config.clarity.projectId) clarity.push("clarity.projectId");
  const mixpanel = [];
  mixpanel.push(...gtm);
  if (!config.mixpanel.projectId) mixpanel.push("mixpanel.projectId");
  if (!config.mixpanel.projectToken) mixpanel.push("mixpanel.projectToken");
  if (!process.env.MIXPANEL_SERVICE_ACCOUNT_USERNAME) {
    mixpanel.push("MIXPANEL_SERVICE_ACCOUNT_USERNAME");
  }
  if (!process.env.MIXPANEL_SERVICE_ACCOUNT_SECRET) {
    mixpanel.push("MIXPANEL_SERVICE_ACCOUNT_SECRET");
  }
  const searchConsole = [...googleAuth];
  if (!config.google.searchConsoleSiteUrl) {
    searchConsole.push("google.searchConsoleSiteUrl");
  }
  const gtmPublish = [...gtm];
  if (!ids.gtmContainerId) gtmPublish.push("google.gtmContainerId");
  return {
    ga4: [...new Set(ga4)],
    clarity: [...new Set(clarity)],
    mixpanel: [...new Set(mixpanel)],
    "search-console": [...new Set(searchConsole)],
    gtmPublish: [...new Set(gtmPublish)]
  };
}

function providerLabel(provider) {
  if (provider === "ga4") return "GA4/GTM";
  if (provider === "search-console") return "Search Console";
  return provider[0].toUpperCase() + provider.slice(1);
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
  console.log(`  OK     providers: ${providers.join(", ")}`);
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

function managedWorkspaceName(selectedProviders) {
  return `[managed] Analytics Stack ${checksum} ${selectedProviders.join("+")}`;
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
