import { OidcRpError } from "./errors";

export interface Rs256ProtectedHeader {
  alg: "RS256";
  kid: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requireRs256ProtectedHeader(value: unknown): Rs256ProtectedHeader {
  if (!isRecord(value) || value.alg !== "RS256") {
    throw new OidcRpError("invalid_protected_header", "ID token protected header must use RS256");
  }
  if (typeof value.kid !== "string" || value.kid.length === 0 || value.kid.trim() !== value.kid) {
    throw new OidcRpError(
      "invalid_protected_header",
      "ID token protected header must contain a non-empty kid",
    );
  }

  return { alg: "RS256", kid: value.kid };
}
