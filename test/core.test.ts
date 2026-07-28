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
import { withoutTerminalFullStop } from "../src/text";
import { historyPresentation } from "../worker/history";
import {
  decodeHistoryCursor,
  encodeHistoryCursor,
  normalizeTargetUrl,
  targetKey
} from "../worker/publication";

describe("report presentation copy", () => {
  it("removes only terminal Chinese full stops", () => {
    expect(withoutTerminalFullStop(`流程時使用\u3002`)).toBe("流程時使用");
    expect(withoutTerminalFullStop(`先確認\u3002再執行`)).toBe(`先確認\u3002再執行`);
  });

  it("keeps the example focused on transferable thinking before installation", () => {
    expect(demoReport.targetUrl).toContain("/skills/skill-creator");
    expect(demoReport.targetUrl).not.toContain("antfu");
    expect(demoReport.verdict).toContain("不必急著安裝");
    expect(demoReport.adoption.some((item) => item.includes("聊天 AI"))).toBe(true);
    expect(demoReport.degraded).toEqual([]);
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
