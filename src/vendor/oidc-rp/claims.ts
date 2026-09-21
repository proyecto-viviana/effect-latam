export const OIDC_ID_TOKEN_CLAIM_POLICY = Object.freeze({
  clockSkewSeconds: 60,
  maximumTokenAgeSeconds: 10 * 60,
  identityKeyClaim: "sub",
  emailNormalization: "trim-and-lowercase",
  bounds: Object.freeze({
    issuer: 2_048,
    audience: 256,
    subject: 255,
    email: 320,
    nonce: 256,
    name: 256,
    preferred_username: 128,
    nickname: 128,
    handle: 128,
    picture: 2_048,
  }),
} as const);

export const OIDC_PROFILE_CLAIMS = [
  "name",
  "preferred_username",
  "nickname",
  "handle",
  "picture",
] as const;

export type OidcProfileClaim = (typeof OIDC_PROFILE_CLAIMS)[number];

export interface OidcClaimValidationContext {
  issuer: string;
  audience: string;
  nonce: string;
  /** Integer NumericDate used for deterministic checks. Defaults to the current time. */
  now?: number;
}

export interface ValidatedOidcIdTokenClaims {
  iss: string;
  aud: string;
  sub: string;
  /** Canonical email for lookup/display. Account identity remains keyed only by `sub`. */
  email: string;
  email_verified: boolean;
  nonce: string;
  exp: number;
  iat: number;
  name?: string;
  preferred_username?: string;
  nickname?: string;
  handle?: string;
  picture?: string;
}

export type OidcClaimValidationErrorCode =
  | "empty"
  | "expired"
  | "future"
  | "invalid-time-order"
  | "mismatch"
  | "missing"
  | "oversized"
  | "stale"
  | "type";

export class OidcClaimValidationError extends Error {
  readonly name = "OidcClaimValidationError";
  readonly code: OidcClaimValidationErrorCode;
  readonly claim: string;

  constructor(code: OidcClaimValidationErrorCode, claim: string) {
    super(`Invalid ID-token claim ${claim}: ${code}`);
    this.code = code;
    this.claim = claim;
  }
}

/** Validate the shared claim boundary after cryptographic JWT verification. */
export function validateOidcIdTokenClaims(
  payload: Readonly<Record<string, unknown>>,
  context: OidcClaimValidationContext,
): ValidatedOidcIdTokenClaims {
  const now = context.now ?? Math.floor(Date.now() / 1_000);
  assertNumericDate("now", now);

  const issuer = requiredString(payload, "iss", OIDC_ID_TOKEN_CLAIM_POLICY.bounds.issuer);
  if (issuer !== context.issuer) fail("mismatch", "iss");

  const audience = requiredString(payload, "aud", OIDC_ID_TOKEN_CLAIM_POLICY.bounds.audience);
  if (audience !== context.audience) fail("mismatch", "aud");

  const subject = requiredString(payload, "sub", OIDC_ID_TOKEN_CLAIM_POLICY.bounds.subject);
  const rawEmail = requiredString(payload, "email", OIDC_ID_TOKEN_CLAIM_POLICY.bounds.email);
  const email = normalizeOidcEmail(rawEmail);
  const emailVerified = requiredBoolean(payload, "email_verified");

  const nonce = requiredString(payload, "nonce", OIDC_ID_TOKEN_CLAIM_POLICY.bounds.nonce);
  if (nonce !== context.nonce) fail("mismatch", "nonce");

  const expiresAt = requiredNumericDate(payload, "exp");
  const issuedAt = requiredNumericDate(payload, "iat");
  const { clockSkewSeconds, maximumTokenAgeSeconds } = OIDC_ID_TOKEN_CLAIM_POLICY;

  if (expiresAt <= now - clockSkewSeconds) fail("expired", "exp");
  if (issuedAt > now + clockSkewSeconds) fail("future", "iat");
  if (now - issuedAt > maximumTokenAgeSeconds + clockSkewSeconds) fail("stale", "iat");
  if (expiresAt <= issuedAt) fail("invalid-time-order", "exp");

  const profile = Object.fromEntries(
    OIDC_PROFILE_CLAIMS.flatMap((claim) => {
      const value = optionalProfileString(payload, claim);
      return value === undefined ? [] : [[claim, value] as const];
    }),
  ) as Partial<Record<OidcProfileClaim, string>>;

  return {
    iss: issuer,
    aud: audience,
    sub: subject,
    email,
    email_verified: emailVerified,
    nonce,
    exp: expiresAt,
    iat: issuedAt,
    ...profile,
  };
}

export function normalizeOidcEmail(email: string): string {
  return email.trim().toLowerCase();
}

function requiredString(
  payload: Readonly<Record<string, unknown>>,
  claim: string,
  maximumLength: number,
): string {
  const value = requiredValue(payload, claim);
  if (typeof value !== "string") fail("type", claim);
  if (value.length > maximumLength) fail("oversized", claim);
  if (value.trim().length === 0) fail("empty", claim);
  return value;
}

function requiredBoolean(payload: Readonly<Record<string, unknown>>, claim: string): boolean {
  const value = requiredValue(payload, claim);
  if (typeof value !== "boolean") fail("type", claim);
  return value;
}

function requiredNumericDate(payload: Readonly<Record<string, unknown>>, claim: string): number {
  const value = requiredValue(payload, claim);
  assertNumericDate(claim, value);
  return value;
}

function requiredValue(payload: Readonly<Record<string, unknown>>, claim: string): unknown {
  if (!Object.hasOwn(payload, claim)) fail("missing", claim);
  return payload[claim];
}

function assertNumericDate(claim: string, value: unknown): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    !Number.isFinite(value) ||
    value < 0
  ) {
    fail("type", claim);
  }
}

function optionalProfileString(
  payload: Readonly<Record<string, unknown>>,
  claim: OidcProfileClaim,
): string | undefined {
  if (!Object.hasOwn(payload, claim)) return undefined;

  const value = payload[claim];
  if (typeof value !== "string") fail("type", claim);

  const maximumLength = OIDC_ID_TOKEN_CLAIM_POLICY.bounds[claim];
  if (value.length > maximumLength) fail("oversized", claim);

  const normalized = value.trim();
  if (normalized.length === 0) fail("empty", claim);
  return normalized;
}

function fail(code: OidcClaimValidationErrorCode, claim: string): never {
  throw new OidcClaimValidationError(code, claim);
}
