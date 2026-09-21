export const MAX_MUTATION_BYTES = 64 * 1024;

type JsonBodyResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; response: Response };

/** Read JSON without allowing chunked requests to bypass the Content-Length check. */
export async function readJsonBody(request: Request): Promise<JsonBodyResult> {
  if (!request.body) return { ok: true, value: {} };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_MUTATION_BYTES) {
        await reader.cancel().catch(() => undefined);
        return {
          ok: false,
          response: Response.json({ error: "payload_too_large" }, { status: 413 }),
        };
      }
      chunks.push(value);
    }
  } catch {
    return {
      ok: false,
      response: Response.json({ error: "invalid_body" }, { status: 400 }),
    };
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const value = text.length === 0 ? {} : JSON.parse(text);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new TypeError("JSON body must be an object");
    }
    return { ok: true, value: value as Record<string, unknown> };
  } catch {
    return {
      ok: false,
      response: Response.json({ error: "invalid_json" }, { status: 400 }),
    };
  }
}
