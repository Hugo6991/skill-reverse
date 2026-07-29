import { afterEach, describe, expect, it, vi } from "vitest";
import { authorizeAdmin, resetAccessCertificateCacheForTest } from "../worker/access";
import { demoReport } from "../worker/demo";
import { publicConfig, resolveAppMode } from "../worker/index";
import { pilotOccupation } from "../worker/occupations";
import { modelResultSchema } from "../worker/schema";
import { assertSafePublicUrl, verifyTurnstile } from "../worker/security";
import { normalizeSourceUrl, selectCaptureSources } from "../worker/job-sources";
import {
  assembleReport,
  runOpenRouterSynthesis,
  runPerplexityResearch
} from "../worker/services";
import type { AppEnv } from "../worker/types";
import { cleanDisplayTitle, withoutTerminalFullStop } from "../src/text";
import { historyPresentation } from "../worker/history";
import {
  decodeHistoryCursor,
  encodeHistoryCursor,
  normalizeTargetUrl,
  targetKey
} from "../worker/publication";
import { computeGameProfile } from "../worker/game-profile";
import { ReportUpgradeError, upgradeStoredReport } from "../worker/report-compat";

describe("report presentation copy", () => {
  it("removes only terminal Chinese full stops", () => {
    expect(withoutTerminalFullStop(`流程時使用\u3002`)).toBe("流程時使用");
    expect(withoutTerminalFullStop(`先確認\u3002再執行`)).toBe(`先確認\u3002再執行`);
  });

  it("keeps result titles open by removing corner brackets", () => {
    expect(cleanDisplayTitle("從 skill 提煉「先驗證，再封裝」")).toBe(
      "從 skill 提煉 先驗證，再封裝"
    );
  });

  it("keeps the example focused on transferable thinking before installation", () => {
    expect(demoReport.targetUrl).toContain("/skills/skill-creator");
    expect(demoReport.targetUrl).not.toContain("antfu");
    expect(demoReport.verdict).toContain("不必急著安裝");
    expect(demoReport.adoption.some((item) => item.includes("聊天 AI"))).toBe(true);
    expect(demoReport.degraded).toEqual([]);
  });
});

describe("deterministic game profile", () => {
  it("upgrades legacy stored reports without changing the source payload", () => {
    const { gameProfile: _gameProfile, ...legacyReport } = demoReport;
    const upgraded = upgradeStoredReport(legacyReport);

    expect(upgraded.gameProfile).toEqual(computeGameProfile(legacyReport));
    expect("gameProfile" in legacyReport).toBe(false);
  });

  it("replaces historical v1 labels when a stored report is read", () => {
    const legacy = {
      ...demoReport,
      gameProfile: {
        rubricVersion: "game-profile-v1.1",
        axes: demoReport.gameProfile.axes,
        archetypeId: "all_aura",
        roastId: "all_aura",
        badges: demoReport.gameProfile.badges,
        strongestAxisId: "spectacle",
        weakestAxisId: "potency",
        author: demoReport.gameProfile.author
      }
    };
    const upgraded = upgradeStoredReport(legacy);
    expect(upgraded.gameProfile.rubricVersion).toBe("game-profile-v2");
    expect(upgraded.gameProfile.identity.title).not.toBe("法相驚人");
    expect("archetypeId" in upgraded.gameProfile).toBe(false);
  });

  it("rejects malformed legacy reports instead of returning an unsafe partial result", () => {
    expect(() => upgradeStoredReport({ id: "broken" })).toThrow(ReportUpgradeError);
  });

  it("returns the same destiny for the same report signals", () => {
    const first = computeGameProfile(demoReport);
    const second = computeGameProfile(demoReport);
    expect(first).toEqual(second);
    expect(first.axes.every((axis) => axis.value === undefined || axis.value % 5 === 0)).toBe(true);
  });

  it("leaves renown unknown when repository reach cannot be observed", () => {
    const profile = computeGameProfile({
      ...demoReport,
      sources: demoReport.sources
        .filter((source) => source.kind !== "x_post")
        .map(({ repositoryMetrics: _repositoryMetrics, ...source }) => source)
    });
    expect(profile.axes.find((axis) => axis.id === "renown")).toMatchObject({
      value: undefined,
      coverage: 15
    });
  });

  it("scores official repositories from verified reach instead of brand recognition", () => {
    const axis = computeGameProfile(demoReport).axes.find((item) => item.id === "renown");
    expect(axis).toMatchObject({
      value: 80,
      coverage: 80,
      signalIds: ["publisher_repository", "github_stars", "github_forks"]
    });
    expect(axis?.signalDetails).toEqual([
      expect.objectContaining({ id: "publisher_repository", points: 15, maxPoints: 15 }),
      expect.objectContaining({ id: "github_stars", value: 164_700, points: 40, maxPoints: 40 }),
      expect.objectContaining({ id: "github_forks", value: 19_600, points: 25, maxPoints: 25 })
    ]);
    const profile = computeGameProfile(demoReport);
    expect(profile.rubricVersion).toBe("game-profile-v2");
    expect(profile.identity.title).not.toMatch(/法相驚人|法相萬千/);
    expect(profile.highlightAxisId).not.toBe("activation");
    expect(profile.riskAxisId).toBe("activation");
  });

  it("does not let source count, summary length, or generic steps inflate spectacle", () => {
    const baseline = computeGameProfile(demoReport).axes.find(
      (axis) => axis.id === "spectacle"
    )?.value;
    const profile = computeGameProfile({
      ...demoReport,
      framework: {
        ...demoReport.framework,
        summary: `${demoReport.framework.summary}${" 同一段內容".repeat(30)}`,
        steps: [
          ...demoReport.framework.steps,
          ...Array.from({ length: 3 }, (_, index) => ({
            title: `步驟 ${index}`,
            instruction: "執行既有方法",
            failureType: "discipline" as const
          }))
        ]
      },
      sources: [
        ...demoReport.sources,
        ...Array.from({ length: 4 }, (_, index) => ({
          id: `extra-${index}`,
          url: `https://example.com/${index}`,
          kind: "article" as const,
          status: "verified_at_retrieval" as const,
          title: `Extra ${index}`,
          retrievedAt: demoReport.generatedAt
        }))
      ]
    });
    expect(profile.axes.find((axis) => axis.id === "spectacle")?.value).toBe(baseline);
  });

  it("does not feed presentation or cost dimensions back into claim confidence", () => {
    const before = demoReport.claims.map((claim) => claim.confidence);
    const profile = computeGameProfile({
      ...demoReport,
      framework: {
        ...demoReport.framework,
        summary: `${demoReport.framework.summary} SDK plugin install dependency framework agent`
      },
      sources: [
        ...demoReport.sources,
        {
          id: "social-extra",
          url: "https://x.com/example/status/1",
          kind: "x_post",
          status: "verified_at_retrieval",
          title: "Public discussion",
          retrievedAt: demoReport.generatedAt
        }
      ]
    });
    expect(profile.axes.find((axis) => axis.id === "activation")?.value).toBeGreaterThan(
      demoReport.gameProfile.axes.find((axis) => axis.id === "activation")?.value ?? 0
    );
    expect(demoReport.claims.map((claim) => claim.confidence)).toEqual(before);
  });

  it("requires a unique title and prefers a less-used visual motif", () => {
    const evidenceUrl = demoReport.sources[0].url;
    const candidates = [
      {
        title: "來源鍛造心法",
        oneLiner: "能把來源整理成方法，但仍需要逐項核對",
        traits: ["來源可查", "方法清楚", "需要核對"] as [string, string, string],
        motifId: "forge" as const,
        evidenceUrls: [evidenceUrl]
      },
      {
        title: "條件守門心法",
        oneLiner: "能守住適用條件，但每次採用前都要檢查前提",
        traits: ["條件先行", "保留取捨", "逐次檢查"] as [string, string, string],
        motifId: "shield" as const,
        evidenceUrls: [evidenceUrl]
      },
      {
        title: "證據編排心法",
        oneLiner: "能串起證據與結論，但來源不足時必須保留未知",
        traits: ["證據分層", "結論可查", "保留未知"] as [string, string, string],
        motifId: "lens" as const,
        evidenceUrls: [evidenceUrl]
      }
    ];
    const profile = computeGameProfile(demoReport, candidates, {
      usedTitles: ["來源鍛造心法"],
      motifUsage: { shield: 5, lens: 0 }
    });

    expect(profile.identity).toMatchObject({
      title: "證據編排心法",
      motifId: "lens",
      source: "generated"
    });
    expect(profile.identity.evidenceUrls).toEqual([evidenceUrl]);
  });

  it("uses a traceable report-derived fallback instead of stock copy", () => {
    const profile = computeGameProfile(demoReport, []);
    expect(profile.identity.source).toBe("fallback");
    expect(profile.identity.evidenceUrls.length).toBeGreaterThan(0);
    expect(profile.identity.title).not.toMatch(/法相驚人|法相萬千/);
    expect(new Set(profile.identity.traits).size).toBe(3);
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
      framework: { name: "可檢查的「設計工程」。" },
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

describe("public archive URL and cursor normalization", () => {
  it("matches equivalent public target URLs without collapsing the path", () => {
    expect(targetKey("https://WWW.Example.com/guide/?utm_source=test#intro")).toBe(
      "https://example.com/guide"
    );
    expect(normalizeTargetUrl("https://example.com/Guide")).toBe(
      "https://example.com/Guide"
    );
  });

  it("round-trips an opaque stable history cursor", () => {
    const cursor = {
      publishedAt: "2026-07-28T12:00:00.000Z",
      jobId: "job-123"
    };
    expect(decodeHistoryCursor(encodeHistoryCursor(cursor))).toEqual(cursor);
    expect(decodeHistoryCursor("not-a-cursor")).toBeUndefined();
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

describe("Cloudflare Access owner verification", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetAccessCertificateCacheForTest();
  });

  it("verifies the Access signature, issuer and audience", async () => {
    const keys = (await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256"
      },
      true,
      ["sign", "verify"]
    )) as CryptoKeyPair;
    const publicJwk = (await crypto.subtle.exportKey("jwk", keys.publicKey)) as JsonWebKey & {
      kid?: string;
    };
    publicJwk.kid = "owner-key";

    const encode = (value: unknown) => {
      const bytes = new TextEncoder().encode(JSON.stringify(value));
      let binary = "";
      bytes.forEach((byte) => {
        binary += String.fromCharCode(byte);
      });
      return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
    };
    const header = encode({ alg: "RS256", kid: "owner-key" });
    const claims = encode({
      aud: ["owner-aud"],
      email: "owner@example.com",
      exp: Math.floor(Date.now() / 1000) + 300,
      iss: "https://owner.cloudflareaccess.com"
    });
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      keys.privateKey,
      new TextEncoder().encode(`${header}.${claims}`)
    );
    let signatureBinary = "";
    new Uint8Array(signature).forEach((byte) => {
      signatureBinary += String.fromCharCode(byte);
    });
    const token = `${header}.${claims}.${btoa(signatureBinary)
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "")}`;

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ keys: [publicJwk] }))
    );
    const result = await authorizeAdmin(
      new Request("https://skill-reverse.vibeencode.dev/api/admin/reports", {
        headers: { "Cf-Access-Jwt-Assertion": token }
      }),
      {
        APP_MODE: "public",
        CF_ACCESS_TEAM_DOMAIN: "owner.cloudflareaccess.com",
        CF_ACCESS_AUD: "owner-aud",
        CF_ACCESS_ALLOWED_EMAIL: "owner@example.com"
      } as AppEnv
    );
    expect(result).toMatchObject({
      ok: true,
      claims: { email: "owner@example.com" }
    });
    await expect(
      authorizeAdmin(
        new Request("https://skill-reverse.vibeencode.dev/api/admin/reports", {
          headers: { "Cf-Access-Jwt-Assertion": token }
        }),
        {
          APP_MODE: "public",
          CF_ACCESS_TEAM_DOMAIN: "owner.cloudflareaccess.com",
          CF_ACCESS_AUD: "different-aud",
          CF_ACCESS_ALLOWED_EMAIL: "owner@example.com"
        } as AppEnv
      )
    ).resolves.toMatchObject({
      ok: false,
      status: 401,
      code: "admin_auth_rejected"
    });
  });

  it("rejects a signed Access token for a different identity", async () => {
    const keys = (await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256"
      },
      true,
      ["sign", "verify"]
    )) as CryptoKeyPair;
    const publicJwk = (await crypto.subtle.exportKey("jwk", keys.publicKey)) as JsonWebKey & {
      kid?: string;
    };
    publicJwk.kid = "intruder-key";
    const encode = (value: unknown) =>
      btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replaceAll("=", "");
    const header = encode({ alg: "RS256", kid: "intruder-key" });
    const claims = encode({
      aud: "owner-aud",
      email: "intruder@example.com",
      exp: Math.floor(Date.now() / 1000) + 300,
      iss: "https://owner.cloudflareaccess.com"
    });
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      keys.privateKey,
      new TextEncoder().encode(`${header}.${claims}`)
    );
    const token = `${header}.${claims}.${btoa(
      String.fromCharCode(...new Uint8Array(signature))
    )
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "")}`;

    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ keys: [publicJwk] })));
    await expect(
      authorizeAdmin(
        new Request("https://skill-reverse.vibeencode.dev/api/admin/reports", {
          headers: { "Cf-Access-Jwt-Assertion": token }
        }),
        {
          APP_MODE: "public",
          CF_ACCESS_TEAM_DOMAIN: "owner.cloudflareaccess.com",
          CF_ACCESS_AUD: "owner-aud",
          CF_ACCESS_ALLOWED_EMAIL: "owner@example.com"
        } as AppEnv
      )
    ).resolves.toMatchObject({
      ok: false,
      status: 401,
      code: "admin_auth_rejected"
    });
  });

  it("fails closed when owner access is not configured", async () => {
    await expect(
      authorizeAdmin(new Request("https://example.com/api/admin/reports"), {
        APP_MODE: "public"
      } as AppEnv)
    ).resolves.toMatchObject({
      ok: false,
      status: 503,
      code: "admin_not_configured"
    });
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
        confidence: 100,
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
    identityCandidates: [
      {
        title: "條件鍛造心法",
        oneLiner: "能把觀察改寫成條件規則，但需要先取得可核對的來源",
        traits: ["條件先行", "來源可查", "逐項驗證"],
        motifId: "forge",
        evidenceUrls: ["https://example.com"]
      },
      {
        title: "觀察校準訣",
        oneLiner: "能分開事實與推論，但在只有截圖時必須停止判斷",
        traits: ["事實分層", "保留未知", "避免腦補"],
        motifId: "lens",
        evidenceUrls: ["https://example.com"]
      },
      {
        title: "脈絡守門譜",
        oneLiner: "能把適用情境說清楚，但代價是每次都要檢查前提",
        traits: ["脈絡明確", "標出取捨", "可作基線"],
        motifId: "shield",
        evidenceUrls: ["https://example.com"]
      }
    ],
    adoption: [],
    caveats: []
  });
  const researchDraft = {
    researchSummary: baseModel.verdict,
    frameworkHypothesis: baseModel.framework,
    authorContext: baseModel.author,
    observations: baseModel.observations,
    candidateClaims: baseModel.claims.map((claim) => ({
      text: claim.text,
      confidence: "high" as const,
      evidenceUrls: claim.evidenceUrls
    })),
    professionalSignals: baseModel.professionalDelta,
    adoptionIdeas: baseModel.adoption,
    caveats: baseModel.caveats
  };

  it("rejects evidence confidence that differs from the component sum", () => {
    expect(
      modelResultSchema.safeParse({
        ...baseModel,
        claims: [{ ...baseModel.claims[0], confidence: 75 }]
      }).success
    ).toBe(false);
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

  it("uses an OpenAI model through OpenRouter for final structured synthesis", async () => {
    const synthesized = {
      ...baseModel,
      author: { ...baseModel.author, handle: "" },
      title: "OpenAI reviewed report"
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(synthesized) }, finish_reason: "stop" }],
          usage: { cost: 0.041 }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const result = await runOpenRouterSynthesis(
      {
        OPENROUTER_API_KEY: "test-only",
        PUBLIC_APP_URL: "https://skill-reverse.vibeencode.dev",
        OPENROUTER_SYNTHESIS_MODEL: "openai/gpt-5.6-terra"
      } as AppEnv,
      "https://example.com",
      pilotOccupation,
      [
        {
          id: "source-1",
          url: "https://example.com",
          title: "Example",
          markdown: "# Example",
          excerpt: "Example",
          r2Key: "jobs/test/source-1.md"
        }
      ],
      researchDraft,
      ["https://example.com"]
    );

    expect(result.result.title).toBe("OpenAI reviewed report");
    expect(result.estimatedCents).toBe(5);
    const request = fetchMock.mock.calls[0];
    expect(request[0]).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect((request[1] as RequestInit).headers).toMatchObject({
      "http-referer": "https://skill-reverse.vibeencode.dev"
    });
    const body = JSON.parse(String((request[1] as RequestInit).body));
    expect(body).toMatchObject({
      model: "openai/gpt-5.6-terra",
      provider: { require_parameters: true },
      response_format: { type: "json_schema" }
    });
  });

  it("classifies truncated Perplexity output before attempting JSON parsing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "pplx-request",
          choices: [
            {
              message: { content: `{"researchSummary":"cut off` },
              finish_reason: "length"
            }
          ],
          usage: {
            total_tokens: 4_000,
            cost: { total_cost: 0.02 }
          }
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    await expect(
      runPerplexityResearch(
        { PERPLEXITY_API_KEY: "test-only" } as AppEnv,
        "https://example.com",
        pilotOccupation,
        [
          {
            id: "source-1",
            url: "https://example.com",
            title: "Example",
            markdown: "# Example",
            excerpt: "Example",
            r2Key: "jobs/test/source-1.md"
          }
        ],
        []
      )
    ).rejects.toMatchObject({
      code: "provider_output_truncated",
      retryable: true
    });
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
