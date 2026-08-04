export function resolveSmokeReport(payload) {
  if (
    payload &&
    typeof payload === "object" &&
    payload.schemaVersion === 2 &&
    payload.locales &&
    typeof payload.locales === "object" &&
    payload.locales["zh-TW"]
  ) {
    return payload.locales["zh-TW"];
  }
  return payload;
}

function reportStructureMatches(source, translation) {
  const sourceIds = (value) =>
    Array.isArray(value?.sources) ? value.sources.map((item) => item?.id) : [];
  const claims = (value) =>
    Array.isArray(value?.claims)
      ? value.claims.map((item) => ({ id: item?.id, evidenceIds: item?.evidenceIds }))
      : [];
  return (
    source?.id === translation?.id &&
    source?.targetUrl === translation?.targetUrl &&
    JSON.stringify(sourceIds(source)) === JSON.stringify(sourceIds(translation)) &&
    JSON.stringify(claims(source)) === JSON.stringify(claims(translation))
  );
}

export function validateSmokeReport(payload) {
  const bilingualEnvelopeIsValid =
    payload &&
    typeof payload === "object" &&
    payload.schemaVersion === 2 &&
    Array.isArray(payload.availableLocales) &&
    payload.availableLocales.includes("zh-TW") &&
    payload.availableLocales.includes("en") &&
    Boolean(payload.locales?.["zh-TW"]) &&
    Boolean(payload.locales?.en) &&
    reportStructureMatches(payload.locales?.["zh-TW"], payload.locales?.en);
  const report = resolveSmokeReport(payload);
  if (!report || typeof report !== "object") {
    return { ok: false, report: null, sourceCount: 0 };
  }

  const sources = Array.isArray(report.sources) ? report.sources : [];
  const claims = Array.isArray(report.claims) ? report.claims : [];
  const sourceIds = new Set(sources.map((source) => source?.id));
  const citationsAreValid =
    sources.length > 0 &&
    sources.every((source) => {
      try {
        return new URL(source.url).protocol === "https:";
      } catch {
        return false;
      }
    });
  const verifiedClaimsAreSupported = claims
    .filter((claim) => claim?.status === "verified")
    .every(
      (claim) =>
        Array.isArray(claim.evidenceIds) &&
        claim.evidenceIds.length > 0 &&
        claim.evidenceIds.every((sourceId) => sourceIds.has(sourceId))
    );
  const gameProfile = report.gameProfile;
  const gameProfileIsValid =
    gameProfile?.rubricVersion === "game-profile-v2" &&
    gameProfile?.identity?.identityVersion === "method-persona-v1" &&
    typeof gameProfile?.identity?.title === "string" &&
    /^\p{Script=Han}{4}$/u.test(gameProfile.identity.title) &&
    Array.isArray(gameProfile?.identity?.beats) &&
    gameProfile.identity.beats.length === 3 &&
    Array.isArray(gameProfile?.axes) &&
    gameProfile.axes.length === 6 &&
    new Set(gameProfile.axes.map((axis) => axis?.id)).size === 6;

  return {
    ok:
      Boolean(bilingualEnvelopeIsValid) &&
      citationsAreValid &&
      verifiedClaimsAreSupported &&
      gameProfileIsValid,
    report,
    sourceCount: sources.length
  };
}
