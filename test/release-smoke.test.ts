import { describe, expect, it, vi } from "vitest";
// @ts-expect-error The release smoke module is a Node ESM script tested through its public exports.
import { releaseAssetUrls, verifyRelease } from "../scripts/release-smoke.mjs";

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" }
  });
}

function releaseFetch({ missingAssetStatus = 404 } = {}) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url
    );
    if (url.pathname === "/") {
      return new Response(
        '<html><head><link rel="stylesheet" href="/assets/index.css"></head>' +
          '<body>Skill Reverse<script type="module" src="/assets/index.js"></script></body></html>',
        { headers: { "content-type": "text/html; charset=utf-8" } }
      );
    }
    if (url.pathname === "/assets/index.css") {
      return new Response("body{}", { headers: { "content-type": "text/css" } });
    }
    if (url.pathname === "/assets/index.js") {
      return new Response("console.log('ready')", {
        headers: { "content-type": "text/javascript" }
      });
    }
    if (url.pathname.startsWith("/assets/__release-smoke-missing-")) {
      return new Response(
        missingAssetStatus === 404 ? "Not found" : "<!doctype html><html></html>",
        {
          status: missingAssetStatus,
          headers: {
            "content-type":
              missingAssetStatus === 404 ? "text/plain" : "text/html"
          }
        }
      );
    }
    if (url.pathname === "/api/health") return json({ ok: true, status: "ready" });
    if (url.pathname === "/api/history") return json({ items: [] });
    if (url.pathname === "/robots.txt") {
      return new Response("Sitemap: https://example.com/sitemap.xml");
    }
    if (url.pathname === "/sitemap.xml") {
      return new Response("<urlset></urlset>", {
        headers: { "content-type": "application/xml" }
      });
    }
    return new Response("Not found", { status: 404 });
  });
}

describe("release smoke QA", () => {
  it("extracts unique JavaScript and CSS assets", () => {
    expect(
      releaseAssetUrls(
        '<link href="/assets/app.css"><script src="/assets/app.js"></script>' +
          '<script src="/assets/app.js"></script>',
        "https://example.com"
      )
    ).toEqual([
      "https://example.com/assets/app.css",
      "https://example.com/assets/app.js"
    ]);
  });

  it("checks assets, public APIs, SEO endpoints and both locales", async () => {
    const fetchMock = releaseFetch();
    await expect(verifyRelease("https://example.com", fetchMock)).resolves.toMatchObject({
      assets: 2,
      locales: 2,
      health: "ready"
    });
    expect(fetchMock).toHaveBeenCalled();
  });

  it("rejects an SPA fallback masquerading as a missing JavaScript asset", async () => {
    await expect(
      verifyRelease(
        "https://example.com",
        releaseFetch({ missingAssetStatus: 200 })
      )
    ).rejects.toThrow("Missing asset returned 200");
  });
});
