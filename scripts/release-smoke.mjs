const DEFAULT_PRODUCTION_URL = "https://skill-reverse.vibeencode.dev";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(fetchImpl, url, accept) {
  return fetchImpl(url, {
    headers: {
      accept,
      "cache-control": "no-cache"
    }
  });
}

export function releaseAssetUrls(html, baseUrl) {
  const matches = html.matchAll(
    /(?:src|href)="([^"]+\.(?:js|css)(?:\?[^"]*)?)"/giu
  );
  return [...new Set([...matches].map((match) => new URL(match[1], baseUrl).href))];
}

export async function verifyRelease(baseUrl, fetchImpl = fetch) {
  const origin = new URL(baseUrl).origin;
  const nonce = Date.now();
  const checkedAssets = new Set();
  const assetKinds = new Set();

  for (const locale of ["zh-TW", "en"]) {
    const pageUrl = new URL("/", origin);
    pageUrl.searchParams.set("lang", locale);
    pageUrl.searchParams.set("release-smoke", String(nonce));
    const response = await request(fetchImpl, pageUrl, "text/html");
    const contentType = response.headers.get("content-type") ?? "";
    const html = await response.text();
    assert(response.status === 200, `${locale} homepage returned ${response.status}`);
    assert(contentType.includes("text/html"), `${locale} homepage is not HTML`);
    assert(html.includes("Skill Reverse"), `${locale} homepage shell is incomplete`);

    for (const assetUrl of releaseAssetUrls(html, origin)) {
      if (checkedAssets.has(assetUrl)) continue;
      checkedAssets.add(assetUrl);
      const expectedType = new URL(assetUrl).pathname.endsWith(".css")
        ? "text/css"
        : "javascript";
      assetKinds.add(expectedType);
      const asset = await request(
        fetchImpl,
        assetUrl,
        expectedType === "text/css" ? "text/css" : "application/javascript"
      );
      const assetType = asset.headers.get("content-type") ?? "";
      const assetBody = await asset.text();
      assert(asset.status === 200, `Asset ${assetUrl} returned ${asset.status}`);
      assert(
        assetType.includes(expectedType),
        `Asset ${assetUrl} has unexpected content type ${assetType || "missing"}`
      );
      assert(!/^\s*<!doctype html/i.test(assetBody), `Asset ${assetUrl} returned HTML`);
    }
  }

  assert(
    assetKinds.has("javascript") && assetKinds.has("text/css"),
    "Homepage did not reference both JavaScript and CSS assets"
  );

  const missingAssetUrl = new URL(
    `/assets/__release-smoke-missing-${nonce}.js`,
    origin
  );
  const missingAsset = await request(
    fetchImpl,
    missingAssetUrl,
    "application/javascript"
  );
  const missingAssetType = missingAsset.headers.get("content-type") ?? "";
  assert(missingAsset.status === 404, `Missing asset returned ${missingAsset.status}`);
  assert(
    !missingAssetType.includes("text/html"),
    "Missing asset was rewritten to the SPA HTML shell"
  );

  const healthResponse = await request(
    fetchImpl,
    new URL(`/api/health?release-smoke=${nonce}`, origin),
    "application/json"
  );
  const health = await healthResponse.json();
  assert(healthResponse.status === 200, `Health returned ${healthResponse.status}`);
  assert(health.ok === true, `Health is not ready: ${health.status ?? "unknown"}`);

  for (const locale of ["zh-TW", "en"]) {
    const historyUrl = new URL("/api/history", origin);
    historyUrl.searchParams.set("limit", "1");
    historyUrl.searchParams.set("lang", locale);
    historyUrl.searchParams.set("release-smoke", String(nonce));
    const historyResponse = await request(fetchImpl, historyUrl, "application/json");
    const history = await historyResponse.json();
    assert(
      historyResponse.status === 200,
      `${locale} public archive returned ${historyResponse.status}`
    );
    assert(Array.isArray(history.items), `${locale} public archive items are invalid`);
    assert(history.items.length <= 1, `${locale} public archive ignored its page limit`);
  }

  const robots = await request(
    fetchImpl,
    new URL(`/robots.txt?release-smoke=${nonce}`, origin),
    "text/plain"
  );
  assert(robots.status === 200, `robots.txt returned ${robots.status}`);
  assert((await robots.text()).includes("Sitemap:"), "robots.txt has no sitemap");

  const sitemap = await request(
    fetchImpl,
    new URL(`/sitemap.xml?release-smoke=${nonce}`, origin),
    "application/xml"
  );
  assert(sitemap.status === 200, `sitemap.xml returned ${sitemap.status}`);
  assert(
    (sitemap.headers.get("content-type") ?? "").includes("application/xml"),
    "sitemap.xml has the wrong content type"
  );

  return {
    origin,
    assets: checkedAssets.size,
    locales: 2,
    health: health.status
  };
}

if (
  typeof process !== "undefined" &&
  process.argv[1]?.endsWith("release-smoke.mjs")
) {
  const baseUrl = process.argv[2] || process.env.SKILL_REVERSE_URL || DEFAULT_PRODUCTION_URL;
  try {
    let result;
    let lastError;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        result = await verifyRelease(baseUrl);
        break;
      } catch (error) {
        lastError = error;
        if (attempt < 4) {
          console.log(`! Release smoke attempt ${attempt} failed; retrying in 5 seconds`);
          await new Promise((resolve) => setTimeout(resolve, 5_000));
        }
      }
    }
    if (!result) throw lastError;
    console.log(
      `✓ Release smoke passed: ${result.origin} · ${result.assets} assets · ${result.locales} locales · ${result.health}`
    );
  } catch (error) {
    console.error(`✕ Release smoke failed: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
