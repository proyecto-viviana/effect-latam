import { createThread, listThreads, getThread } from "../vendor/social/server/threads";
import { createPost, listPosts } from "../vendor/social/server/posts";
import { createReport } from "../vendor/social/server/reports";
import { evaluateAfterEvent } from "../vendor/social/achievements/events";
import type { AchievementsRegistry } from "../vendor/social/achievements/registry";
import { requireAuth, resolveAuth } from "../auth/resolve";
import { asSocialDb, getDb } from "../db";
import { decide } from "../entitlements/catalog";
import { forumPolicy } from "../forums/policy";
import { getForum } from "../forums/registry";
import { enforceAbuseLimit } from "../security/abuse";
import { readJsonBody } from "./body";
import { pageNumber } from "./pagination";

const MAX_REPORT_REASON_LENGTH = 2_000;
const MAX_THREAD_TITLE_LENGTH = 200;
const MAX_FORUM_BODY_LENGTH = 20_000;

export async function handleForumApi(
  request: Request,
  env: Env,
  pathname: string,
  registry: AchievementsRegistry,
): Promise<Response> {
  // GET /api/forum/threads?forumSlug=
  if (pathname === "/api/forum/threads" && request.method === "GET") {
    const url = new URL(request.url);
    const forumSlug = url.searchParams.get("forumSlug") || "";
    if (!getForum(forumSlug)) return Response.json({ error: "not_found" }, { status: 404 });
    if (!env.DB) return Response.json({ error: "unavailable" }, { status: 503 });
    const policy = forumPolicy(forumSlug, (await resolveAuth(request, env))?.user ?? null);
    if (!policy.canRead || !getForum(forumSlug)) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    const page = pageNumber(url.searchParams.get("page"));
    const result = await listThreads(asSocialDb(getDb(env.DB)), {
      forumSlug,
      page,
      limit: 20,
    });
    return Response.json(result);
  }

  // POST /api/forum/threads
  if (pathname === "/api/forum/threads" && request.method === "POST") {
    const auth = await requireAuth(request, env);
    if (auth instanceof Response) return auth;
    const limited = await enforceAbuseLimit(request, env, auth.user.id);
    if (limited) return limited;
    if (!decide(auth.user, "forum.thread.create").allowed) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.value as {
      forumSlug?: string;
      title?: string;
      content?: string;
    };
    if (
      typeof body.forumSlug !== "string" ||
      typeof body.title !== "string" ||
      typeof body.content !== "string"
    ) {
      return Response.json({ error: "invalid_content" }, { status: 400 });
    }
    const forumSlug = (body.forumSlug ?? "").trim();
    if (!forumPolicy(forumSlug, auth.user).canCreateThread) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    const title = body.title.trim();
    const content = body.content.trim();
    if (
      title.length === 0 ||
      title.length > MAX_THREAD_TITLE_LENGTH ||
      content.length === 0 ||
      content.length > MAX_FORUM_BODY_LENGTH
    ) {
      return Response.json({ error: "invalid_content" }, { status: 400 });
    }
    const sdb = asSocialDb(auth.db);
    const id = await createThread(sdb, auth.user.id, {
      forumSlug,
      title,
      content,
    });
    // createThread already dual-writes achievement_events; reconcile unlocks.
    await evaluateAfterEvent(
      sdb,
      registry,
      {
        id: `forum.thread.created:${id}`,
        userId: auth.user.id,
        type: "forum.thread.created",
        payload: { threadId: id },
      },
      { notify: true, notificationHref: "/logros" },
    );
    return Response.json({ id }, { status: 201 });
  }

  // GET /api/forum/threads/:id
  const threadMatch = pathname.match(/^\/api\/forum\/threads\/([^/]+)$/);
  if (threadMatch && request.method === "GET") {
    if (!env.DB) return Response.json({ error: "not_found" }, { status: 404 });
    const sdb = asSocialDb(getDb(env.DB));
    const thread = await getThread(sdb, threadMatch[1]!);
    if (!thread) return Response.json({ error: "not_found" }, { status: 404 });
    const policy = forumPolicy(thread.forumSlug, (await resolveAuth(request, env))?.user ?? null);
    if (!policy.canRead) return Response.json({ error: "not_found" }, { status: 404 });
    const posts = await listPosts(sdb, {
      threadId: thread.id,
      page: pageNumber(new URL(request.url).searchParams.get("page")),
      limit: 20,
    });
    return Response.json({ thread, posts });
  }

  // POST /api/forum/threads/:id/posts
  const replyMatch = pathname.match(/^\/api\/forum\/threads\/([^/]+)\/posts$/);
  if (replyMatch && request.method === "POST") {
    const auth = await requireAuth(request, env);
    if (auth instanceof Response) return auth;
    const limited = await enforceAbuseLimit(request, env, auth.user.id);
    if (limited) return limited;
    if (!decide(auth.user, "forum.reply.create").allowed) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    const sdb = asSocialDb(auth.db);
    const thread = await getThread(sdb, replyMatch[1]!);
    if (!thread) return Response.json({ error: "not_found" }, { status: 404 });
    if (!forumPolicy(thread.forumSlug, auth.user).canReply) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.value as { content?: string };
    if (typeof body.content !== "string") {
      return Response.json({ error: "invalid_content" }, { status: 400 });
    }
    const content = body.content.trim();
    if (content.length === 0 || content.length > MAX_FORUM_BODY_LENGTH) {
      return Response.json({ error: "invalid_content" }, { status: 400 });
    }
    const result = await createPost(sdb, auth.user.id, {
      threadId: thread.id,
      content,
    });
    // createPost already dual-writes achievement_events; reconcile unlocks.
    await evaluateAfterEvent(
      sdb,
      registry,
      {
        id: `forum.post.created:${result.id}`,
        userId: auth.user.id,
        type: "forum.post.created",
        payload: { postId: result.id, threadId: thread.id },
      },
      { notify: true, notificationHref: "/logros" },
    );
    return Response.json({ id: result.id }, { status: 201 });
  }

  // POST /api/forum/reports
  if (pathname === "/api/forum/reports" && request.method === "POST") {
    const auth = await requireAuth(request, env);
    if (auth instanceof Response) return auth;
    const limited = await enforceAbuseLimit(request, env, auth.user.id);
    if (limited) return limited;
    if (!decide(auth.user, "forum.report.create").allowed) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.value as {
      targetType?: "thread" | "post";
      targetId?: string;
      reason?: string;
    };
    if (
      (body.targetType !== "thread" && body.targetType !== "post") ||
      typeof body.targetId !== "string" ||
      body.targetId.trim().length === 0 ||
      body.targetId.length > 128 ||
      typeof body.reason !== "string" ||
      body.reason.trim().length === 0 ||
      body.reason.trim().length > MAX_REPORT_REASON_LENGTH
    ) {
      return Response.json({ error: "invalid_report" }, { status: 400 });
    }
    const result = await createReport(asSocialDb(auth.db), auth.user.id, {
      targetType: body.targetType,
      targetId: body.targetId.trim(),
      reason: body.reason.trim(),
    });
    if (result === "not_found") {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    if (result === "self_report") {
      return Response.json({ error: "self_report" }, { status: 400 });
    }
    return Response.json({ id: result.id }, { status: 201 });
  }

  return Response.json({ error: "not_found" }, { status: 404 });
}
