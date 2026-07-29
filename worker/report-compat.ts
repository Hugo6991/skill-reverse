import type { GameProfile, ReverseReport, StoredReverseReport } from "../src/types";
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

function hasRenderableGameProfile(value: unknown): value is GameProfile {
  if (!isRecord(value) || !Array.isArray(value.axes) || value.axes.length !== 6) {
    return false;
  }
  return (
    value.rubricVersion === "game-profile-v2" &&
    isRecord(value.identity) &&
    typeof value.identity.title === "string" &&
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

export function upgradeStoredReport(value: unknown): ReverseReport {
  if (!isUpgradeableReport(value)) throw new ReportUpgradeError();
  if (hasRenderableGameProfile(value.gameProfile)) return value as ReverseReport;
  try {
    const normalized = {
      ...value,
      claims: value.claims.map((claim) => ({
        ...claim,
        confidence: confidenceFromScore(claim.score)
      }))
    } as Omit<ReverseReport, "gameProfile">;
    return {
      ...normalized,
      gameProfile: computeGameProfile(normalized)
    };
  } catch {
    throw new ReportUpgradeError();
  }
}
