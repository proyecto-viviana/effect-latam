import { createJwksResolver, requestBoundedJson, verifyIdToken } from "../vendor/oidc-rp/index";
import type { ValidatedOidcIdTokenClaims } from "../vendor/oidc-rp/claims";

const TOKEN_RESPONSE_MAX_BYTES = 64 * 1024;
const TOKEN_REQUEST_TIMEOUT_MS = 3_000;
const jwksResolver = createJwksResolver();

export type IdTokenClaims = ValidatedOidcIdTokenClaims;

export function generateCodeVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

export function generateState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function generateNonce(): string {
  return generateState();
}

export function getRequestOrigin(request: Request): string {
  return new URL(request.url).origin;
}

export function getAuthCallbackUrl(request: Request, configuredAppUrl?: string): string {
  const origin = configuredAppUrl ? new URL(configuredAppUrl).origin : getRequestOrigin(request);
  return `${origin}/api/auth/callback`;
}

export function sanitizeReturnTo(value: string): string {
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /%2f|%5c/i.test(value) ||
    hasControlCharacter(value)
  ) {
    return "/";
  }
  try {
    const base = new URL("https://effectlatam.invalid");
    const target = new URL(value, base);
    if (target.origin !== base.origin) return "/";
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return "/";
  }
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

export function getCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get("cookie") || "";
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return match[1] ?? null;
  }
}

export function buildAuthorizeUrl(params: {
  env: Env;
  state: string;
  nonce: string;
  codeChallenge: string;
  redirectUri: string;
  prompt?: "none" | "login" | "select_account";
}): string {
  const url = new URL(`${params.env.AUTH_URL}/authorize`);
  url.searchParams.set("client_id", params.env.EFFECT_LATAM_CLIENT_ID);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid profile email");
  url.searchParams.set("state", params.state);
  url.searchParams.set("nonce", params.nonce);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (params.prompt) url.searchParams.set("prompt", params.prompt);
  return url.toString();
}

export async function exchangeCode(
  env: Env,
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<string> {
  const secret = env.EFFECT_LATAM_CLIENT_SECRET;
  if (!secret) throw new Error("EFFECT_LATAM_CLIENT_SECRET is not configured");
  const credentials = btoa(`${env.EFFECT_LATAM_CLIENT_ID}:${secret}`);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    code_verifier: codeVerifier,
    redirect_uri: redirectUri,
  });

  const response = await requestBoundedJson(`${env.AUTH_URL}/token`, {
    maxResponseBytes: TOKEN_RESPONSE_MAX_BYTES,
    request: {
      method: "POST",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${credentials}`,
      },
      body: body.toString(),
    },
    timeoutMs: TOKEN_REQUEST_TIMEOUT_MS,
    transform: requireIdToken,
  });
  return response.value;
}

export async function validateIdToken(
  env: Env,
  idToken: string,
  nonce: string,
): Promise<IdTokenClaims> {
  return verifyIdToken(env, idToken, {
    clientId: env.EFFECT_LATAM_CLIENT_ID,
    nonce,
    resolveKey: jwksResolver.resolveKey,
  });
}

function requireIdToken(value: unknown): string {
  if (!isRecord(value)) throw new Error("Token response must be a JSON object");
  const idToken = value.id_token;
  if (typeof idToken !== "string" || idToken.length === 0 || idToken.trim() !== idToken) {
    throw new Error("Token response must contain a non-empty id_token");
  }
  return idToken;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
