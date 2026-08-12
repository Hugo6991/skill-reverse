import { describe, expect, it } from "vitest";
import { demoReport } from "../worker/demo";
import { durationBucket } from "../worker/analytics";
import {
  homeSeoPage,
  llmsText,
  privacySeoPage,
  renderSeoShell,
  reportSeoPage,
  robotsText,
  sitemapXml
} from "../worker/seo";

const template = `<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta name="robots" content="index,follow" />
    <meta name="description" content="fallback" />
    <title>Fallback</title>
    <!--seo:head-->
  </head>
  <body><div id="root"></div></body>
</html>`;

describe("analytics lifecycle helpers", () => {
  it("uses low-cardinality duration buckets", () => {
    const from = "2026-07-30T00:00:00.000Z";
    expect(durationBucket(from, "2026-07-30T00:00:08.000Z")).toBe("under_10s");
    expect(durationBucket(from, "2026-07-30T00:02:00.000Z")).toBe("1_2m");
    expect(durationBucket(from, "2026-07-30T00:12:00.000Z")).toBe("10m_plus");
    expect(durationBucket(undefined)).toBeUndefined();
  });
});

describe("SEO rendering", () => {
  it("renders an indexable localized homepage with canonical and nonce", () => {
    const html = renderSeoShell(
      template,
      homeSeoPage("zh-TW", [
        {
          id: "featured-report",
          title: "一份公開研究",
          summary: "有來源支持的研究摘要"
        }
      ]),
      "https://skill-reverse.vibeencode.dev",
      "nonce123"
    );
    expect(html).toContain('<html lang="zh-TW">');
    expect(html).toContain('name="robots" content="index,follow"');
    expect(html).toContain('rel="canonical"');
    expect(html).toContain("lang=zh-TW");
    expect(html).toContain('nonce="nonce123"');
    expect(html).toContain("<h1>");
    expect(html).toContain("AI Skill 作者、方法、證據與風險拆解");
    expect(html).toContain("先別收藏 Skill，先取走它的思考");
    expect(html).toContain("/reports/featured-report?lang=zh-TW");
    expect(html).toContain("有來源支持的研究摘要");
    expect(html).not.toContain("noindex");
  });

  it("renders report title, summary and date as semantic HTML", () => {
    const html = renderSeoShell(
      template,
      reportSeoPage(demoReport, "zh-TW", "2026-07-30T00:00:00.000Z"),
      "https://skill-reverse.vibeencode.dev",
      "nonce456"
    );
    expect(html).toContain(`<h1>${demoReport.title}</h1>`);
    expect(html).toContain(demoReport.framework.name);
    expect(html).toContain(demoReport.framework.useWhen);
    expect(html).toContain(demoReport.framework.avoidWhen);
    expect(html).toContain(demoReport.claims[0].text);
    expect(html).toContain(demoReport.sources[0].url);
    expect(html).toContain(demoReport.caveats[0]);
    expect(html).toContain("<article>");
    expect(html).toContain("datePublished");
    expect(html).toContain("og:type");
  });

  it("renders an indexable bilingual privacy notice with clear provider boundaries", () => {
    const english = renderSeoShell(
      template,
      privacySeoPage("en"),
      "https://skill-reverse.vibeencode.dev",
      "privacy123"
    );
    expect(english).toContain("Privacy and data use");
    expect(english).toContain("GA4 loads only after explicit consent");
    expect(english).toContain("current page URL, IP address");
    expect(english).toContain("retained for 14 months");
    expect(english).toContain("not added as custom event properties");
    expect(english).toContain("https://policies.google.com/technologies/partner-sites");
    expect(english).toContain("https://support.google.com/analytics/answer/7318509?hl=en-uk");
    expect(english).toContain("Google Analytics privacy disclosures policy");
    expect(english).toContain("Clarity, session replay, and Mixpanel are not enabled now");
    expect(english).toContain("Cloudflare RUM");
    expect(english).toContain("operational logs may still be processed");
    expect(english).toContain("unindexed captures are kept for up to 30 days");
    expect(english).toContain("non-public artifact index");
    expect(english).toContain('name="robots" content="index,follow"');
    expect(english).toContain("/privacy?lang=en");
    expect(english).not.toContain("noindex");

    const chinese = renderSeoShell(
      template,
      privacySeoPage("zh-TW"),
      "https://skill-reverse.vibeencode.dev",
      "privacy456"
    );
    expect(chinese).toContain("隱私與資料使用");
    expect(chinese).toContain("GA4 只有在明確同意後才載入");
    expect(chinese).toContain("提供這項服務或工作坊的原管道");
  });

  it("keeps private routes out of robots and publishes only explicit sitemap paths", () => {
    const robots = robotsText("https://skill-reverse.vibeencode.dev");
    expect(robots).toContain("User-agent: OAI-SearchBot");
    expect(robots).toContain("User-agent: PerplexityBot");
    expect(robots).toContain("Disallow: /jobs");
    expect(robots).toContain("Disallow: /collection");
    expect(robots).toContain("Disallow: /admin");
    const sitemap = sitemapXml("https://skill-reverse.vibeencode.dev", ["report-safe"]);
    expect(sitemap).toContain("/privacy?lang=zh-TW");
    expect(sitemap).toContain("/reports/report-safe");
    expect(sitemap).toContain("/reports/demo");
    expect(sitemap).toContain("hreflang=\"en\"");
    expect(sitemap).not.toContain("/jobs/");
    expect(sitemap).not.toContain("/collection");
  });

  it("publishes a curated LLM index without private routes", () => {
    const output = llmsText("https://skill-reverse.vibeencode.dev", [
      {
        id: "report-one",
        title: "Evidence [first]",
        summary: "A concise\npublic summary"
      }
    ]);
    expect(output).toContain("# Skill Reverse");
    expect(output).toContain("## Start here");
    expect(output).toContain("/reports/report-one?lang=zh-TW");
    expect(output).toContain("Evidence \\[first\\]");
    expect(output).toContain("A concise public summary");
    expect(output).not.toContain("/admin");
    expect(output).not.toContain("/collection");
  });
});
