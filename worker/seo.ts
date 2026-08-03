import type { Locale, ReverseReport } from "../src/types";

export interface SeoPage {
  locale: Locale;
  title: string;
  description: string;
  canonicalPath: string;
  index: boolean;
  type: "website" | "article";
  bodyHtml: string;
  publishedAt?: string;
}

export interface SeoReportLink {
  id: string;
  title: string;
  summary: string;
}

export function homeSeoPage(locale: Locale, featuredReports: SeoReportLink[] = []): SeoPage {
  const english = locale === "en";
  const featured = featuredReports.slice(0, 3);
  const featuredItems = featured.length
    ? featured
        .map(
          (report) =>
            `<li><a href="${escapeAttribute(
              localizedPath(`/reports/${encodeURIComponent(report.id)}`, locale)
            )}">${escapeHtml(report.title)}</a><p>${escapeHtml(report.summary)}</p></li>`
        )
        .join("")
    : `<li><a href="${escapeAttribute(localizedPath("/reports/demo", locale))}">${
        english
          ? "Anthropic skill-creator: evidence and adoption analysis"
          : "Anthropic skill-creator：方法、證據與採用分析"
      }</a></li>`;
  return {
    locale,
    title: english
      ? "Skill Reverse | Evidence, methods, and risks behind AI Skills"
      : "Skill Reverse｜AI Skill 作者、方法、證據與風險拆解",
    description: english
      ? "Analyze Claude Code, Codex, and GitHub Skills through creator context, transferable methods, source evidence, limitations, and adoption guidance."
      : "分析 Claude Code、Codex 與 GitHub Skills 的作者背景、核心方法、證據來源、限制與採用建議。",
    canonicalPath: "/",
    index: true,
    type: "website",
    bodyHtml: english
      ? `<main><header><h1>Understand where an AI Skill comes from, how it works, and whether to trust it before adoption</h1><p>Skill Reverse analyzes public Claude Code, Codex, and GitHub Skills through creator context, transferable methods, source evidence, limitations, and adoption guidance.</p></header><section aria-labelledby="featured-research"><h2 id="featured-research">Recent evidence-backed research</h2><ul>${featuredItems}</ul><p><a href="${escapeAttribute(
          localizedPath("/history", locale)
        )}">Browse the public research archive</a></p></section></main>`
      : `<main><header><h1>採用 AI Skill 前，先看懂它從哪裡來、如何運作、值不值得信任</h1><p>Skill Reverse 分析公開的 Claude Code、Codex 與 GitHub Skills，整理作者背景、可攜方法、來源證據、限制與採用建議。</p></header><section aria-labelledby="featured-research"><h2 id="featured-research">近期公開研究</h2><ul>${featuredItems}</ul><p><a href="${escapeAttribute(
          localizedPath("/history", locale)
        )}">瀏覽完整公開成果庫</a></p></section></main>`
  };
}

export function historySeoPage(locale: Locale): SeoPage {
  const english = locale === "en";
  return {
    locale,
    title: english ? "Published research — Skill Reverse" : "公開研究成果庫 — Skill Reverse",
    description: english
      ? "Browse published Skill Reverse research reports and reusable frameworks."
      : "瀏覽已發布的 Skill Reverse 研究報告、證據鏈與可複用框架。",
    canonicalPath: "/history",
    index: true,
    type: "website",
    bodyHtml: english
      ? "<main><h1>Published research</h1><p>Browse evidence-backed reverse-engineering reports.</p></main>"
      : "<main><h1>公開研究成果庫</h1><p>瀏覽以證據支持的反向研究報告。</p></main>"
  };
}

export function reportSeoPage(
  report: ReverseReport,
  locale: Locale,
  publishedAt?: string
): SeoPage {
  const english = locale === "en";
  const title = `${plainText(report.title)} — Skill Reverse`;
  const description = truncate(
    `${plainText(report.framework.name)}：${plainText(report.framework.summary)}`,
    160
  );
  const sourceById = new Map(report.sources.map((source) => [source.id, source]));
  const claims = report.claims
    .slice(0, 3)
    .map((claim) => {
      const sources = claim.evidenceIds
        .map((id) => sourceById.get(id))
        .filter((source): source is ReverseReport["sources"][number] => Boolean(source));
      const evidence = sources.length
        ? `<ul>${sources
            .map(
              (source) =>
                `<li><a href="${escapeAttribute(source.url)}" rel="noopener noreferrer">${escapeHtml(
                  source.title
                )}</a> <span>(${escapeHtml(source.status)}, ${escapeHtml(
                  source.retrievedAt
                )})</span></li>`
            )
            .join("")}</ul>`
        : `<p>${english ? "No public source is attached to this claim." : "這項主張目前沒有附上公開來源。"}</p>`;
      return `<li><article><h3>${escapeHtml(claim.text)}</h3><p>${
        english ? "Evidence status" : "證據狀態"
      }: ${escapeHtml(claim.status)} · ${english ? "Confidence" : "信心"}: ${claim.confidence}/100</p>${evidence}</article></li>`;
    })
    .join("");
  const caveats = report.caveats
    .slice(0, 5)
    .map((caveat) => `<li>${escapeHtml(caveat)}</li>`)
    .join("");
  const published = publishedAt ?? report.generatedAt;
  return {
    locale,
    title,
    description,
    canonicalPath: `/reports/${encodeURIComponent(report.id)}`,
    index: true,
    type: "article",
    publishedAt: published,
    bodyHtml: `<main><article><header><h1>${escapeHtml(report.title)}</h1><p><strong>${
      english ? "Decision summary" : "採用結論"
    }</strong></p><p>${escapeHtml(report.verdict)}</p></header><section aria-labelledby="framework"><h2 id="framework">${escapeHtml(
      report.framework.name
    )}</h2><p>${escapeHtml(report.framework.summary)}</p><h3>${
      english ? "Use when" : "適用情境"
    }</h3><p>${escapeHtml(report.framework.useWhen)}</p><h3>${
      english ? "Avoid when" : "不適用情境"
    }</h3><p>${escapeHtml(report.framework.avoidWhen)}</p></section>${
      claims
        ? `<section aria-labelledby="evidence-backed-claims"><h2 id="evidence-backed-claims">${
            english ? "Evidence-backed claims" : "證據支持的核心主張"
          }</h2><ol>${claims}</ol></section>`
        : ""
    }${
      caveats
        ? `<section aria-labelledby="limitations"><h2 id="limitations">${
            english ? "Limitations and cautions" : "限制與注意事項"
          }</h2><ul>${caveats}</ul></section>`
        : ""
    }<footer><p>${
      english
        ? "This report synthesizes public evidence. Open the cited sources and verify them before adoption."
        : "本報告根據公開證據整理；採用前請開啟引用來源並再次核對。"
    }</p><time datetime="${escapeAttribute(published)}">${escapeHtml(
      published
    )}</time></footer></article></main>`
  };
}

export function privateSeoPage(locale: Locale, canonicalPath: string): SeoPage {
  return {
    locale,
    title: locale === "en" ? "Skill Reverse workspace" : "Skill Reverse 研究工作台",
    description: locale === "en" ? "Private Skill Reverse workspace." : "私人研究工作區。",
    canonicalPath,
    index: false,
    type: "website",
    bodyHtml: ""
  };
}

export function renderSeoShell(
  template: string,
  page: SeoPage,
  origin: string,
  nonce: string
): string {
  const canonical = localizedUrl(origin, page.canonicalPath, page.locale);
  const zh = localizedUrl(origin, page.canonicalPath, "zh-TW");
  const en = localizedUrl(origin, page.canonicalPath, "en");
  const structuredData = {
    "@context": "https://schema.org",
    "@type": page.type === "article" ? "Article" : "WebPage",
    headline: page.title,
    description: page.description,
    url: canonical,
    inLanguage: page.locale,
    ...(page.publishedAt ? { datePublished: page.publishedAt } : {})
  };
  const head = [
    `<meta name="csp-nonce" content="${escapeAttribute(nonce)}" />`,
    `<link rel="canonical" href="${escapeAttribute(canonical)}" />`,
    `<link rel="alternate" hreflang="zh-TW" href="${escapeAttribute(zh)}" />`,
    `<link rel="alternate" hreflang="en" href="${escapeAttribute(en)}" />`,
    `<link rel="alternate" hreflang="x-default" href="${escapeAttribute(zh)}" />`,
    `<meta property="og:type" content="${page.type}" />`,
    `<meta property="og:site_name" content="Skill Reverse" />`,
    `<meta property="og:title" content="${escapeAttribute(page.title)}" />`,
    `<meta property="og:description" content="${escapeAttribute(page.description)}" />`,
    `<meta property="og:url" content="${escapeAttribute(canonical)}" />`,
    `<meta property="og:locale" content="${page.locale === "en" ? "en_US" : "zh_TW"}" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${escapeAttribute(page.title)}" />`,
    `<meta name="twitter:description" content="${escapeAttribute(page.description)}" />`,
    `<script type="application/ld+json" nonce="${escapeAttribute(nonce)}">${safeJson(
      structuredData
    )}</script>`
  ].join("\n    ");

  return template
    .replace(/<html[^>]*lang="[^"]*"[^>]*>/, `<html lang="${page.locale}">`)
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(page.title)}</title>`)
    .replace(
      /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/,
      `<meta name="description" content="${escapeAttribute(page.description)}" />`
    )
    .replace(
      /<meta\s+name="robots"\s+content="[^"]*"\s*\/?>/,
      `<meta name="robots" content="${page.index ? "index,follow" : "noindex,nofollow"}" />`
    )
    .replace("<!--seo:head-->", head)
    .replace('<div id="root"></div>', `<div id="root">${page.bodyHtml}</div>`);
}

export function robotsText(origin: string): string {
  const privatePaths = ["/admin", "/api", "/jobs", "/collection", "/c/"];
  const group = (agent: string) => [
    `User-agent: ${agent}`,
    "Allow: /",
    ...privatePaths.map((path) => `Disallow: ${path}`),
    ""
  ];
  return [
    ...group("OAI-SearchBot"),
    ...group("PerplexityBot"),
    ...group("*"),
    `Sitemap: ${origin}/sitemap.xml`,
    ""
  ].join("\n");
}

export function llmsText(origin: string, reports: SeoReportLink[]): string {
  const reportLinks = reports.slice(0, 10).map((report) => {
    const url = new URL(`/reports/${encodeURIComponent(report.id)}`, origin);
    url.searchParams.set("lang", "zh-TW");
    return `- [${markdownLabel(report.title)}](${url.toString()}): ${markdownDescription(
      report.summary
    )}`;
  });
  return [
    "# Skill Reverse",
    "",
    "> Evidence-backed analysis of public AI Skills, repositories, and methods for adoption decisions.",
    "",
    "Skill Reverse separates observations, claims, sources, supported inferences, limitations, and adoption guidance. Reports are based on public evidence and should be verified against the cited original sources before adoption.",
    "",
    "## Start here",
    "",
    `- [Skill Reverse home](${localizedUrl(origin, "/", "zh-TW")}): Analyze a public Claude Code, Codex, or GitHub Skill.`,
    `- [Public research archive](${localizedUrl(origin, "/history", "zh-TW")}): Browse published evidence-backed reports.`,
    `- [Example report](${localizedUrl(origin, "/reports/demo", "zh-TW")}): See how claims, sources, limitations, and adoption guidance are presented.`,
    "",
    ...(reportLinks.length ? ["## Recent published reports", "", ...reportLinks, ""] : []),
    "## Optional",
    "",
    `- [English home](${localizedUrl(origin, "/", "en")}): English entry point.`,
    `- [English public archive](${localizedUrl(origin, "/history", "en")}): Published reports in English when available.`,
    ""
  ].join("\n");
}

export function sitemapXml(origin: string, reportIds: string[]): string {
  const paths = ["/", "/history", "/reports/demo", ...reportIds.map((id) => `/reports/${encodeURIComponent(id)}`)];
  const urls = paths.flatMap((pathname) =>
    (["zh-TW", "en"] as const).map((locale) => {
      const loc = localizedUrl(origin, pathname, locale);
      const zh = localizedUrl(origin, pathname, "zh-TW");
      const en = localizedUrl(origin, pathname, "en");
      return `<url><loc>${escapeXml(loc)}</loc><xhtml:link rel="alternate" hreflang="zh-TW" href="${escapeXml(
        zh
      )}"/><xhtml:link rel="alternate" hreflang="en" href="${escapeXml(
        en
      )}"/><xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(
        zh
      )}"/></url>`;
    })
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join(
    "\n"
  )}\n</urlset>\n`;
}

function localizedUrl(origin: string, pathname: string, locale: Locale): string {
  const url = new URL(pathname, origin);
  url.searchParams.set("lang", locale);
  return url.toString();
}

function localizedPath(pathname: string, locale: Locale): string {
  const params = new URLSearchParams({ lang: locale });
  return `${pathname}?${params.toString()}`;
}

function plainText(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function truncate(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length - 1).trim()}…`;
}

function markdownLabel(value: string): string {
  return plainText(value).replace(/\\/g, "\\\\").replace(/([\[\]])/g, "\\$1");
}

function markdownDescription(value: string): string {
  return plainText(value).replace(/\s+/g, " ").trim();
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

function escapeXml(value: string): string {
  return escapeAttribute(value);
}
