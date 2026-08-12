import { describe, expect, it } from "vitest";
import {
  createValidatedBilingualBundle,
  validateBackfillTranslation
} from "../scripts/backfill-report-localizations.mjs";
import { demoReport } from "../worker/demo";

function translation() {
  return {
    title: "Validated before packaging",
    verdict: "Test the method before turning it into a reusable artifact.",
    framework: {
      name: "Validate before packaging",
      summary: "Start from real work and package only stable behavior.",
      useWhen: "Use it for work that repeats.",
      avoidWhen: "Avoid it while the workflow is still changing.",
      steps: demoReport.framework.steps.map((_, index) => ({
        title: `Step ${index + 1}`,
        instruction: `Instruction ${index + 1}`
      }))
    },
    author: {
      background: "The team publishes reusable agent-skill patterns.",
      context: "The method treats skills as behavior that must be evaluated."
    },
    gameIdentity: {
      title: "Proof Before Packaging",
      signatureMove: "Validate the behavior before fixing its form.",
      strength: "It keeps reusable instructions grounded in observed work.",
      shadow: "It adds unnecessary ceremony to one-off work.",
      titleRationale: ["The first beat names the test.", "The second names the packaging."],
      beats: ["Find the repeated work.", "Test it with examples.", "Package only what holds up."]
    },
    occupation: {
      title: "Web and Digital Interface Designers",
      description: "Design interfaces and digital products.",
      aliases: demoReport.occupation.aliases.map((_, index) => `Alias ${index + 1}`),
      competencyLabels: demoReport.occupation.competencies.map(
        (_, index) => `Competency ${index + 1}`
      )
    },
    observations: demoReport.observations.map((_, index) => `Observation ${index + 1}`),
    claims: demoReport.claims.map((_, index) => `Claim ${index + 1}`),
    professionalDelta: demoReport.professionalDelta.map((_, index) => `Delta ${index + 1}`),
    adoption: demoReport.adoption.map((_, index) => `Adoption ${index + 1}`),
    caveats: demoReport.caveats.map((_, index) => `Caveat ${index + 1}`),
    degraded: demoReport.degraded.map((_, index) => `Degraded ${index + 1}`)
  };
}

describe("report localization backfill validation", () => {
  it("accepts a complete translation and validates the final bilingual bundle", () => {
    const translated = validateBackfillTranslation(demoReport, translation());
    const bundle = createValidatedBilingualBundle(demoReport, translated, {
      model: "test/model",
      synthesizedAt: "2026-08-12T00:00:00.000Z"
    });

    expect(bundle.schemaVersion).toBe(2);
    expect(bundle.availableLocales).toEqual(["zh-TW", "en"]);
    const source = bundle.locales["zh-TW"];
    const english = bundle.locales.en;
    expect(source).toBeDefined();
    expect(english).toBeDefined();
    if (!source || !english) throw new Error("Validated bundle is missing a locale");
    expect(source.id).toBe(demoReport.id);
    expect(english.title).toBe(translated.title);
    expect(english.gameProfile.identity.titleRationale).toHaveLength(2);
    expect(english.gameProfile.identity.titleRationale[0].explanation).toBe(
      translated.gameIdentity.titleRationale[0]
    );
    expect(english.gameProfile.identity.beats).toHaveLength(3);
    expect(english.gameProfile.identity.beats[0].text).toBe(
      translated.gameIdentity.beats[0]
    );
  });

  it.each([
    ["titleRationale", { titleRationale: ["only one"] }, "gameIdentity.titleRationale"],
    ["beats", { beats: ["one", "two"] }, "gameIdentity.beats"]
  ])("rejects a short %s array", (_name, override, expectedPath) => {
    const value = translation();
    value.gameIdentity = { ...value.gameIdentity, ...override } as typeof value.gameIdentity;
    expect(() => validateBackfillTranslation(demoReport, value)).toThrow(
      new RegExp(expectedPath.replace(".", '\"[\\s\\S]*\"'))
    );
  });

  it("rejects non-string scalar and array element values", () => {
    const badScalar = translation() as unknown as Record<string, unknown>;
    badScalar.title = 42;
    expect(() => validateBackfillTranslation(demoReport, badScalar)).toThrow("title");

    const badElement = translation();
    badElement.claims[0] = 42 as unknown as string;
    expect(() => validateBackfillTranslation(demoReport, badElement)).toThrow(/"claims"[\s\S]*0/);
  });
});
