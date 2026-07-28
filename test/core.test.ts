import { afterEach, describe, expect, it, vi } from "vitest";
import { demoReport } from "../worker/demo";
import { publicConfig, resolveAppMode } from "../worker/index";
import { pilotOccupation } from "../worker/occupations";
import { modelResultSchema } from "../worker/schema";
import { assertSafePublicUrl, verifyTurnstile } from "../worker/security";
import { normalizeSourceUrl, selectCaptureSources } from "../worker/job-sources";
import { assembleReport } from "../worker/services";
import type { AppEnv } from "../worker/types";
import { withoutTerminalFullStop } from "../src/text";
import { historyPresentation } from "../worker/history";

describe("report presentation copy", () => {
  it("removes only terminal Chinese full stops", () => {
    expect(withoutTerminalFullStop(`流程時使用\u3002`)).toBe("流程時使用");
    expect(withoutTerminalFullStop(`先確認\u3002再執行`)).toBe(`先確認\u3002再執行`);
  });
});

describe("history presentation", () => {
  it("uses a GitHub repository name instead of the host", () => {
    expect(historyPresentation("https://github.com/antfu/antfu.me/tree/main")).toMatchObject({
      displayName: "antfu.me",
      sourceHost: "github.com",
      skillLabels: []
    });
  });

  it("uses the captured website title and extracted skills", () => {
    const report = JSON.stringify({
      framework: { name: "可檢查的設計工程。" },
      sources: [
        {
          url: "https://antfu.me/",
          title: "Anthony Fu"
        }
      ],
      professionalDelta: [
        {
          manifestation: "author_specific_extension",
          competency: { label: "Design systems。" }
        }
      ]
    });
    expect(historyPresentation("https://antfu.me", report)).toEqual({
      displayName: "Anthony Fu",
      sourceHost: "antfu.me",
      skillLabels: ["可檢查的設計工程", "Design systems"]
    });
  });

  it("falls back safely when an older report cannot be parsed", () => {
    expect(historyPresentation("https://my-cool-site.dev", "{")).toMatchObject({
      displayName: "My Cool Site",
      skillLabels: []
    });
  });
});

describe("public URL safety", () => {
  it("accepts a public HTTPS URL", () => {
    expect(assertSafePublicUrl("https://antfu.me").hostname).toBe("antfu.me");
  });

  it.each([
    "http://example.com",
    "https://localhost/admin",
    "https://127.0.0.1",
    "https://169.254.169.254/latest/meta-data",
    "https://example.com:8443"
  ])("blocks unsafe target %s", (url) => {
    expect(() => assertSafePublicUrl(url)).toThrow();
  });
});

describe("Turnstile verification", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects a valid production token issued for a different action", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          success: true,
          hostname: "skill-reverse.6991hugo.workers.dev",
          action: "different_action"
        })
      )
    );

    await expect(
      verifyTurnstile(
        "token",
        new Request("https://skill-reverse.6991hugo.workers.dev/api/jobs"),
        { TURNSTILE_SECRET_KEY: "production-secret" } as AppEnv
      )
    ).resolves.toEqual({ success: false, code: "turnstile_action_mismatch" });
  });
});

describe("supporting source selection", () => {
  it("normalizes fragments and prioritizes GitHub then same-origin sources", () => {
    expect(normalizeSourceUrl("https://example.com/guide#section")).toBe(
      "https://example.com/guide"
    );
    expect(
      selectCaptureSources("https://example.com", [
        "https://third-party.example/story",
        "https://example.com/about",
        "https://github.com/owner/repo",
        "https://example.com/work"
      ])
    ).toEqual([
      "https://github.com/owner/repo",
      "https://example.com/about",
      "https://example.com/work"
    ]);
  });
});

describe("deployment lock", () => {
  it("stays locked until the setup secret is explicitly true", () => {
    expect(resolveAppMode({ APP_MODE: "locked" } as AppEnv)).toBe("locked");
    expect(
      resolveAppMode({ APP_MODE: "locked", SETUP_COMPLETE: "false" } as AppEnv)
    ).toBe("locked");
    expect(
      resolveAppMode({ APP_MODE: "locked", SETUP_COMPLETE: "true" } as AppEnv)
    ).toBe("public");
    expect(resolveAppMode({ APP_MODE: "demo" } as AppEnv)).toBe("demo");
  });

  it("keeps owner budget policy out of the public configuration", () => {
    expect(
      publicConfig({
        APP_MODE: "locked",
        SETUP_COMPLETE: "true",
        TURNSTILE_SITE_KEY: "public-site-key",
        JOB_USD_LIMIT: "0.50",
        DAILY_USD_LIMIT: "5.00"
      } as AppEnv)
    ).toEqual({
      mode: "public",
      turnstileSiteKey: "public-site-key"
    });
  });
});

describe("evidence-aware report assembly", () => {
  const baseModel = modelResultSchema.parse({
    title: "A report",
    verdict: "Useful with limits",
    framework: {
      name: "Conditional craft",
      summary: "Turn observations into conditional rules.",
      useWhen: "Evidence exists.",
      avoidWhen: "Only screenshots exist.",
      steps: [
        { title: "Observe", instruction: "When repeated, record it.", failureType: "omission" },
        {
          title: "Condition",
          instruction: "When context changes, state the predicate.",
          failureType: "conditional"
        }
      ]
    },
    author: { name: "Unknown", background: "Unverified", context: "Limited sources" },
    observations: [{ text: "A visible feature", sourceUrls: ["https://example.com"] }],
    claims: [
      {
        text: "An uncited claim",
        status: "verified",
        confidence: 99,
        evidenceUrls: ["https://third-party.example/story"],
        score: {
          directness: 30,
          firstParty: 20,
          corroboration: 20,
          temporalFit: 15,
          reproducibility: 15,
          contradictionPenalty: 0
        }
      }
    ],
    professionalDelta: [],
    adoption: [],
    caveats: []
  });

  it("downgrades verified claims without first-party evidence", () => {
    const report = assembleReport({
      id: "test",
      targetUrl: "https://example.com",
      occupation: pilotOccupation,
      model: baseModel,
      captured: [
        {
          id: "source-1",
          url: "https://example.com",
          title: "Example",
          markdown: "# Example",
          excerpt: "Example",
          r2Key: "jobs/test/source-1.md"
        }
      ],
      posts: [],
      citations: [],
      degraded: []
    });
    expect(report.claims[0].status).toBe("supported_inference");
    expect(report.claims[0].confidence).toBe(100);
  });

  it("defaults absent professional evidence to not observable", () => {
    const report = assembleReport({
      id: "test",
      targetUrl: "https://example.com",
      occupation: pilotOccupation,
      model: baseModel,
      captured: [
        {
          id: "source-1",
          url: "https://example.com",
          title: "Example",
          markdown: "# Example",
          excerpt: "Example",
          r2Key: "jobs/test/source-1.md"
        }
      ],
      posts: [],
      citations: [],
      degraded: []
    });
    expect(report.professionalDelta.every((item) => item.manifestation === "not_observable")).toBe(
      true
    );
  });
});

describe("demo dossier", () => {
  it("keeps every competency traceable to O*NET 30.3", () => {
    for (const delta of demoReport.professionalDelta) {
      expect(delta.competency.sourceUri).toMatch(/^https:\/\/www\.onetonline\.org\//);
    }
    expect(demoReport.occupation.version).toBe("30.3");
  });
});
