/// <reference types="vite/client" />
import { createStartHandler, defaultStreamHandler } from "@tanstack/solid-start/server";
import { handleApiRoute } from "./api/handler";
import { finalizeResponse } from "./security/response";

const tanstackFetch = createStartHandler((ctx) => defaultStreamHandler(ctx)) as (
  request: Request,
  ...args: unknown[]
) => Promise<Response>;

const CANONICAL_ORIGIN = "https://effectlatam.com";

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext) {
    try {
      const url = new URL(request.url);
      if (url.hostname === "www.effectlatam.com") {
        // Assign path and query after fixing the origin; a // path is not a URL authority.
        const destination = new URL(CANONICAL_ORIGIN);
        destination.pathname = url.pathname;
        destination.search = url.search;
        return finalizeResponse(
          request,
          new Response(null, {
            status: 308,
            headers: { Location: destination.toString() },
          }),
        );
      }
      const api = await handleApiRoute(request, env);
      if (api) return finalizeResponse(request, api);
      const response = await tanstackFetch(request, { context: { env } });
      return finalizeResponse(request, response);
    } catch (err) {
      console.error("[effect-latam] unhandled", err);
      return finalizeResponse(
        request,
        Response.json({ error: "Internal server error" }, { status: 500 }),
      );
    }
  },
};
