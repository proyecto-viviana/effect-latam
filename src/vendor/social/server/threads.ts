import { and, desc, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { alias } from "drizzle-orm/sqlite-core";
import { users } from "../db/users";
import type { Db } from "../db";
import { achievementEvents } from "../achievements/db/schema";
import { contentCreateOperations, threads } from "../db/schema";
import { recordEvent, recordEventAfterPreviousChange } from "../achievements/events";
import { canModerateForum, type ForumActor } from "../permissions";
import { insertModerationActionAfterPreviousChange } from "./moderation";
import type {
  Author,
  CreateThreadInput,
  MutationResult,
  PaginatedResponse,
  ThreadListQuery,
  ThreadWithAuthor,
} from "../types";
import {
  classifyCommittedContentCreateOperation,
  classifyExistingContentCreateOperation,
  prepareContentCreateCommand,
  type ContentCreatePreflightResult,
  type ContentCreateThreadCommand,
  type PreparedContentCreateThreadCommand,
} from "./content-create";
import { readContentCreateOperation } from "./content-create-store";

const DEFAULT_LIMIT = 20;
const DELETED_AUTHOR_NAME = "Cuenta eliminada";

/**
 * Length backstops mirrored from the host zod schemas (FORUM-7). The package
 * truncates to these so an oversized title/body can't reach the DB even when a
 * caller skips validation; rejecting the request stays the host's job.
 */
export const THREAD_TITLE_MAX_LENGTH = 200;
export const FORUM_BODY_MAX_LENGTH = 20_000;

export interface ExecuteCreateThreadCommandOptions {
  now?: Date;
  randomId?: () => string;
}

export type ExecuteCreateThreadCommandResult =
  | {
      outcome: "applied";
      operationId: string;
      id: string;
      callerMayCommitEffects: true;
    }
  | {
      outcome: "replayed";
      operationId: string;
      id: string;
      callerMayCommitEffects: false;
    }
  | {
      outcome: "operation_conflict";
      operationId: string;
      callerMayCommitEffects: false;
    };

// Second `users` alias so a thread row can join both its original author and the
// author of its most recent reply (last_reply_author_id) in one query.
const lastReplyAuthor = alias(users, "last_reply_author");

function normalizeThreadSearch(q: string | undefined): string {
  return (q ?? "").trim().replace(/\s+/g, " ").slice(0, 100);
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function buildThreadWhere(query: ThreadListQuery): SQL | undefined {
  const conditions: SQL[] = [eq(threads.forumSlug, query.forumSlug), isNull(threads.deletedAt)];
  const q = normalizeThreadSearch(query.q);

  if (q) {
    const pattern = `%${escapeLikePattern(q.toLowerCase())}%`;
    conditions.push(
      or(
        sql`lower(${threads.title}) like ${pattern} escape '\\'`,
        sql`lower(${threads.content}) like ${pattern} escape '\\'`,
      )!,
    );
  }

  if (query.status === "open") {
    conditions.push(eq(threads.isLocked, false));
  } else if (query.status === "locked") {
    conditions.push(eq(threads.isLocked, true));
  }

  return and(...conditions);
}

function threadOrderBy(query: ThreadListQuery): SQL[] {
  if (query.sort === "newest") {
    return [desc(threads.isPinned), desc(threads.createdAt), desc(threads.id)];
  }
  if (query.sort === "replies") {
    return [
      desc(threads.isPinned),
      desc(threads.replyCount),
      desc(threads.lastReplyAt),
      desc(threads.createdAt),
      desc(threads.id),
    ];
  }
  return [
    desc(threads.isPinned),
    desc(threads.lastReplyAt),
    desc(threads.createdAt),
    desc(threads.id),
  ];
}

/**
 * Forum content must outlive the account that wrote it. Reads LEFT JOIN users
 * (not INNER — that silently dropped every thread/post by a removed user) and
 * map a missing author to a stable "deleted" placeholder.
 */
export function presentAuthor(
  authorId: string,
  joined: {
    id: string | null;
    username: string | null;
    name: string | null;
    avatarUrl: string | null;
  } | null,
): Author {
  if (joined?.id == null) {
    return { id: authorId, username: null, name: DELETED_AUTHOR_NAME, avatarUrl: null };
  }
  return {
    id: joined.id,
    username: joined.username,
    name: joined.name,
    avatarUrl: joined.avatarUrl,
  };
}

export function presentThreadRecord(row: typeof threads.$inferSelect) {
  const { nextReplyOrdinal, ...thread } = row;
  void nextReplyOrdinal;
  return thread;
}

export async function listThreads(
  db: Db,
  query: ThreadListQuery,
): Promise<PaginatedResponse<ThreadWithAuthor>> {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(100, query.limit ?? DEFAULT_LIMIT);
  const offset = (page - 1) * limit;
  const where = buildThreadWhere(query);

  const rows = await db
    .select({
      thread: threads,
      author: {
        id: users.id,
        username: users.username,
        name: users.name,
        avatarUrl: users.avatarUrl,
      },
      replyAuthor: {
        id: lastReplyAuthor.id,
        username: lastReplyAuthor.username,
        name: lastReplyAuthor.name,
        avatarUrl: lastReplyAuthor.avatarUrl,
      },
    })
    .from(threads)
    .leftJoin(users, eq(threads.authorId, users.id))
    .leftJoin(lastReplyAuthor, eq(threads.lastReplyAuthorId, lastReplyAuthor.id))
    .where(where)
    .orderBy(...threadOrderBy(query))
    .limit(limit)
    .offset(offset);

  const totalRow = await db
    .select({ count: sql<number>`count(*)` })
    .from(threads)
    .where(where);
  const total = totalRow[0]?.count ?? 0;

  const items = rows.map((r) => ({
    ...presentThreadRecord(r.thread),
    author: presentAuthor(r.thread.authorId, r.author),
    lastReplyAuthor: r.thread.lastReplyAuthorId
      ? presentAuthor(r.thread.lastReplyAuthorId, r.replyAuthor)
      : null,
  }));

  return { items, total, page, limit, hasMore: offset + items.length < total };
}

export async function getThread(db: Db, id: string): Promise<ThreadWithAuthor | null> {
  const rows = await db
    .select({
      thread: threads,
      author: {
        id: users.id,
        username: users.username,
        name: users.name,
        avatarUrl: users.avatarUrl,
      },
      replyAuthor: {
        id: lastReplyAuthor.id,
        username: lastReplyAuthor.username,
        name: lastReplyAuthor.name,
        avatarUrl: lastReplyAuthor.avatarUrl,
      },
    })
    .from(threads)
    .leftJoin(users, eq(threads.authorId, users.id))
    .leftJoin(lastReplyAuthor, eq(threads.lastReplyAuthorId, lastReplyAuthor.id))
    .where(and(eq(threads.id, id), isNull(threads.deletedAt)))
    .limit(1);
  if (rows.length === 0) return null;
  return {
    ...presentThreadRecord(rows[0].thread),
    author: presentAuthor(rows[0].thread.authorId, rows[0].author),
    lastReplyAuthor: rows[0].thread.lastReplyAuthorId
      ? presentAuthor(rows[0].thread.lastReplyAuthorId, rows[0].replyAuthor)
      : null,
  };
}

export async function createThread(
  db: Db,
  authorId: string,
  input: CreateThreadInput,
): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date();
  await db.batch([
    db.insert(threads).values({
      id,
      forumSlug: input.forumSlug,
      title: input.title.trim().slice(0, THREAD_TITLE_MAX_LENGTH),
      content: input.content.trim().slice(0, FORUM_BODY_MAX_LENGTH),
      authorId,
      createdAt: now,
      updatedAt: now,
    }),
    recordEvent(
      db,
      {
        id: `forum.thread.created:${id}`,
        userId: authorId,
        type: "forum.thread.created",
        payload: { threadId: id },
        ts: now,
      },
      { mode: "statement" },
    ),
  ]);
  return id;
}

/** Classify a thread operation before host-owned mutable write-policy gates. */
export async function preflightCreateThreadCommand(
  db: Db,
  input: ContentCreateThreadCommand,
): Promise<ContentCreatePreflightResult> {
  const prepared = await prepareContentCreateCommand(input);
  if (prepared.kind !== "thread") throw new TypeError("expected a thread content-create command");
  return classifyExistingContentCreateOperation(
    prepared,
    await readContentCreateOperation(db, prepared.operationId),
  );
}

function threadEffectOwner(
  command: PreparedContentCreateThreadCommand,
  candidateThreadId: string,
): SQL {
  return sql`EXISTS (
    SELECT 1
    FROM ${contentCreateOperations} AS operation
    WHERE operation.id = ${command.operationId}
      AND operation.contract_version = ${command.contractVersion}
      AND operation.fingerprint = ${command.fingerprint}
      AND operation.kind = 'thread'
      AND operation.actor_id = ${command.actorId}
      AND operation.requested_thread_id IS NULL
      AND operation.requested_forum_slug = ${command.forumSlug}
      AND operation.result_post_id IS NULL
      AND operation.result_thread_id = ${candidateThreadId}
  )`;
}

/** Retry-safe thread creation for hosts that explicitly adopt the operation contract. */
export async function executeCreateThreadCommand(
  db: Db,
  input: ContentCreateThreadCommand,
  options: ExecuteCreateThreadCommandOptions = {},
): Promise<ExecuteCreateThreadCommandResult> {
  const prepared = await prepareContentCreateCommand(input);
  if (prepared.kind !== "thread") throw new TypeError("expected a thread content-create command");

  const preflight = classifyExistingContentCreateOperation(
    prepared,
    await readContentCreateOperation(db, prepared.operationId),
  );
  if (preflight.outcome !== "fresh") return preflight;

  const threadId = options.randomId?.() ?? crypto.randomUUID();
  const committedAt = options.now ?? new Date();
  const committedAtSeconds = Math.floor(committedAt.getTime() / 1_000);
  const effectOwner = threadEffectOwner(prepared, threadId);
  const claim = db
    .insert(contentCreateOperations)
    .select(sql`
      SELECT ${prepared.operationId}, ${prepared.contractVersion}, ${prepared.fingerprint},
             'thread', ${prepared.actorId}, NULL, ${prepared.forumSlug},
             NULL, ${threadId}, ${committedAtSeconds}
      WHERE NOT EXISTS (
        SELECT 1 FROM ${contentCreateOperations}
        WHERE ${contentCreateOperations.id} = ${prepared.operationId}
      )
    `)
    .returning({ id: contentCreateOperations.id });
  const threadInsert = db.insert(threads).select(sql`
    SELECT ${threadId}, ${prepared.forumSlug}, ${prepared.title}, ${prepared.content},
           ${prepared.actorId}, ${committedAtSeconds}, ${committedAtSeconds},
           0, NULL, NULL, 1, 0, 0, NULL, NULL
    WHERE ${effectOwner}
  `);
  const eventInsert = db.insert(achievementEvents).select(sql`
    SELECT NULL, ${`forum.thread.created:${threadId}`}, ${prepared.actorId},
           'forum.thread.created', json_object('threadId', ${threadId}), ${committedAtSeconds}
    WHERE ${effectOwner}
  `);
  const statements: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] = [
    claim,
    threadInsert,
    eventInsert,
  ];
  const batchResults = await db.batch(statements);

  const callerClaimed = Array.isArray(batchResults[0]) && batchResults[0].length === 1;
  const committed = classifyCommittedContentCreateOperation(
    prepared,
    threadId,
    callerClaimed,
    await readContentCreateOperation(db, prepared.operationId),
  );
  if (committed.outcome === "unclaimed") {
    throw new Error("CONTENT_CREATE_OPERATION_UNCLAIMED");
  }
  return committed;
}

/** Edit a thread's title/body. Author-only (404 vs 403, not row-count inferred). */
export async function updateThread(
  db: Db,
  threadId: string,
  authorId: string,
  input: { title: string; content: string },
): Promise<MutationResult> {
  const [row] = await db
    .select({ authorId: threads.authorId })
    .from(threads)
    .where(eq(threads.id, threadId))
    .limit(1);
  if (!row) return "not_found";
  if (row.authorId !== authorId) return "forbidden";
  await db
    .update(threads)
    .set({
      title: input.title.trim().slice(0, THREAD_TITLE_MAX_LENGTH),
      content: input.content.trim().slice(0, FORUM_BODY_MAX_LENGTH),
      updatedAt: new Date(),
    })
    .where(eq(threads.id, threadId));
  return "ok";
}

/**
 * Pin/lock a thread. Moderator action (the API gates with `requireRole`), so
 * unlike the author-scoped mutations there's no ownership check here — only the
 * live-thread existence check. Partial: only the provided flags change.
 */
/** The forum slug of a live thread — for per-forum authorization pre-checks. */
export async function getThreadForumSlug(db: Db, threadId: string): Promise<string | null> {
  const [row] = await db
    .select({ forumSlug: threads.forumSlug })
    .from(threads)
    .where(and(eq(threads.id, threadId), isNull(threads.deletedAt)))
    .limit(1);
  return row?.forumSlug ?? null;
}

export async function setThreadModeration(
  db: Db,
  threadId: string,
  patch: { isPinned?: boolean; isLocked?: boolean },
): Promise<MutationResult> {
  const [row] = await db
    .select({ id: threads.id })
    .from(threads)
    .where(and(eq(threads.id, threadId), isNull(threads.deletedAt)))
    .limit(1);
  if (!row) return "not_found";

  const set: { isPinned?: boolean; isLocked?: boolean } = {};
  if (patch.isPinned !== undefined) set.isPinned = patch.isPinned;
  if (patch.isLocked !== undefined) set.isLocked = patch.isLocked;
  if (Object.keys(set).length > 0) {
    await db.update(threads).set(set).where(eq(threads.id, threadId));
  }
  return "ok";
}

/**
 * Soft-delete a thread. The author may always remove their own; a moderator
 * with jurisdiction over the thread's forum (or global_moderator/admin) may
 * take it down — a takedown additionally writes a `delete_content` ledger row
 * in the same transaction. Hides it (and, via getThread, its posts).
 */
export async function softDeleteThread(
  db: Db,
  threadId: string,
  actor: ForumActor,
  opts: { reason?: string; authorityCondition?: SQL } = {},
): Promise<MutationResult> {
  const [row] = await db
    .select({
      authorId: threads.authorId,
      forumSlug: threads.forumSlug,
      deletedAt: threads.deletedAt,
    })
    .from(threads)
    .where(eq(threads.id, threadId))
    .limit(1);
  if (!row) return "not_found";
  const isAuthor = row.authorId === actor.userId;
  if (!isAuthor && !canModerateForum(actor, row.forumSlug)) return "forbidden";
  if (row.deletedAt && !opts.authorityCondition) return "ok";
  const now = new Date();
  const authorityCondition = opts.authorityCondition ?? sql`1 = 1`;
  const authoritySnapshot = db
    .select({ allowed: sql<number>`CASE WHEN ${authorityCondition} THEN 1 ELSE 0 END` })
    .from(threads)
    .where(eq(threads.id, threadId))
    .limit(1);
  // Atomic: soft-delete + the compensating achievement event ride one transaction
  // so the `forum.threads` count re-folds correctly (ACHIEVE-1). The event's
  // userId is always the AUTHOR's — it re-folds their counts even on a takedown.
  // Idempotent — only the request that changes deleted_at owns the event and
  // optional moderation audit. Replays cannot overwrite deletion provenance.
  const deleteUpdate = db
    .update(threads)
    .set({ deletedAt: now, deletedBy: actor.userId })
    .where(and(eq(threads.id, threadId), isNull(threads.deletedAt), authorityCondition));
  const eventInsert = recordEventAfterPreviousChange(db, {
    id: `forum.thread.deleted:${threadId}`,
    userId: row.authorId,
    type: "forum.thread.deleted",
    payload: { threadId },
    ts: now,
  });
  let results: Awaited<ReturnType<Db["batch"]>>;
  if (isAuthor) {
    results = await db.batch([authoritySnapshot, deleteUpdate, eventInsert]);
  } else {
    results = await db.batch([
      authoritySnapshot,
      deleteUpdate,
      eventInsert,
      insertModerationActionAfterPreviousChange(db, {
        actorId: actor.userId,
        action: "delete_content",
        targetType: "thread",
        targetId: threadId,
        reason: opts.reason,
      }),
    ]);
  }
  const authorityRows = results[0];
  if (authorityRows.length === 0) return "not_found";
  if (authorityRows[0]?.allowed !== 1) return "forbidden";
  return "ok";
}
