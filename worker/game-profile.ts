import type {
  Claim,
  GameArchetypeId,
  GameAxis,
  GameAxisId,
  GameBadgeId,
  GameProfile,
  GameRoastId,
  ProfessionalDelta,
  ReverseReport
} from "../src/types";

type ProfileInput = Pick<
  ReverseReport,
  | "targetUrl"
  | "framework"
  | "author"
  | "professionalDelta"
  | "claims"
  | "sources"
  | "adoption"
>;

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function roundToFive(value: number): number {
  return Math.round(clamp(value) / 5) * 5;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function evidenceIds(claims: Claim[], deltas: ProfessionalDelta[]): string[] {
  return unique([
    ...claims.flatMap((claim) => claim.evidenceIds),
    ...deltas.flatMap((delta) => delta.evidenceIds)
  ]);
}

function claimStrength(claim: Claim): number {
  const statusFactor = {
    verified: 1,
    supported_inference: 0.76,
    plausible: 0.48,
    unknown_contradicted: 0.1
  }[claim.status];
  return claim.confidence * statusFactor;
}

function axis(
  id: GameAxisId,
  value: number | undefined,
  coverage: number,
  axisEvidence: string[],
  signalIds: string[]
): GameAxis {
  return {
    id,
    value: value === undefined ? undefined : roundToFive(value),
    coverage: roundToFive(coverage),
    evidenceIds: unique(axisEvidence),
    signalIds
  };
}

function dependencyMentions(input: ProfileInput): number {
  const text = [
    input.framework.summary,
    input.framework.useWhen,
    input.framework.avoidWhen,
    ...input.framework.steps.flatMap((step) => [step.title, step.instruction])
  ].join(" ");
  return (text.match(/\b(api|sdk|cli|plugin|install|dependency|framework|agent)\b/gi) ?? []).length;
}

function githubOwner(targetUrl: string): string | undefined {
  const url = new URL(targetUrl);
  if (url.hostname.replace(/^www\./, "").toLowerCase() !== "github.com") return undefined;
  const owner = url.pathname.split("/").filter(Boolean)[0];
  return owner ? decodeURIComponent(owner) : undefined;
}

function resolveArchetype(values: Map<GameAxisId, number>): GameArchetypeId {
  const score = (id: GameAxisId) => values.get(id);
  if ((score("money") ?? 0) >= 70 && (score("potency") ?? 0) >= 70) {
    return "wealth_with_proof";
  }
  if ((score("spectacle") ?? 0) >= 75 && (score("potency") ?? 100) <= 50) {
    return "all_aura";
  }
  if ((score("potency") ?? 0) >= 75 && (score("spectacle") ?? 100) <= 50) {
    return "quiet_power";
  }
  if ((score("activation") ?? 0) >= 70 && (score("ascension") ?? 0) >= 70) {
    return "hard_ascension";
  }
  if ((score("renown") ?? 0) >= 75) return "famous_sect";
  if ((score("ascension") ?? 0) >= 75 && (score("renown") ?? 100) <= 45) {
    return "hidden_manual";
  }
  if ((score("activation") ?? 100) <= 35 && (score("potency") ?? 0) >= 65) {
    return "instant_magic";
  }
  const fallbackOrder: GameAxisId[] = [
    "potency",
    "money",
    "ascension",
    "spectacle",
    "activation",
    "renown"
  ];
  return fallbackOrder
    .filter((id) => values.has(id))
    .sort((a, b) => (values.get(b) ?? 0) - (values.get(a) ?? 0))[0] ?? "potency";
}

function resolveRoast(values: Map<GameAxisId, number>): GameRoastId {
  const score = (id: GameAxisId) => values.get(id);
  if ((score("spectacle") ?? 0) >= 75 && (score("potency") ?? 100) <= 50) {
    return "all_aura";
  }
  if ((score("renown") ?? 0) >= 75 && (score("potency") ?? 100) <= 50) {
    return "famous_but_unproven";
  }
  if ((score("activation") ?? 0) >= 70 && (score("money") ?? 100) <= 45) {
    return "expensive_unknown_return";
  }
  if ((score("money") ?? 0) >= 70 && (score("activation") ?? 0) >= 70) {
    return "valuable_hard_start";
  }
  if ((score("renown") ?? 100) <= 45 && (score("potency") ?? 0) >= 70) {
    return "quiet_power";
  }
  if ((score("ascension") ?? 0) >= 75 && (score("activation") ?? 100) <= 40) {
    return "portable_manual";
  }
  return "balanced";
}

function orderedAxisIds(axes: GameAxis[], direction: "strongest" | "weakest"): GameAxisId {
  const eligible = axes.filter((item) => item.value !== undefined && item.coverage >= 30);
  const fallback: GameAxisId = "potency";
  if (!eligible.length) return fallback;
  return eligible.sort((a, b) =>
    direction === "strongest"
      ? (b.value ?? 0) - (a.value ?? 0)
      : (a.value ?? 0) - (b.value ?? 0)
  )[0].id;
}

export function computeGameProfile(input: ProfileInput): GameProfile {
  const claims = input.claims;
  const deltas = input.professionalDelta;
  const sourceIds = input.sources.map((source) => source.id);
  const observedDeltas = deltas.filter((delta) =>
    ["evidenced", "author_specific_extension"].includes(delta.manifestation)
  );
  const verifiedClaims = claims.filter((claim) => claim.status === "verified");
  const evidencedClaims = claims.filter((claim) => claim.evidenceIds.length > 0);
  const averageClaimStrength = claims.length
    ? claims.reduce((sum, claim) => sum + claimStrength(claim), 0) / claims.length
    : undefined;
  const averageReproducibility = claims.length
    ? claims.reduce((sum, claim) => sum + claim.score.reproducibility, 0) /
      claims.length /
      15 *
      100
    : undefined;
  const deltaRatio = deltas.length ? observedDeltas.length / deltas.length : 0;
  const adoptionStrength = Math.min(1, input.adoption.length / 4);
  const allEvidence = evidenceIds(claims, deltas);

  const potency = averageClaimStrength === undefined
    ? undefined
    : averageClaimStrength * 0.62 +
      (claims.length ? verifiedClaims.length / claims.length : 0) * 22 +
      (claims.length ? evidencedClaims.length / claims.length : 0) * 16;
  const potencyCoverage = claims.length
    ? Math.min(100, 35 + evidencedClaims.length / claims.length * 45 + verifiedClaims.length * 10)
    : 0;

  const money = claims.length || deltas.length
    ? 24 +
      deltaRatio * 30 +
      adoptionStrength * 20 +
      (averageReproducibility ?? 0) * 0.26
    : undefined;
  const moneyCoverage = Math.min(
    100,
    (deltas.length ? 35 : 0) + (claims.length ? 35 : 0) + (input.adoption.length ? 20 : 0)
  );

  const spectacle = input.sources.length
    ? 22 +
      Math.min(28, input.framework.steps.length * 6) +
      Math.min(20, input.sources.length * 5) +
      Math.min(20, input.framework.summary.length / 12)
    : undefined;
  const spectacleCoverage = Math.min(
    100,
    (input.sources.length ? 55 : 0) + Math.min(35, input.framework.steps.length * 7)
  );

  const dependencyCount = dependencyMentions(input);
  const activation = input.framework.steps.length
    ? 18 +
      Math.max(0, input.framework.steps.length - 2) * 8 +
      Math.min(42, dependencyCount * 7) +
      (input.framework.avoidWhen.length > 80 ? 8 : 0)
    : undefined;
  const activationCoverage = input.sources.length
    ? Math.min(100, 50 + input.framework.steps.length * 8)
    : 25;

  const socialSources = input.sources.filter((source) => source.kind === "x_post");
  const thirdPartySources = input.sources.filter(
    (source) => source.status === "verified_at_retrieval" && source.url !== input.targetUrl
  );
  const renownCoverage = socialSources.length
    ? Math.min(100, 55 + socialSources.length * 8)
    : input.sources.some((source) => source.kind === "github")
      ? 25
      : 0;
  const renown = renownCoverage >= 30
    ? 20 + Math.min(50, socialSources.length * 12) + Math.min(25, thirdPartySources.length * 5)
    : undefined;

  const conditionalSteps = input.framework.steps.filter(
    (step) => step.failureType === "conditional"
  ).length;
  const ascension = deltas.length || input.framework.steps.length
    ? 30 +
      deltaRatio * 35 +
      Math.min(20, conditionalSteps * 10) +
      Math.max(0, 15 - dependencyCount * 2)
    : undefined;
  const ascensionCoverage = Math.min(
    100,
    (deltas.length ? 45 : 0) +
      (input.framework.steps.length ? 35 : 0) +
      (allEvidence.length ? 15 : 0)
  );

  const axes: GameAxis[] = [
    axis("money", money, moneyCoverage, allEvidence, [
      "professional_delta",
      "adoption_signals",
      "reproducibility"
    ]),
    axis("spectacle", spectacle, spectacleCoverage, sourceIds, [
      "framework_shape",
      "source_surface",
      "presentation_density"
    ]),
    axis("potency", potency, potencyCoverage, claims.flatMap((claim) => claim.evidenceIds), [
      "claim_strength",
      "verified_claims",
      "evidence_coverage"
    ]),
    axis("activation", activation, activationCoverage, sourceIds, [
      "workflow_depth",
      "dependency_mentions",
      "conditional_setup"
    ]),
    axis("renown", renown, renownCoverage, socialSources.map((source) => source.id), [
      "verified_social_sources",
      "third_party_sources"
    ]),
    axis("ascension", ascension, ascensionCoverage, allEvidence, [
      "professional_delta",
      "conditional_rules",
      "dependency_surface"
    ])
  ];
  const values = new Map(
    axes
      .filter((item): item is GameAxis & { value: number } => item.value !== undefined)
      .map((item) => [item.id, item.value])
  );

  const badges: GameBadgeId[] = [];
  if ((values.get("potency") ?? 0) >= 70 && potencyCoverage >= 70) badges.push("evidence_rich");
  if ((values.get("activation") ?? 100) <= 40 && activationCoverage >= 50) {
    badges.push("low_dependency");
  }
  if ((values.get("ascension") ?? 0) >= 70 && ascensionCoverage >= 60) badges.push("portable");
  if (input.adoption.length >= 2 && allEvidence.length >= 2) badges.push("field_tested");
  if (socialSources.length >= 2) badges.push("well_maintained");

  const owner = githubOwner(input.targetUrl);
  return {
    rubricVersion: "game-profile-v1",
    axes,
    archetypeId: resolveArchetype(values),
    roastId: resolveRoast(values),
    badges: badges.slice(0, 3),
    strongestAxisId: orderedAxisIds(axes, "strongest"),
    weakestAxisId: orderedAxisIds(axes, "weakest"),
    author: owner
      ? {
          avatarUrl: `https://github.com/${encodeURIComponent(owner)}.png?size=160`,
          profileUrl: `https://github.com/${encodeURIComponent(owner)}`,
          attribution: "repository_owner"
        }
      : {
          attribution: input.author.handle ? "identified_creator" : "source_creator"
        }
  };
}
