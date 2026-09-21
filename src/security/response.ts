/** Finalize host responses without mutating immutable fetch or redirect headers. */
export function finalizeResponse(request: Request, response: Response): Response {
  // Transfer the body stream without buffering it; copy status and every header,
  // including separate Set-Cookie values, into a mutable response.
  const result = new Response(response.body, response);
  const url = new URL(request.url);

  result.headers.set("X-Content-Type-Options", "nosniff");
  result.headers.set("X-Frame-Options", "DENY");
  result.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  result.headers.set("X-DNS-Prefetch-Control", "off");
  result.headers.set("Permissions-Policy", "camera=(), geolocation=(), microphone=()");
  result.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  if (url.protocol === "https:") {
    result.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  if (url.pathname.startsWith("/api/")) {
    result.headers.set("Cache-Control", "private, no-store");
    const vary = result.headers
      .get("Vary")
      ?.split(",")
      .map((field) => field.trim().toLowerCase());
    if (!vary?.includes("cookie") && !vary?.includes("*")) {
      result.headers.append("Vary", "Cookie");
    }
  }

  return result;
}
