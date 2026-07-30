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

export function homeSeoPage(locale: Locale): SeoPage {
  const english = locale === "en";
  return {
    locale,
    title: english
      ? "Skill Reverse — Reverse-engineer methods from real work"
      : "Skill Reverse — 從真實成果反向拆解可複用方法",
    description: english
      ? "Turn real work into traceable methods, evidence, and professional knowledge."
      : "從真實成果反向提取方法、證據與職業知識，形成可驗證、可複用的研究報告。",
    canonicalPath: "/",
    index: true,
    type: "website",
    bodyHtml: english
      ? "<main><h1>Reverse-engineer methods from real work</h1><p>Trace methods back to evidence and professional knowledge.</p></main>"
      : "<main><h1>從真實成果反向拆解可複用方法</h1><p>把方法連回證據與職業知識，形成可驗證的研究報告。</p></main>"
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
  const title = `${plainText(report.title)} — Skill Reverse`;
  const description = truncate(
    `${plainText(report.framework.name)}：${plainText(report.framework.summary)}`,
    160
  );
  return {
    locale,
    title,
    description,
    canonicalPath: `/reports/${encodeURIComponent(report.id)}`,
    index: true,
    type: "article",
    publishedAt: publishedAt ?? report.generatedAt,
    bodyHtml: `<main><article><header><h1>${escapeHtml(report.title)}</h1><p>${escapeHtml(
      report.verdict
    )}</p></header><section><h2>${escapeHtml(report.framework.name)}</h2><p>${escapeHtml(
      report.framework.summary
    )}</p></section><footer><time datetime="${escapeAttribute(
      publishedAt ?? report.generatedAt
    )}">${escapeHtml(publishedAt ?? report.generatedAt)}</time></footer></article></main>`
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
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /admin",
    "Disallow: /api",
    "Disallow: /jobs",
    "Disallow: /collection",
    "Disallow: /c/",
    `Sitemap: ${origin}/sitemap.xml`,
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

function plainText(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function truncate(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length - 1).trim()}…`;
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
