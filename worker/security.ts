import type { Context } from "hono";
import type { AppEnv, HonoEnv } from "./types";

const COOKIE_NAME = "sr_actor";
const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata",
  "instance-data",
  "169.254.169.254"
]);

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  source.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export async function sha256(value: string): Promise<string> {
  return base64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function sign(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return base64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

function parseCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie") ?? "";
  return header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

export async function getOrCreateActor(
  request: Request,
  env: AppEnv
): Promise<{ actorId: string; actorHash: string; setCookie?: string }> {
  const secret = env.ANON_SESSION_SECRET;
  if (!secret) throw new Error("ANON_SESSION_SECRET is missing");

  const existing = parseCookie(request, COOKIE_NAME);
  if (existing) {
    const [actorId, signature] = existing.split(".");
    if (actorId && signature && (await sign(actorId, secret)) === signature) {
      return { actorId, actorHash: await sha256(actorId) };
    }
  }

  const actorId = crypto.randomUUID();
  const signature = await sign(actorId, secret);
  return {
    actorId,
    actorHash: await sha256(actorId),
    setCookie: `${COOKIE_NAME}=${actorId}.${signature}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`
  };
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    parts[0] === 0 ||
    parts[0] >= 224
  );
}

export function assertSafePublicUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Only HTTPS URLs are supported");
  if (url.username || url.password) throw new Error("Credential-bearing URLs are not supported");
  if (url.port && url.port !== "443") throw new Error("Only the standard HTTPS port is supported");

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    BLOCKED_HOSTS.has(hostname) ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname === "::1" ||
    isPrivateIpv4(hostname)
  ) {
    throw new Error("Private and metadata network targets are blocked");
  }
  return url;
}

export async function verifyTurnstile(
  token: string,
  request: Request,
  env: AppEnv,
  expectedAction = "create_research_job"
): Promise<{ success: true } | { success: false; code: string }> {
  if (!env.TURNSTILE_SECRET_KEY) return { success: false, code: "turnstile_not_configured" };

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      secret: env.TURNSTILE_SECRET_KEY,
      response: token,
      remoteip: request.headers.get("CF-Connecting-IP") ?? undefined,
      idempotency_key: crypto.randomUUID()
    })
  });
  if (!response.ok) return { success: false, code: "turnstile_unavailable" };
  const result = (await response.json()) as {
    success: boolean;
    hostname?: string;
    action?: string;
    "error-codes"?: string[];
  };
  if (!result.success) {
    return { success: false, code: result["error-codes"]?.[0] ?? "turnstile_rejected" };
  }

  const expectedHost = new URL(request.url).hostname;
  const usingTestSecret = env.TURNSTILE_SECRET_KEY.startsWith("1x000");
  if (!usingTestSecret && result.hostname && result.hostname !== expectedHost) {
    return { success: false, code: "turnstile_hostname_mismatch" };
  }
  if (!usingTestSecret && result.action !== expectedAction) {
    return { success: false, code: "turnstile_action_mismatch" };
  }
  return { success: true };
}

export function attachActorCookie(c: Context<HonoEnv>, response: Response): Response {
  const setCookie = c.get("setActorCookie");
  if (setCookie) response.headers.append("set-cookie", setCookie);
  return response;
}

export function isSetupAuthorized(request: Request, env: AppEnv): boolean {
  const supplied = request.headers.get("x-setup-capability");
  return Boolean(env.SETUP_CAPABILITY && supplied && supplied === env.SETUP_CAPABILITY);
}
