import { describe, expect, it } from "vitest";
import { demoReport } from "../worker/demo";
import { durationBucket } from "../worker/analytics";
import {
  homeSeoPage,
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
      homeSeoPage("zh-TW"),
      "https://skill-reverse.vibeencode.dev",
      "nonce123"
    );
    expect(html).toContain('<html lang="zh-TW">');
    expect(html).toContain('name="robots" content="index,follow"');
    expect(html).toContain('rel="canonical"');
    expect(html).toContain("lang=zh-TW");
    expect(html).toContain('nonce="nonce123"');
    expect(html).toContain("<h1>");
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
    expect(html).toContain("<article>");
    expect(html).toContain("datePublished");
    expect(html).toContain("og:type");
  });

  it("keeps private routes out of robots and publishes only explicit sitemap paths", () => {
    const robots = robotsText("https://skill-reverse.vibeencode.dev");
    expect(robots).toContain("Disallow: /jobs");
    expect(robots).toContain("Disallow: /collection");
    expect(robots).toContain("Disallow: /admin");
    const sitemap = sitemapXml("https://skill-reverse.vibeencode.dev", ["report-safe"]);
    expect(sitemap).toContain("/reports/report-safe");
    expect(sitemap).toContain("/reports/demo");
    expect(sitemap).toContain("hreflang=\"en\"");
    expect(sitemap).not.toContain("/jobs/");
    expect(sitemap).not.toContain("/collection");
  });
});
