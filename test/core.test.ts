import { afterEach, describe, expect, it, vi } from "vitest";
import { authorizeAdmin, resetAccessCertificateCacheForTest } from "../worker/access";
import { demoReport } from "../worker/demo";
import { publicConfig, resolveAppMode } from "../worker/index";
import { pilotOccupation } from "../worker/occupations";
import { modelResultSchema, researchDraftSchema } from "../worker/schema";
import { assertSafePublicUrl, verifyTurnstile } from "../worker/security";
import { normalizeSourceUrl, selectCaptureSources } from "../worker/job-sources";
import {
  applyReportTranslation,
  assembleReport,
  fetchSocialEvidence,
  inferCreatorIdentity,
  draftToModelResult,
  runOpenRouterSynthesis,
  runOpenRouterTranslation,
  runPerplexityResearch
} from "../worker/services";
import { providerErrorDetails } from "../worker/provider-ledger";
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
import {
  englishIdentityTitle,
  GAME_IDENTITY_VERSION,
  isFourBeatTitle
} from "../worker/game-identity";

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

  it("chooses a unique evidence-backed title while keeping the method type stable", () => {
    const evidenceUrl = demoReport.sources[0].url;
    const fallback = computeGameProfile(demoReport).identity;
    const candidate = (title: string) => ({
      title,
      primaryMethodTypeId: fallback.primaryMethodTypeId,
      secondaryMethodTypeId: fallback.secondaryMethodTypeId,
      titleRationale: [
        {
          segment: Array.from(title).slice(0, 2).join(""),
          explanation: "前半對應方法面對的情境",
          evidenceRefs: ["framework.summary"]
        },
        {
          segment: Array.from(title).slice(2).join(""),
          explanation: "後半對應方法反覆採取的行動",
          evidenceRefs: ["framework.step.1"]
        }
      ] as [
        { segment: string; explanation: string; evidenceRefs: string[] },
        { segment: string; explanation: string; evidenceRefs: string[] }
      ],
      signatureMove: "它先找出反覆問題，再用真實案例驗證。",
      strength: "把主觀判斷轉成可以反覆核對的流程。",
      shadow: "第一次碰到問題時，這套流程可能太早定型。",
      evidenceUrls: [evidenceUrl]
    });
    const candidates = [
      candidate("偏差定錨"),
      candidate("骨架生長"),
      candidate("步步成陣")
    ];
    const profile = computeGameProfile(demoReport, candidates, {
      usedTitles: ["偏差定錨"],
      motifUsage: { shield: 5, lens: 0 }
    });

    expect(profile.identity).toMatchObject({
      title: "骨架生長",
      identityVersion: GAME_IDENTITY_VERSION,
      source: "generated"
    });
    expect(profile.identity.primaryMethodTypeId).toBe(fallback.primaryMethodTypeId);
    expect(profile.identity.evidenceUrls).toEqual([evidenceUrl]);
  });

  it("rejects clipped AI titles instead of slicing them into fragments", () => {
    const evidenceUrl = demoReport.sources[0].url;
    const fallback = computeGameProfile(demoReport).identity;
    const invalidCandidate = (title: string) => ({
      title,
      primaryMethodTypeId: fallback.primaryMethodTypeId,
      secondaryMethodTypeId: fallback.secondaryMethodTypeId,
      titleRationale: [
        {
          segment: "錯誤",
          explanation: "無法對應標題",
          evidenceRefs: ["framework.summary"]
        },
        {
          segment: "依據",
          explanation: "無法對應標題",
          evidenceRefs: ["framework.step.1"]
        }
      ] as [
        { segment: string; explanation: string; evidenceRefs: string[] },
        { segment: string; explanation: string; evidenceRefs: string[] }
      ],
      signatureMove: "它先整理來源，再決定下一步。",
      strength: "讓方法保持可追溯與可核對。",
      shadow: "資料不足時必須保留未知。",
      evidenceUrls: [evidenceUrl]
    });
    const profile = computeGameProfile(
      demoReport,
      [
        invalidCandidate("以可編輯威脅模型為中心"),
        invalidCandidate("Evidence Grid"),
        invalidCandidate("法相驚人")
      ]
    );

    expect(profile.identity.source).toBe("fallback");
    expect(isFourBeatTitle(profile.identity.title)).toBe(true);
    expect(profile.identity.title).not.toBe("以可編輯");
  });

  it("rejects unsupported title rationale without rejecting the whole report", () => {
    const evidenceUrl = demoReport.sources[0].url;
    const fallback = computeGameProfile(demoReport).identity;
    const profile = computeGameProfile(demoReport, [
      {
        title: "偏差定錨",
        primaryMethodTypeId: fallback.primaryMethodTypeId,
        secondaryMethodTypeId: fallback.secondaryMethodTypeId,
        titleRationale: [
          {
            segment: "偏差",
            explanation: "對應方法面對的問題",
            evidenceRefs: ["invented-reference"]
          },
          {
            segment: "定錨",
            explanation: "對應反覆採取的行動",
            evidenceRefs: ["framework.summary"]
          }
        ],
        signatureMove: "它先找出基準，再逐項修正偏差。",
        strength: "讓每次調整都能回到同一標準。",
        shadow: "缺少基準時容易失去校準方向。",
        evidenceUrls: [evidenceUrl]
      }
    ]);

    expect(profile.identity.source).toBe("fallback");
    expect(profile.identity.titleRationale.flatMap((item) => item.evidenceRefs)).not.toContain(
      "invented-reference"
    );
  });

  it("names the threat-model and visual-article regressions with complete four-beat words", () => {
    const threat = computeGameProfile({
      ...demoReport,
      framework: {
        ...demoReport.framework,
        name: "以可編輯威脅模型為中心的分階段安全分析框架",
        summary: "先建立可由人調整的專案威脅模型，再依風險決定分析範圍"
      }
    });
    const visual = computeGameProfile({
      ...demoReport,
      framework: {
        ...demoReport.framework,
        name: "文章內容圖文化分段輸出",
        summary: "把長文核心轉換成適合視覺呈現的圖文段落與投影片",
        useWhen: "需要把技術文章轉譯給圖文平台受眾時。",
        avoidWhen: "必須保留完整技術語境與所有細節時。",
        steps: [
          {
            title: "抽取長文核心",
            instruction: "先找出受眾真正需要帶走的訊息。",
            failureType: "shape"
          },
          {
            title: "安排圖文節奏",
            instruction: "再依媒介與閱讀節奏完成分段轉換。",
            failureType: "conditional"
          }
        ]
      }
    });

    expect(threat.identity.primaryMethodTypeId).toBe("sentinel");
    expect(["investigator", "navigator"]).toContain(threat.identity.secondaryMethodTypeId);
    expect(threat.identity.title).toBe("危局推演");
    expect(visual.identity.primaryMethodTypeId).toBe("translator");
    expect(visual.identity.secondaryMethodTypeId).toBe("choreographer");
    expect(visual.identity.title).toBe("長文變奏");
  });

  it("uses a traceable report-derived fallback instead of stock copy", () => {
    const profile = computeGameProfile(demoReport, []);
    expect(profile.identity.source).toBe("fallback");
    expect(profile.identity.evidenceUrls.length).toBeGreaterThan(0);
    expect(profile.identity.title).not.toMatch(/法相驚人|法相萬千/);
    expect(profile.identity.beats).toHaveLength(3);
    expect(profile.identity.methodSignals.every((signal) => signal.evidenceRefs.length > 0 || signal.score === 0)).toBe(true);
  });

  it("keeps fallback titles in Chinese when the framework name is English", () => {
    const profile = computeGameProfile(
      {
        ...demoReport,
        framework: {
          ...demoReport.framework,
          name: "runicons"
        }
      },
      []
    );

    expect(profile.identity.source).toBe("fallback");
    expect(profile.identity.title).toMatch(/[\u3400-\u9fff]/u);
    expect(profile.identity.title).not.toBe("runicons");
  });
});

describe("creator identity and optional social provenance", () => {
  const artifact = (
    url: string,
    title: string,
    markdown: string,
    id = "source-1"
  ) => ({
    id,
    url,
    title,
    markdown,
    excerpt: markdown.slice(0, 120),
    r2Key: `jobs/test/${id}.md`
  });

  it("keeps an official GitHub organization as the creator and follows its first-party X link", () => {
    const primary = artifact(
      "https://github.com/anthropics/skills",
      "skills",
      "# Skills\nThis repository contains Anthropic's implementation of skills for Claude."
    );
    const profile = artifact(
      "https://github.com/anthropics",
      "Anthropic · GitHub",
      "# Anthropic\nWe've verified that the organization anthropics controls the domain:\nhttps://anthropic.com",
      "source-101"
    );
    const website = artifact(
      "https://anthropic.com",
      "Anthropic",
      "# Anthropic",
      "source-102"
    );

    expect(
      inferCreatorIdentity(
        primary.url,
        primary,
        [profile, website],
        '<a href="https://x.com/AnthropicAI">X</a>'
      )
    ).toMatchObject({
      kind: "organization",
      name: "Anthropic",
      handle: "AnthropicAI"
    });
  });

  it("supports person-owned repos and organization repos without an X account", () => {
    const personPrimary = artifact(
      "https://github.com/alice/example",
      "example",
      "By Alice — https://x.com/alice_dev"
    );
    const personProfile = artifact(
      "https://github.com/alice",
      "Alice · GitHub",
      "# Alice",
      "source-101"
    );
    expect(
      inferCreatorIdentity(personPrimary.url, personPrimary, [personProfile])
    ).toMatchObject({ kind: "person", name: "Alice", handle: "alice_dev" });

    const orgPrimary = artifact("https://github.com/acme/example", "example", "# Example");
    const orgProfile = artifact(
      "https://github.com/acme",
      "Acme · GitHub",
      "We've verified that the organization acme controls the domain: https://acme.example",
      "source-101"
    );
    expect(inferCreatorIdentity(orgPrimary.url, orgPrimary, [orgProfile])).toMatchObject({
      kind: "organization",
      name: "Acme",
      handle: undefined
    });
  });

  it("treats a missing social provider as a non-blocking degraded lane", async () => {
    const result = await fetchSocialEvidence(
      {} as AppEnv,
      { kind: "organization", name: "Anthropic", evidenceUrls: [] },
      "https://github.com/anthropics/skills"
    );
    expect(result.posts).toEqual([]);
    expect(result.degraded).toContain("research continued");
  });
});

describe("provider error classification", () => {
  it("preserves retryable codes after a workflow wrapper prefixes the error", () => {
    expect(
      providerErrorDetails(
        new Error(
          "ProviderCallError: [provider_output_truncated] Perplexity output ended with finish_reason=length"
        )
      )
    ).toMatchObject({
      code: "provider_output_truncated",
      retryable: true,
      publicMessage: "The research provider returned an incomplete result"
    });
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
  const personaCandidate = (title: string) => ({
    title,
    primaryMethodTypeId: "undetermined" as const,
    secondaryMethodTypeId: null,
    titleRationale: [
      {
        segment: Array.from(title).slice(0, 2).join(""),
        explanation: "前半描述目前可見的情境",
        evidenceRefs: ["framework.summary"]
      },
      {
        segment: Array.from(title).slice(2).join(""),
        explanation: "後半描述目前可見的行動",
        evidenceRefs: ["framework.avoidWhen"]
      }
    ] as [
      { segment: string; explanation: string; evidenceRefs: string[] },
      { segment: string; explanation: string; evidenceRefs: string[] }
    ],
    signatureMove: "它先保留方法輪廓，再等更多證據完成分類。",
    strength: "避免把有限來源包裝成確定的人格結論。",
    shadow: "需要更多可觀察步驟才能形成穩定類型。",
    evidenceUrls: ["https://example.com"]
  });
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
      personaCandidate("線索未成"),
      personaCandidate("輪廓待顯"),
      personaCandidate("脈絡未明")
    ],
    adoption: [],
    caveats: []
  });
  const researchDraft = {
    researchSummary: baseModel.verdict,
    frameworkHypothesis: baseModel.framework,
    frameworkSelection: {
      selectedBecause:
        "Repeated conditional rules make the selected framework more central than the alternatives.",
      rejectedAlternatives: [
        {
          name: "Summarize visible features",
          reason: "It describes the artifact but does not explain the reusable decision rule."
        }
      ],
      falsifier:
        "The selection is weakened if the same evidence supports only a fixed sequence with no conditional behavior.",
      evidenceUrls: ["https://example.com"]
    },
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

  it("requires a bounded internal framework selection record", () => {
    expect(researchDraftSchema.safeParse(researchDraft).success).toBe(true);
    expect(
      researchDraftSchema.safeParse({
        ...researchDraft,
        frameworkSelection: undefined
      }).success
    ).toBe(false);
    expect(
      researchDraftSchema.safeParse({
        ...researchDraft,
        frameworkSelection: {
          ...researchDraft.frameworkSelection,
          rejectedAlternatives: [
            ...researchDraft.frameworkSelection.rejectedAlternatives,
            { name: "Second", reason: "Less central." },
            { name: "Third", reason: "Also less central." }
          ]
        }
      }).success
    ).toBe(false);
  });

  it("keeps the public fallback report focused on exactly one selected framework", () => {
    const fallback = draftToModelResult(researchDraft, "https://example.com");

    expect(fallback.framework).toEqual(researchDraft.frameworkHypothesis);
    expect(fallback.title).toBe(researchDraft.frameworkHypothesis.name);
    expect("frameworkSelection" in fallback).toBe(false);
  });

  it("accepts a correctable confidence mismatch for backend normalization", () => {
    expect(
      modelResultSchema.safeParse({
        ...baseModel,
        claims: [{ ...baseModel.claims[0], confidence: 75 }]
      }).success
    ).toBe(true);
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
      claims: [{ ...baseModel.claims[0], confidence: 75 }],
      identityCandidates: baseModel.identityCandidates.map((candidate, index) =>
        index === 0
          ? {
              ...candidate,
              title: "以可編輯威脅模型為中心"
            }
          : candidate
      ),
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
    expect(result.result.claims[0].confidence).toBe(100);
    expect(result.result.identityCandidates[0].titleRationale).toHaveLength(2);
    expect(result.result.identityCandidates[0].title).toBe(
      "以可編輯威脅模型為中心"
    );
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
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
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
    const request = fetchMock.mock.calls.at(-1)!;
    const body = JSON.parse(String((request[1] as RequestInit).body));
    expect(body.max_tokens).toBe(6_000);
    expect(body.response_format.json_schema.name).toBe("reverse_research_draft_full");
    expect(body.response_format.json_schema.schema.properties.observations.maxItems).toBe(6);
    expect(body.response_format.json_schema.schema.required).toContain("frameworkSelection");
    expect(
      body.response_format.json_schema.schema.properties.frameworkSelection.properties
        .rejectedAlternatives.maxItems
    ).toBe(2);
  });

  it("rejects framework selection evidence URLs that were not supplied or cited", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ...researchDraft,
                  frameworkSelection: {
                    ...researchDraft.frameworkSelection,
                    evidenceUrls: ["https://invented.example/evidence"]
                  }
                })
              },
              finish_reason: "stop"
            }
          ]
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
      code: "provider_schema_invalid",
      retryable: true
    });
  });

  it("accepts a provider citation as framework selection evidence", async () => {
    const citationUrl = "https://citation.example/evidence";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ...researchDraft,
                  frameworkSelection: {
                    ...researchDraft.frameworkSelection,
                    evidenceUrls: [citationUrl]
                  }
                })
              },
              finish_reason: "stop"
            }
          ],
          citations: [citationUrl]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    const result = await runPerplexityResearch(
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
    );

    expect(result.result.frameworkSelection.evidenceUrls).toEqual([citationUrl]);
    expect(result.citations).toEqual([citationUrl]);
  });

  it("uses a smaller output contract for a compact retry", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: `{"researchSummary":"cut off` }, finish_reason: "length" }]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    const source = {
      id: "source-1",
      url: "https://example.com",
      title: "Example",
      markdown: `# Example\n${"source detail ".repeat(1_000)}`,
      excerpt: "Example",
      r2Key: "jobs/test/source-1.md"
    };

    await expect(
      runPerplexityResearch(
        { PERPLEXITY_API_KEY: "test-only" } as AppEnv,
        "https://example.com",
        pilotOccupation,
        [source],
        [],
        "untracked",
        {
          profile: "compact",
          creator: { kind: "unknown", name: "Example", evidenceUrls: [source.url] }
        }
      )
    ).rejects.toMatchObject({ code: "provider_output_truncated" });

    const request = fetchMock.mock.calls.at(-1)!;
    const body = JSON.parse(String((request[1] as RequestInit).body));
    expect(body.max_tokens).toBe(4_500);
    expect(body.response_format.json_schema.name).toBe("reverse_research_draft_compact");
    expect(body.response_format.json_schema.schema.properties.observations.maxItems).toBe(4);
    expect(
      body.response_format.json_schema.schema.properties.frameworkSelection.properties
        .rejectedAlternatives.maxItems
    ).toBe(2);
    expect(body.messages[1].content).toContain("OUTPUT PROFILE: compact");
    expect(body.messages[1].content).toContain("frameworkSelection");
    expect(body.messages[1].content).toContain("narrow bridges");
    expect(body.messages[1].content.length).toBeLessThan(10_000);
  });
});

describe("bilingual report translation", () => {
  it("keeps natural English names and repairs invalid translated titles locally", () => {
    expect(englishIdentityTitle("危局推演", "Simulate the Danger")).toBe(
      "Simulate the Danger"
    );
    expect(englishIdentityTitle("危局推演", "危局推演")).toBe(
      "Simulate the Danger"
    );
    const translation = {
      title: demoReport.title,
      verdict: demoReport.verdict,
      framework: {
        ...demoReport.framework,
        steps: demoReport.framework.steps.map(({ title, instruction }) => ({
          title,
          instruction
        }))
      },
      author: {
        background: demoReport.author.background,
        context: demoReport.author.context
      },
      gameIdentity: {
        title: "Workflow Guard",
        signatureMove: "It sets the baseline before packaging the method.",
        strength: "Repeated corrections become a testable workflow.",
        shadow: "A first-time problem may be structured too early.",
        titleRationale: [
          "The first beat describes the situation.",
          "The second beat describes the repeated action."
        ] as [string, string],
        beats: [
          "Find the recurring problem",
          "Validate it with real cases",
          "Do not package a first-time problem"
        ] as [string, string, string]
      },
      occupation: {
        title: demoReport.occupation.title,
        description: demoReport.occupation.description,
        aliases: demoReport.occupation.aliases,
        competencyLabels: demoReport.occupation.competencies.map(
          (competency) => competency.label
        )
      },
      observations: demoReport.observations.map((item) => item.text),
      claims: demoReport.claims.map((item) => item.text),
      professionalDelta: demoReport.professionalDelta.map((item) => item.rationale),
      adoption: demoReport.adoption,
      caveats: demoReport.caveats,
      degraded: demoReport.degraded
    };
    expect(
      applyReportTranslation(demoReport, translation).gameProfile.identity.title
    ).toBe("Workflow Guard");
  });

  it("classifies a truncated English translation before publishing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: `{"title":"cut off` }, finish_reason: "length" }]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    await expect(
      runOpenRouterTranslation(
        {
          OPENROUTER_API_KEY: "test-only",
          PUBLIC_APP_URL: "https://skill-reverse.vibeencode.dev",
          OPENROUTER_SYNTHESIS_MODEL: "openai/gpt-5.6-terra"
        } as AppEnv,
        demoReport
      )
    ).rejects.toMatchObject({ code: "provider_output_truncated", retryable: true });
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
