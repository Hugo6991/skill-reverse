import type {
  GameIdentity,
  GameProfile,
  Locale,
  ReverseReport,
  StoredReverseReport
} from "../src/types";
import {
  hasCurrentIdentity,
  localizedEnglishIdentity,
  repairGameIdentity,
  type IdentitySelectionContext
} from "./game-identity";
import { computeGameProfile, confidenceFromScore } from "./game-profile";

const GAME_AXIS_IDS = new Set([
  "money",
  "spectacle",
  "potency",
  "activation",
  "renown",
  "ascension"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasBaseGameProfile(value: unknown): value is GameProfile {
  if (!isRecord(value) || !Array.isArray(value.axes) || value.axes.length !== 6) {
    return false;
  }
  return (
    value.rubricVersion === "game-profile-v2" &&
    isRecord(value.identity) &&
    typeof value.identity.title === "string" &&
    typeof value.identity.motifId === "string" &&
    typeof value.highlightAxisId === "string" &&
    typeof value.riskAxisId === "string" &&
    value.axes.every(
      (axis) => isRecord(axis) && typeof axis.id === "string" && GAME_AXIS_IDS.has(axis.id)
    )
  );
}

function isUpgradeableReport(value: unknown): value is StoredReverseReport {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.targetUrl === "string" &&
    isRecord(value.framework) &&
    Array.isArray(value.framework.steps) &&
    isRecord(value.author) &&
    Array.isArray(value.professionalDelta) &&
    Array.isArray(value.claims) &&
    Array.isArray(value.sources) &&
    Array.isArray(value.adoption)
  );
}

export class ReportUpgradeError extends Error {
  constructor(message = "This report cannot be upgraded safely") {
    super(message);
    this.name = "ReportUpgradeError";
  }
}

export function upgradeStoredReport(
  value: unknown,
  locale: Locale = "zh-TW",
  identityContext: IdentitySelectionContext = {}
): ReverseReport {
  if (!isUpgradeableReport(value)) throw new ReportUpgradeError();
  try {
    const normalized = {
      ...value,
      claims: value.claims.map((claim) => ({
        ...claim,
        confidence: confidenceFromScore(claim.score)
      }))
    } as Omit<ReverseReport, "gameProfile">;
    if (hasBaseGameProfile(value.gameProfile)) {
      if (hasCurrentIdentity(value.gameProfile.identity)) {
        return { ...normalized, gameProfile: value.gameProfile };
      }
      const repaired = repairGameIdentity(
        normalized,
        value.gameProfile.identity as Partial<GameIdentity>,
        identityContext
      );
      return {
        ...normalized,
        gameProfile: {
          ...value.gameProfile,
          identity:
            locale === "en"
              ? localizedEnglishIdentity(repaired)
              : repaired
        }
      };
    }
    return {
      ...normalized,
      gameProfile: computeGameProfile(normalized, [], identityContext)
    };
  } catch {
    throw new ReportUpgradeError();
  }
}
