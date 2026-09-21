export type OidcRpErrorCode =
  | "aborted"
  | "http_status"
  | "invalid_configuration"
  | "invalid_content_type"
  | "invalid_json"
  | "invalid_jwks"
  | "invalid_response"
  | "invalid_protected_header"
  | "network_error"
  | "response_too_large"
  | "timeout"
  | "unknown_kid";

export class OidcRpError extends Error {
  readonly code: OidcRpErrorCode;
  readonly status: number | undefined;

  constructor(
    code: OidcRpErrorCode,
    message: string,
    options: ErrorOptions & { status?: number } = {},
  ) {
    super(message, options);
    this.name = "OidcRpError";
    this.code = code;
    this.status = options.status;
  }
}
