import type { AppEnv } from "./types";

interface AccessClaims {
  aud: string | string[];
  email?: string;
  exp: number;
  iss: string;
  nbf?: number;
  sub?: string;
}

interface AccessHeader {
  alg: string;
  kid: string;
}

type AccessResult =
  | { ok: true; claims: AccessClaims }
  | { ok: false; status: 401 | 503; code: string; message: string };

type AccessJwk = JsonWebKey & { kid?: string };

let certificateCache:
  | { origin: string; expiresAt: number; keys: AccessJwk[] }
  | undefined;

function decodeBase64url(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function decodeJson<T>(value: string): T {
  return JSON.parse(new TextDecoder().decode(decodeBase64url(value))) as T;
}

function accessOrigin(value: string): string {
  const candidate = value.includes("://") ? value : `https://${value}`;
  const url = new URL(candidate);
  if (url.protocol !== "https:") throw new Error("Cloudflare Access team domain must use HTTPS");
  return url.origin;
}

async function accessKeys(origin: string): Promise<AccessJwk[]> {
  if (certificateCache?.origin === origin && certificateCache.expiresAt > Date.now()) {
    return certificateCache.keys;
  }
  const response = await fetch(`${origin}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error(`Cloudflare Access certificates returned ${response.status}`);
  const payload = (await response.json()) as { keys?: AccessJwk[] };
  if (!Array.isArray(payload.keys) || payload.keys.length === 0) {
    throw new Error("Cloudflare Access certificates were empty");
  }
  certificateCache = {
    origin,
    keys: payload.keys,
    expiresAt: Date.now() + 5 * 60_000
  };
  return payload.keys;
}

function audienceMatches(claim: string | string[], expected: string): boolean {
  return Array.isArray(claim) ? claim.includes(expected) : claim === expected;
}

function ownerMatches(claim: string | undefined, expected: string): boolean {
  return Boolean(claim && claim.trim().toLowerCase() === expected.trim().toLowerCase());
}

export async function authorizeAdmin(request: Request, env: AppEnv): Promise<AccessResult> {
  if (env.APP_MODE === "demo") {
    return {
      ok: true,
      claims: {
        aud: "local-demo",
        email: "local-admin",
        exp: Math.floor(Date.now() / 1000) + 300,
        iss: "local-demo"
      }
    };
  }

  if (
    !env.CF_ACCESS_TEAM_DOMAIN ||
    !env.CF_ACCESS_AUD ||
    !env.CF_ACCESS_ALLOWED_EMAIL
  ) {
    return {
      ok: false,
      status: 503,
      code: "admin_not_configured",
      message: "Owner access is not configured"
    };
  }

  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) {
    return {
      ok: false,
      status: 401,
      code: "admin_auth_required",
      message: "Owner access is required"
    };
  }

  try {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("Malformed Access token");
    const [encodedHeader, encodedClaims, encodedSignature] = parts;
    const header = decodeJson<AccessHeader>(encodedHeader);
    const claims = decodeJson<AccessClaims>(encodedClaims);
    if (header.alg !== "RS256" || !header.kid) throw new Error("Unsupported Access token");

    const origin = accessOrigin(env.CF_ACCESS_TEAM_DOMAIN);
    const now = Math.floor(Date.now() / 1000);
    if (claims.iss !== origin) throw new Error("Unexpected Access issuer");
    if (!audienceMatches(claims.aud, env.CF_ACCESS_AUD)) {
      throw new Error("Unexpected Access audience");
    }
    if (!ownerMatches(claims.email, env.CF_ACCESS_ALLOWED_EMAIL)) {
      throw new Error("Unexpected Access identity");
    }
    if (!claims.exp || claims.exp <= now - 30) throw new Error("Expired Access token");
    if (claims.nbf && claims.nbf > now + 30) throw new Error("Access token is not active");

    const jwk = (await accessKeys(origin)).find((candidate) => candidate.kid === header.kid);
    if (!jwk) throw new Error("Access signing key was not found");
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      decodeBase64url(encodedSignature),
      new TextEncoder().encode(`${encodedHeader}.${encodedClaims}`)
    );
    if (!valid) throw new Error("Invalid Access signature");
    return { ok: true, claims };
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "admin_access_rejected",
        message: error instanceof Error ? error.message : "invalid token"
      })
    );
    return {
      ok: false,
      status: 401,
      code: "admin_auth_rejected",
      message: "Owner access could not be verified"
    };
  }
}

export function resetAccessCertificateCacheForTest(): void {
  certificateCache = undefined;
}
