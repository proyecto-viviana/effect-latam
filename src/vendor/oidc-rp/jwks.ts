import { OidcRpError } from "./errors";
import { requireRs256ProtectedHeader } from "./header";
import { requestBoundedJson, type BoundedJsonContext, type FetchLike } from "./http";

const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_CACHE_TTL_MS = 30_000;
const MAX_CACHE_TTL_MS = 5 * 60_000;
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024;
const DEFAULT_MAX_KEY_COUNT = 32;
const DEFAULT_UNKNOWN_KID_COOLDOWN_MS = 30_000;
const MAX_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_KEY_COUNT = 64;
const MIN_RSA_MODULUS_BYTES = 256;
const PRIVATE_JWK_FIELDS = ["d", "p", "q", "dp", "dq", "qi", "oth"] as const;

interface CachedKeySet {
  expiresAt: number;
  keys: Map<string, CryptoKey>;
}

export interface ResolvedJwksKey {
  key: CryptoKey;
  kid: string;
}

export type JwksKeyImporter = (jwk: JsonWebKey, signal: AbortSignal) => Promise<CryptoKey>;

export interface JwksResolverOptions {
  defaultCacheTtlMs?: number;
  fetch?: FetchLike;
  importKey?: JwksKeyImporter;
  maxCacheTtlMs?: number;
  maxKeyCount?: number;
  maxResponseBytes?: number;
  now?: () => number;
  timeoutMs?: number;
  unknownKidCooldownMs?: number;
}

export interface JwksResolver {
  clear(): void;
  resolveKey(authUrl: string, protectedHeader: unknown): Promise<ResolvedJwksKey>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedNonNegativeFinite(value: number, name: string, maximum: number): number {
  if (!Number.isFinite(value) || value < 0 || value > maximum) {
    throw new OidcRpError(
      "invalid_configuration",
      `${name} must be a finite non-negative number no greater than ${maximum}`,
    );
  }
  return value;
}

function boundedPositiveInteger(value: number, name: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new OidcRpError(
      "invalid_configuration",
      `${name} must be a positive safe integer no greater than ${maximum}`,
    );
  }
  return value;
}

function currentTime(now: () => number): number {
  const value = now();
  if (!Number.isFinite(value)) {
    throw new OidcRpError("invalid_configuration", "now() must return a finite timestamp");
  }
  return value;
}

function boundedAddition(left: number, right: number): number {
  return Math.min(left + right, Number.MAX_SAFE_INTEGER);
}

export function oidcJwksUrl(authUrl: string): string {
  let base: URL;
  try {
    base = new URL(authUrl);
  } catch (cause) {
    throw new OidcRpError("invalid_configuration", "AUTH_URL is not a valid URL", { cause });
  }
  if (base.protocol !== "https:" && base.protocol !== "http:") {
    throw new OidcRpError("invalid_configuration", "AUTH_URL must use the http or https scheme");
  }
  base.pathname = `${base.pathname.replace(/\/$/, "")}/.well-known/jwks.json`;
  base.search = "";
  base.hash = "";
  return base.toString();
}

function cacheControlMaxAge(headers: Headers): number | undefined {
  const cacheControl = headers.get("cache-control");
  if (!cacheControl) return undefined;

  let maxAge: number | undefined;
  let preventsReuse = false;
  for (const directive of cacheControl.split(",")) {
    const [rawName, rawValue] = directive.trim().split("=", 2);
    const name = rawName?.toLowerCase();
    if (name === "no-store" || name === "no-cache") {
      preventsReuse = true;
      continue;
    }
    if (name !== "max-age") continue;
    if (rawValue === undefined || maxAge !== undefined) return 0;

    const match = /^(?:"(\d+)"|(\d+))$/.exec(rawValue.trim());
    const seconds = match ? Number(match[1] ?? match[2]) : Number.NaN;
    if (!Number.isSafeInteger(seconds)) return 0;
    maxAge = Math.min(seconds * 1_000, Number.MAX_SAFE_INTEGER);
  }
  return preventsReuse ? 0 : maxAge;
}

function headerDate(headers: Headers, name: string): number | undefined {
  const value = headers.get(name);
  if (value === null) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function responseAgeMs(headers: Headers, now: number): number {
  const date = headerDate(headers, "date");
  const apparentAge =
    date === undefined
      ? 0
      : Number.isNaN(date)
        ? Number.POSITIVE_INFINITY
        : Math.max(0, now - date);
  const rawAge = headers.get("age");
  if (rawAge === null) return apparentAge;
  if (!/^\d+$/.test(rawAge.trim())) return Number.POSITIVE_INFINITY;

  const seconds = Number(rawAge);
  const age = Number.isSafeInteger(seconds)
    ? Math.min(seconds * 1_000, Number.MAX_SAFE_INTEGER)
    : Number.POSITIVE_INFINITY;
  return Math.max(apparentAge, age);
}

function responseTtlMs(
  headers: Headers,
  now: number,
  defaultTtlMs: number,
  maxTtlMs: number,
): number {
  const maxAge = cacheControlMaxAge(headers);
  const age = responseAgeMs(headers, now);
  let ttl: number;
  if (maxAge !== undefined) {
    ttl = Math.max(0, maxAge - age);
  } else {
    const expiresAt = headerDate(headers, "expires");
    if (expiresAt === undefined) {
      ttl = Math.max(0, defaultTtlMs - age);
    } else {
      const responseDate = headerDate(headers, "date");
      if (
        !Number.isFinite(expiresAt) ||
        (responseDate !== undefined && !Number.isFinite(responseDate))
      ) {
        ttl = 0;
      } else if (responseDate !== undefined) {
        ttl = Math.max(0, expiresAt - responseDate - age);
      } else {
        ttl = Math.max(0, expiresAt - now);
      }
    }
  }
  return Math.min(ttl, maxTtlMs);
}

function base64UrlDecodedLength(value: string): number {
  const remainder = value.length % 4;
  if (remainder === 1) return 0;
  return Math.floor((value.length * 6) / 8);
}

function invalidJwks(message: string, cause?: unknown): OidcRpError {
  return new OidcRpError("invalid_jwks", message, cause === undefined ? {} : { cause });
}

function validatePublicRsaJwk(value: unknown): JsonWebKey & { kid: string } {
  if (!isRecord(value)) throw invalidJwks("JWKS contains a malformed key");
  const kid = value.kid;
  if (typeof kid !== "string" || kid.length === 0 || kid.trim() !== kid) {
    throw invalidJwks("JWKS key is missing a valid kid");
  }
  if (value.kty !== "RSA") throw invalidJwks("JWKS key type must be RSA");
  if (value.alg !== "RS256") throw invalidJwks("JWKS key algorithm must be RS256");
  if (value.use !== "sig") throw invalidJwks("JWKS key use must be sig");
  if (
    typeof value.n !== "string" ||
    !/^[A-Za-z0-9_-]+$/.test(value.n) ||
    base64UrlDecodedLength(value.n) < MIN_RSA_MODULUS_BYTES ||
    typeof value.e !== "string" ||
    !/^[A-Za-z0-9_-]+$/.test(value.e)
  ) {
    throw invalidJwks("JWKS contains malformed RSA parameters");
  }
  if (PRIVATE_JWK_FIELDS.some((field) => field in value)) {
    throw invalidJwks("JWKS contains private key material");
  }
  if (
    value.key_ops !== undefined &&
    (!Array.isArray(value.key_ops) ||
      value.key_ops.length === 0 ||
      value.key_ops.some((operation) => operation !== "verify"))
  ) {
    throw invalidJwks("JWKS key operations must be verify-only");
  }
  return value as unknown as JsonWebKey & { kid: string };
}

function validateImportedKey(key: CryptoKey): void {
  const algorithm = key.algorithm as Partial<RsaHashedKeyAlgorithm>;
  if (
    key.type !== "public" ||
    algorithm.name !== "RSASSA-PKCS1-v1_5" ||
    algorithm.modulusLength === undefined ||
    algorithm.modulusLength < MIN_RSA_MODULUS_BYTES * 8 ||
    algorithm.hash?.name !== "SHA-256" ||
    !key.usages.includes("verify")
  ) {
    throw invalidJwks("JWKS importer did not return a public RSA verification key");
  }
}

async function defaultImportKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

async function parseKeySet(
  value: unknown,
  context: BoundedJsonContext,
  maxKeyCount: number,
  importKey: JwksKeyImporter,
): Promise<Map<string, CryptoKey>> {
  if (!isRecord(value) || !Array.isArray(value.keys) || value.keys.length === 0) {
    throw invalidJwks("JWKS response does not contain keys");
  }
  if (value.keys.length > maxKeyCount) {
    throw invalidJwks("JWKS contains too many keys");
  }

  const keys = new Map<string, CryptoKey>();
  for (const candidate of value.keys) {
    const jwk = validatePublicRsaJwk(candidate);
    if (keys.has(jwk.kid)) throw invalidJwks("JWKS contains duplicate kids");

    try {
      const key = await importKey(jwk, context.signal);
      validateImportedKey(key);
      keys.set(jwk.kid, key);
    } catch (cause) {
      if (cause instanceof OidcRpError) throw cause;
      throw invalidJwks("JWKS contains a key that cannot be imported", cause);
    }
  }
  return keys;
}

export function createJwksResolver(options: JwksResolverOptions = {}): JwksResolver {
  const timeoutMs = boundedPositiveInteger(
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    "timeoutMs",
    MAX_TIMEOUT_MS,
  );
  const maxCacheTtlMs = boundedNonNegativeFinite(
    options.maxCacheTtlMs ?? MAX_CACHE_TTL_MS,
    "maxCacheTtlMs",
    MAX_CACHE_TTL_MS,
  );
  const defaultCacheTtlMs = Math.min(
    boundedNonNegativeFinite(
      options.defaultCacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
      "defaultCacheTtlMs",
      MAX_CACHE_TTL_MS,
    ),
    maxCacheTtlMs,
  );
  const maxKeyCount = boundedPositiveInteger(
    options.maxKeyCount ?? DEFAULT_MAX_KEY_COUNT,
    "maxKeyCount",
    MAX_KEY_COUNT,
  );
  const maxResponseBytes = boundedPositiveInteger(
    options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
    "maxResponseBytes",
    MAX_RESPONSE_BYTES,
  );
  const unknownKidCooldownMs = Math.min(
    boundedNonNegativeFinite(
      options.unknownKidCooldownMs ?? DEFAULT_UNKNOWN_KID_COOLDOWN_MS,
      "unknownKidCooldownMs",
      MAX_CACHE_TTL_MS,
    ),
    maxCacheTtlMs,
  );
  const fetchImpl = options.fetch;
  const importKey = options.importKey ?? defaultImportKey;
  const now = options.now ?? Date.now;
  const cache = new Map<string, CachedKeySet>();
  const refreshes = new Map<string, Promise<CachedKeySet>>();
  const unknownKidCooldowns = new Map<string, number>();

  async function fetchKeySet(endpoint: string): Promise<CachedKeySet> {
    const response = await requestBoundedJson(endpoint, {
      acceptedContentTypes: ["application/json", "application/jwk-set+json"],
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
      maxResponseBytes,
      timeoutMs,
      transform: (value, context) => parseKeySet(value, context, maxKeyCount, importKey),
    });
    const fetchedAt = currentTime(now);
    const expiresAt = boundedAddition(
      fetchedAt,
      responseTtlMs(response.headers, fetchedAt, defaultCacheTtlMs, maxCacheTtlMs),
    );
    const result = { expiresAt, keys: response.value };
    cache.set(endpoint, result);
    return result;
  }

  function refresh(endpoint: string): Promise<CachedKeySet> {
    const active = refreshes.get(endpoint);
    if (active) return active;

    const pending = fetchKeySet(endpoint).finally(() => {
      if (refreshes.get(endpoint) === pending) refreshes.delete(endpoint);
    });
    refreshes.set(endpoint, pending);
    return pending;
  }

  return {
    clear() {
      cache.clear();
      unknownKidCooldowns.clear();
    },

    async resolveKey(authUrl, protectedHeader) {
      const { kid } = requireRs256ProtectedHeader(protectedHeader);
      const endpoint = oidcJwksUrl(authUrl);
      const checkedAt = currentTime(now);
      const cached = cache.get(endpoint);
      if (cached && checkedAt < cached.expiresAt) {
        const key = cached.keys.get(kid);
        if (key) return { key, kid };

        const active = refreshes.get(endpoint);
        if (active) {
          const refreshed = await active;
          const refreshedKey = refreshed.keys.get(kid);
          if (refreshedKey) return { key: refreshedKey, kid };
          throw new OidcRpError("unknown_kid", "No matching key in JWKS");
        }

        const refreshAfter = unknownKidCooldowns.get(endpoint) ?? 0;
        if (checkedAt < refreshAfter) {
          throw new OidcRpError("unknown_kid", "No matching key in JWKS");
        }

        unknownKidCooldowns.set(endpoint, boundedAddition(checkedAt, unknownKidCooldownMs));
        const refreshed = await refresh(endpoint);
        const refreshedKey = refreshed.keys.get(kid);
        if (refreshedKey) return { key: refreshedKey, kid };
        throw new OidcRpError("unknown_kid", "No matching key in JWKS");
      }

      unknownKidCooldowns.delete(endpoint);
      const refreshed = await refresh(endpoint);
      const key = refreshed.keys.get(kid);
      if (!key) {
        unknownKidCooldowns.set(endpoint, boundedAddition(currentTime(now), unknownKidCooldownMs));
        throw new OidcRpError("unknown_kid", "No matching key in JWKS");
      }
      return { key, kid };
    },
  };
}
