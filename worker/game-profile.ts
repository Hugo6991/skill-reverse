import type {
  Claim,
  GameArchetypeId,
  GameAxis,
  GameAxisId,
  GameAxisSignal,
  GameBadgeId,
  GameProfile,
  GameRoastId,
  ProfessionalDelta,
  RepositoryMetrics,
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
  signalIds: string[],
  signalDetails?: GameAxisSignal[]
): GameAxis {
  return {
    id,
    value: value === undefined ? undefined : roundToFive(value),
    coverage: roundToFive(coverage),
    evidenceIds: unique(axisEvidence),
    signalIds,
    ...(signalDetails?.length ? { signalDetails } : {})
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

interface GithubCoordinates {
  owner: string;
  repository: string;
  fullName: string;
}

function githubCoordinates(targetUrl: string): GithubCoordinates | undefined {
  const url = new URL(targetUrl);
  if (url.hostname.replace(/^www\./, "").toLowerCase() !== "github.com") return undefined;
  const [owner, repository] = url.pathname.split("/").filter(Boolean);
  if (!owner || !repository) return undefined;
  return {
    owner: decodeURIComponent(owner),
    repository: decodeURIComponent(repository).replace(/\.git$/i, ""),
    fullName: `${decodeURIComponent(owner)}/${decodeURIComponent(repository).replace(/\.git$/i, "")}`
      .toLowerCase()
  };
}

function logarithmicReach(value: number, ceiling: number): number {
  if (value <= 0) return 0;
  return Math.min(1, Math.log10(value + 1) / Math.log10(ceiling + 1));
}

function daysSince(date: string, now: Date): number | undefined {
  const timestamp = Date.parse(date);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.max(0, Math.floor((now.getTime() - timestamp) / 86_400_000));
}

function maintenanceStrength(ageInDays: number): number {
  if (ageInDays <= 30) return 1;
  if (ageInDays <= 90) return 0.8;
  if (ageInDays <= 180) return 0.55;
  if (ageInDays <= 365) return 0.25;
  return 0;
}

function renownProfile(input: ProfileInput): {
  value?: number;
  coverage: number;
  evidenceIds: string[];
  signalDetails: GameAxisSignal[];
  recentlyMaintained: boolean;
} {
  const targetRepository = githubCoordinates(input.targetUrl);
  const targetSource = targetRepository
    ? input.sources.find((source) => {
        const coordinates = githubCoordinates(source.url);
        return (
          source.status === "verified_at_retrieval" &&
          coordinates?.fullName === targetRepository.fullName
        );
      })
    : undefined;
  const metricSource = targetRepository
    ? input.sources.find(
        (source) =>
          source.status === "verified_at_retrieval" &&
          source.repositoryMetrics?.fullName.toLowerCase() === targetRepository.fullName
      )
    : undefined;
  const metrics: RepositoryMetrics | undefined = metricSource?.repositoryMetrics;
  const publicDiscussionSources = input.sources.filter(
    (source) =>
      source.status === "verified_at_retrieval" &&
      source.kind === "x_post" &&
      source.url !== input.targetUrl
  );
  const details: GameAxisSignal[] = [];

  if (targetSource) {
    details.push({
      id: "publisher_repository",
      points: 15,
      maxPoints: 15,
      evidenceIds: [targetSource.id]
    });
  }
  if (metrics && metricSource) {
    details.push({
      id: "github_stars",
      value: metrics.stars,
      points: 40 * logarithmicReach(metrics.stars, 100_000),
      maxPoints: 40,
      evidenceIds: [metricSource.id]
    });
    details.push({
      id: "github_forks",
      value: metrics.forks,
      points: 25 * logarithmicReach(metrics.forks, 10_000),
      maxPoints: 25,
      evidenceIds: [metricSource.id]
    });
  }
  if (publicDiscussionSources.length) {
    details.push({
      id: "public_discussion",
      value: publicDiscussionSources.length,
      points: 10 * Math.min(1, publicDiscussionSources.length / 5),
      maxPoints: 10,
      evidenceIds: publicDiscussionSources.map((source) => source.id)
    });
  }
  const maintenanceAge = metrics?.pushedAt
    ? daysSince(metrics.pushedAt, new Date(metrics.retrievedAt))
    : undefined;
  if (maintenanceAge !== undefined && metricSource) {
    details.push({
      id: "maintenance_recency",
      value: maintenanceAge,
      points: 10 * maintenanceStrength(maintenanceAge),
      maxPoints: 10,
      evidenceIds: [metricSource.id]
    });
  }

  const coverage = details.reduce((sum, detail) => sum + detail.maxPoints, 0);
  const value = coverage >= 30
    ? details.reduce((sum, detail) => sum + detail.points, 0)
    : undefined;
  return {
    value,
    coverage,
    evidenceIds: unique(details.flatMap((detail) => detail.evidenceIds)),
    signalDetails: details.map((detail) => ({
      ...detail,
      points: Math.round(detail.points)
    })),
    recentlyMaintained: maintenanceAge !== undefined && maintenanceAge <= 90
  };
}

function resolveArchetype(values: Map<GameAxisId, number>): GameArchetypeId {
  const score = (id: GameAxisId) => values.get(id);
  if ((score("money") ?? 0) >= 70 && (score("potency") ?? 0) >= 70) {
    return "wealth_with_proof";
  }
  if ((score("spectacle") ?? 0) >= 75 && (score("potency") ?? 100) <= 50) {
    return "all_aura";
  }
  if ((score("renown") ?? 0) >= 75) return "famous_sect";
  if ((score("potency") ?? 0) >= 75 && (score("spectacle") ?? 100) <= 50) {
    return "quiet_power";
  }
  if ((score("activation") ?? 0) >= 70 && (score("ascension") ?? 0) >= 70) {
    return "hard_ascension";
  }
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

  const renown = renownProfile(input);

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
    axis(
      "renown",
      renown.value,
      renown.coverage,
      renown.evidenceIds,
      renown.signalDetails.map((detail) => detail.id),
      renown.signalDetails
    ),
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
  if (renown.recentlyMaintained) badges.push("well_maintained");

  const owner = githubCoordinates(input.targetUrl)?.owner;
  return {
    rubricVersion: "game-profile-v1.1",
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
