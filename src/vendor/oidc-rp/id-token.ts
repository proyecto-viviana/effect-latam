import { decodeProtectedHeader, jwtVerify } from "jose";
import {
  OIDC_ID_TOKEN_CLAIM_POLICY,
  validateOidcIdTokenClaims,
  type ValidatedOidcIdTokenClaims,
} from "./claims";
import type { ResolvedJwksKey } from "./jwks";

export interface VerifyIdTokenEnvironment {
  AUTH_URL: string;
}

export type ResolveJwksKey = (
  authUrl: string,
  protectedHeader: unknown,
) => Promise<ResolvedJwksKey>;

export interface VerifyIdTokenOptions {
  clientId: string;
  nonce: string;
  resolveKey: ResolveJwksKey;
}

/**
 * Verify an OIDC ID token with an app-owned JWKS resolver, then apply the
 * shared Viviana claim policy.
 */
export async function verifyIdToken(
  env: Readonly<VerifyIdTokenEnvironment>,
  idToken: string,
  options: Readonly<VerifyIdTokenOptions>,
): Promise<ValidatedOidcIdTokenClaims> {
  const header = decodeProtectedHeader(idToken);
  const { key } = await options.resolveKey(env.AUTH_URL, header);
  const { payload } = await jwtVerify(idToken, key, {
    algorithms: ["RS256"],
    issuer: env.AUTH_URL,
    audience: options.clientId,
    clockTolerance: OIDC_ID_TOKEN_CLAIM_POLICY.clockSkewSeconds,
    maxTokenAge: OIDC_ID_TOKEN_CLAIM_POLICY.maximumTokenAgeSeconds,
    requiredClaims: ["exp"],
  });

  return validateOidcIdTokenClaims(payload, {
    audience: options.clientId,
    issuer: env.AUTH_URL,
    nonce: options.nonce,
  });
}
