import { OidcRpError } from "./errors";

const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const DEFAULT_ACCEPTED_CONTENT_TYPES = ["application/json"] as const;

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface BoundedJsonContext {
  headers: Headers;
  signal: AbortSignal;
  status: number;
  url: string;
}

export interface BoundedJsonRequestOptions<T = unknown> {
  acceptedContentTypes?: readonly string[];
  fetch?: FetchLike;
  maxResponseBytes?: number;
  request?: RequestInit;
  timeoutMs?: number;
  transform?: (value: unknown, context: BoundedJsonContext) => T | Promise<T>;
}

export interface BoundedJsonResponse<T> {
  headers: Headers;
  status: number;
  url: string;
  value: T;
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

function acceptedMediaTypes(values: readonly string[]): ReadonlySet<string> {
  if (values.length === 0) {
    throw new OidcRpError("invalid_configuration", "acceptedContentTypes must not be empty");
  }

  const normalized = new Set<string>();
  for (const value of values) {
    const mediaType = value.trim().toLowerCase();
    if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mediaType)) {
      throw new OidcRpError(
        "invalid_configuration",
        "acceptedContentTypes contains an invalid media type",
      );
    }
    normalized.add(mediaType);
  }
  return normalized;
}

function validateContentType(headers: Headers, accepted: ReadonlySet<string>): void {
  const raw = headers.get("content-type");
  const mediaType = raw?.split(";", 1)[0]?.trim().toLowerCase();
  if (!mediaType || !accepted.has(mediaType)) {
    throw new OidcRpError(
      "invalid_content_type",
      "OIDC response does not use an accepted JSON media type",
    );
  }
}

function declaredContentLength(headers: Headers, maximum: number): void {
  const raw = headers.get("content-length");
  if (raw === null) return;
  if (!/^\d+$/.test(raw.trim())) {
    throw new OidcRpError("invalid_response", "OIDC response has an invalid Content-Length header");
  }

  const length = Number(raw);
  if (!Number.isSafeInteger(length)) {
    throw new OidcRpError("response_too_large", "OIDC response exceeds the byte limit");
  }
  if (length > maximum) {
    throw new OidcRpError("response_too_large", "OIDC response exceeds the byte limit");
  }
}

async function readBoundedBytes(
  response: Response,
  maximum: number,
  controller: AbortController,
): Promise<Uint8Array> {
  declaredContentLength(response.headers, maximum);
  const reader = response.body?.getReader();
  if (!reader) {
    throw new OidcRpError("invalid_json", "OIDC response does not contain JSON");
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  const cancelReader = (): void => {
    void reader.cancel(controller.signal.reason).catch(() => undefined);
  };
  controller.signal.addEventListener("abort", cancelReader, { once: true });

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximum) {
        controller.abort(
          new OidcRpError("response_too_large", "OIDC response exceeds the byte limit"),
        );
        throw new OidcRpError("response_too_large", "OIDC response exceeds the byte limit");
      }
      chunks.push(value);
    }
  } finally {
    controller.signal.removeEventListener("abort", cancelReader);
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function decodeJson(bytes: Uint8Array): unknown {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text) as unknown;
  } catch (cause) {
    throw new OidcRpError("invalid_json", "OIDC response is not valid JSON", { cause });
  }
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

export async function requestBoundedJson<T = unknown>(
  input: RequestInfo | URL,
  options: BoundedJsonRequestOptions<T> = {},
): Promise<BoundedJsonResponse<T>> {
  const timeoutMs = boundedPositiveInteger(
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    "timeoutMs",
    MAX_TIMEOUT_MS,
  );
  const maxResponseBytes = boundedPositiveInteger(
    options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
    "maxResponseBytes",
    MAX_RESPONSE_BYTES,
  );
  const accepted = acceptedMediaTypes(
    options.acceptedContentTypes ?? DEFAULT_ACCEPTED_CONTENT_TYPES,
  );
  // Cloudflare Workers only support redirect "follow" | "manual" — not "error".
  // Use manual and treat any 3xx as a hard failure so OIDC endpoints cannot be
  // silently redirected (same security intent as redirect:"error" in browsers).
  if (
    options.request?.redirect !== undefined &&
    options.request.redirect !== "error" &&
    options.request.redirect !== "manual"
  ) {
    throw new OidcRpError("invalid_configuration", "OIDC requests must reject redirects");
  }

  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const controller = new AbortController();
  const callerSignal = options.request?.signal;
  if (callerSignal?.aborted) {
    throw new OidcRpError("aborted", "OIDC request was aborted");
  }

  let rejectCallerAbort: ((reason: OidcRpError) => void) | undefined;
  const callerAbort = new Promise<never>((_resolve, reject) => {
    rejectCallerAbort = reject;
  });
  const onCallerAbort = (): void => {
    const error = new OidcRpError("aborted", "OIDC request was aborted");
    rejectCallerAbort?.(error);
    controller.abort(error);
  };
  callerSignal?.addEventListener("abort", onCallerAbort, { once: true });

  let rejectDeadline: ((reason: OidcRpError) => void) | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    rejectDeadline = reject;
  });
  const timer = setTimeout(() => {
    const error = new OidcRpError("timeout", "OIDC request timed out");
    rejectDeadline?.(error);
    controller.abort(error);
  }, timeoutMs);

  const operation = (async (): Promise<BoundedJsonResponse<T>> => {
    let response: Response;
    try {
      response = await fetchImpl(input, {
        ...options.request,
        redirect: "manual",
        signal: controller.signal,
      });
    } catch (cause) {
      if (cause instanceof OidcRpError) throw cause;
      throw new OidcRpError("network_error", "OIDC request failed", { cause });
    }

    if (response.status >= 300 && response.status < 400) {
      controller.abort();
      throw new OidcRpError(
        "http_status",
        `OIDC request was redirected with status ${response.status}`,
        { status: response.status },
      );
    }

    if (!response.ok) {
      controller.abort();
      throw new OidcRpError("http_status", `OIDC request failed with status ${response.status}`, {
        status: response.status,
      });
    }

    validateContentType(response.headers, accepted);
    const value = decodeJson(await readBoundedBytes(response, maxResponseBytes, controller));
    const context: BoundedJsonContext = {
      headers: response.headers,
      signal: controller.signal,
      status: response.status,
      url: response.url || requestUrl(input),
    };

    let transformed: T;
    try {
      transformed = options.transform ? await options.transform(value, context) : (value as T);
    } catch (cause) {
      if (cause instanceof OidcRpError) throw cause;
      throw new OidcRpError("invalid_response", "OIDC response validation failed", { cause });
    }

    return {
      headers: response.headers,
      status: response.status,
      url: context.url,
      value: transformed,
    };
  })();

  try {
    return await Promise.race([operation, deadline, callerAbort]);
  } catch (cause) {
    if (!controller.signal.aborted) controller.abort(cause);
    throw cause;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", onCallerAbort);
  }
}
