import { and, asc, eq, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { users } from "../db/users";
import type { Db } from "../db";
import { achievementEvents } from "../achievements/db/schema";
import { contentCreateOperations, notifications, posts, signatures, threads } from "../db/schema";
import { recordEvent, recordEventAfterPreviousChange } from "../achievements/events";
import type {
  CreatePostInput,
  CreatePostResult,
  MutationResult,
  NotifiedRecipient,
  PaginatedResponse,
  PostListQuery,
  PostWithAuthor,
} from "../types";
import { canModerateForum, type ForumActor } from "../permissions";
import { buildPostNotificationRows } from "./notifications";
import { insertModerationActionAfterPreviousChange } from "./moderation";
import { FORUM_BODY_MAX_LENGTH, getThread, presentAuthor } from "./threads";
import {
  classifyCommittedContentCreateOperation,
  classifyExistingContentCreateOperation,
  prepareContentCreateCommand,
  type ContentCreatePreflightResult,
  type ContentCreateReplyCommand,
  type PreparedContentCreateReplyCommand,
} from "./content-create";
import { readContentCreateOperation } from "./content-create-store";

const DEFAULT_LIMIT = 50;
const CREATE_POST_PARENT_NOT_FOUND_MARKER = "CREATE_POST_PARENT_NOT_FOUND";
const CREATE_POST_PARENT_LOCKED_MARKER = "CREATE_POST_PARENT_LOCKED";

export type CreatePostErrorCode = "THREAD_NOT_FOUND" | "THREAD_LOCKED";

export class CreatePostError extends Error {
  readonly code: CreatePostErrorCode;

  constructor(code: CreatePostErrorCode) {
    super(code);
    this.name = "CreatePostError";
    this.code = code;
  }
}

function createPostCommitErrorCode(error: unknown): CreatePostErrorCode | undefined {
  const seen = new Set<unknown>();
  let current = error;

  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if (current.message.includes(CREATE_POST_PARENT_NOT_FOUND_MARKER)) {
      return "THREAD_NOT_FOUND";
    }
    if (current.message.includes(CREATE_POST_PARENT_LOCKED_MARKER)) {
      return "THREAD_LOCKED";
    }
    current = current.cause;
  }

  return undefined;
}

export interface CreatePostCommitContext {
  postId: string;
  threadId: string;
  actorId: string;
  notifications: ReadonlyArray<{
    notificationId: string;
    recipientId: string;
    type: "reply" | "mention";
  }>;
}

export interface CreatePostOptions {
  /** Host-owned writes that must commit atomically with the post and notifications. */
  buildAdditionalStatements?: (
    context: CreatePostCommitContext,
  ) => Promise<ReadonlyArray<BatchItem<"sqlite">>>;
}

export interface CreatePostCommandCommitContext extends CreatePostCommitContext {
  /** Exact durable ownership proof for this invocation's candidate post. */
  effectOwner: SQL;
  committedAt: Date;
}

export interface ExecuteCreatePostCommandOptions {
  /** Host-owned writes that must use `effectOwner` and join the same D1 batch. */
  buildAdditionalStatements?: (
    context: CreatePostCommandCommitContext,
  ) => Promise<ReadonlyArray<BatchItem<"sqlite">>>;
  now?: Date;
  randomId?: () => string;
}

export type ExecuteCreatePostCommandResult =
  | {
      outcome: "applied";
      operationId: string;
      id: string;
      notified: NotifiedRecipient[];
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

/** Classify a reply operation before host-owned mutable write-policy gates. */
export async function preflightCreatePostCommand(
  db: Db,
  input: ContentCreateReplyCommand,
): Promise<ContentCreatePreflightResult> {
  const prepared = await prepareContentCreateCommand(input);
  if (prepared.kind !== "reply") throw new TypeError("expected a reply content-create command");
  return classifyExistingContentCreateOperation(
    prepared,
    await readContentCreateOperation(db, prepared.operationId),
  );
}

function replyEffectOwner(
  command: PreparedContentCreateReplyCommand,
  candidatePostId: string,
): SQL {
  return sql`EXISTS (
    SELECT 1
    FROM ${contentCreateOperations} AS operation
    WHERE operation.id = ${command.operationId}
      AND operation.contract_version = ${command.contractVersion}
      AND operation.fingerprint = ${command.fingerprint}
      AND operation.kind = 'reply'
      AND operation.actor_id = ${command.actorId}
      AND operation.requested_thread_id = ${command.threadId}
      AND operation.result_post_id = ${candidatePostId}
  )`;
}

function postTransitionEventId(
  type: "forum.post.deleted" | "forum.post.restored",
  postId: string,
): string {
  return `${type}:${postId}:${crypto.randomUUID()}`;
}

export async function listPosts(
  db: Db,
  query: PostListQuery,
): Promise<PaginatedResponse<PostWithAuthor>> {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(100, query.limit ?? DEFAULT_LIMIT);
  const offset = (page - 1) * limit;

  const rows = await db
    .select({
      post: posts,
      author: {
        id: users.id,
        username: users.username,
        name: users.name,
        avatarUrl: users.avatarUrl,
      },
      signature: signatures.content,
    })
    .from(posts)
    .leftJoin(users, eq(posts.authorId, users.id))
    .leftJoin(signatures, eq(signatures.userId, posts.authorId))
    .where(and(eq(posts.threadId, query.threadId), isNull(posts.deletedAt)))
    .orderBy(asc(posts.replyOrdinal))
    .limit(limit)
    .offset(offset);

  const totalRow = await db
    .select({ count: sql<number>`count(*)` })
    .from(posts)
    .where(and(eq(posts.threadId, query.threadId), isNull(posts.deletedAt)));
  const total = totalRow[0]?.count ?? 0;

  const items = rows.map((r) => ({
    ...r.post,
    author: presentAuthor(r.post.authorId, r.author),
    signature: r.signature ?? null,
  }));
  return { items, total, page, limit, hasMore: offset + items.length < total };
}

export async function createPost(
  db: Db,
  authorId: string,
  input: CreatePostInput,
  options: CreatePostOptions = {},
): Promise<CreatePostResult> {
  const thread = await getThread(db, input.threadId);
  if (!thread) throw new CreatePostError("THREAD_NOT_FOUND");
  if (thread.isLocked) throw new CreatePostError("THREAD_LOCKED");

  const id = crypto.randomUUID();
  const now = new Date();
  // Resolve reply/@mention recipients before the batch so their inserts ride
  // along atomically with the post (they can't desync from it).
  const notifRows = await buildPostNotificationRows(db, {
    threadId: input.threadId,
    postId: id,
    actorId: authorId,
    content: input.content,
    threadAuthorId: thread.author.id,
  });

  const postInsert = db.insert(posts).values({
    id,
    threadId: input.threadId,
    content: input.content.trim().slice(0, FORUM_BODY_MAX_LENGTH),
    authorId,
    createdAt: now,
    updatedAt: now,
  });
  const eventInsert = recordEvent(
    db,
    {
      id: `forum.post.created:${id}`,
      userId: authorId,
      type: "forum.post.created",
      payload: { postId: id, threadId: input.threadId },
      ts: now,
    },
    { mode: "statement" },
  );
  // Atomic: a D1 batch is a transaction, so the post insert, the denormalized
  // reply-count update, the achievement event, and the notifications can't
  // desync if one fails.
  const replyCountUpdate = db
    .update(threads)
    .set({
      replyCount: sql`${threads.replyCount} + 1`,
      lastReplyAt: now,
      lastReplyAuthorId: authorId,
    })
    .where(eq(threads.id, input.threadId));

  const additionalStatements =
    (await options.buildAdditionalStatements?.({
      postId: id,
      threadId: input.threadId,
      actorId: authorId,
      notifications: notifRows.map((row) => ({
        notificationId: row.id,
        recipientId: row.recipientId,
        type: row.type,
      })),
    })) ?? [];
  const statements: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] = [
    postInsert,
    replyCountUpdate,
    eventInsert,
  ];
  if (notifRows.length > 0) statements.push(db.insert(notifications).values(notifRows));
  statements.push(...additionalStatements);
  try {
    await db.batch(statements);
  } catch (error) {
    const code = createPostCommitErrorCode(error);
    if (code) throw new CreatePostError(code);
    throw error;
  }

  return {
    id,
    notified: notifRows.map((r) => ({ recipientId: r.recipientId, type: r.type })),
  };
}

/**
 * Retry-safe reply creation. This is deliberately opt-in while host APIs adopt
 * the operation contract; legacy `createPost` keeps its existing behavior.
 */
export async function executeCreatePostCommand(
  db: Db,
  input: ContentCreateReplyCommand,
  options: ExecuteCreatePostCommandOptions = {},
): Promise<ExecuteCreatePostCommandResult> {
  const prepared = await prepareContentCreateCommand(input);
  if (prepared.kind !== "reply") throw new TypeError("expected a reply content-create command");

  const preflight = classifyExistingContentCreateOperation(
    prepared,
    await readContentCreateOperation(db, prepared.operationId),
  );
  if (preflight.outcome !== "fresh") return preflight;

  const thread = await getThread(db, prepared.threadId);
  if (!thread) throw new CreatePostError("THREAD_NOT_FOUND");
  if (thread.isLocked) throw new CreatePostError("THREAD_LOCKED");

  const postId = options.randomId?.() ?? crypto.randomUUID();
  const committedAt = options.now ?? new Date();
  const committedAtSeconds = Math.floor(committedAt.getTime() / 1_000);
  const effectOwner = replyEffectOwner(prepared, postId);
  const notifRows = await buildPostNotificationRows(db, {
    threadId: prepared.threadId,
    postId,
    actorId: prepared.actorId,
    content: prepared.content,
    threadAuthorId: thread.author.id,
  });

  const claim = db
    .insert(contentCreateOperations)
    .select(sql`
      SELECT ${prepared.operationId}, ${prepared.contractVersion}, ${prepared.fingerprint},
             'reply', ${prepared.actorId}, ${prepared.threadId}, NULL,
             ${postId}, NULL, ${committedAtSeconds}
      FROM ${threads}
      WHERE ${threads.id} = ${prepared.threadId}
        AND ${threads.deletedAt} IS NULL
        AND ${threads.isLocked} = 0
        AND NOT EXISTS (
          SELECT 1 FROM ${contentCreateOperations}
          WHERE ${contentCreateOperations.id} = ${prepared.operationId}
        )
    `)
    .returning({ id: contentCreateOperations.id });
  const postInsert = db.insert(posts).select(sql`
    SELECT ${postId}, ${prepared.threadId}, ${prepared.content}, ${prepared.actorId},
           ${committedAtSeconds}, ${committedAtSeconds}, 0, 0, NULL, NULL
    WHERE ${effectOwner}
  `);
  const replyCountUpdate = db
    .update(threads)
    .set({
      replyCount: sql`${threads.replyCount} + 1`,
      lastReplyAt: committedAt,
      lastReplyAuthorId: prepared.actorId,
    })
    .where(and(eq(threads.id, prepared.threadId), effectOwner));
  const eventInsert = db.insert(achievementEvents).select(sql`
    SELECT NULL, ${`forum.post.created:${postId}`}, ${prepared.actorId},
           'forum.post.created',
           json_object('postId', ${postId}, 'threadId', ${prepared.threadId}),
           ${committedAtSeconds}
    WHERE ${effectOwner}
  `);
  const notificationInserts = notifRows.map((row) =>
    db.insert(notifications).select(sql`
      SELECT ${row.id}, ${row.recipientId}, ${row.type}, ${row.threadId ?? null},
             ${row.postId ?? null}, ${row.actorId ?? null}, ${row.payloadJson ?? "{}"},
             NULL,
             ${row.readAt ? Math.floor(row.readAt.getTime() / 1_000) : null},
             ${Math.floor((row.createdAt ?? committedAt).getTime() / 1_000)}
      WHERE ${effectOwner}
    `),
  );
  const additionalStatements =
    (await options.buildAdditionalStatements?.({
      postId,
      threadId: prepared.threadId,
      actorId: prepared.actorId,
      notifications: notifRows.map((row) => ({
        notificationId: row.id,
        recipientId: row.recipientId,
        type: row.type,
      })),
      effectOwner,
      committedAt,
    })) ?? [];

  const statements: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] = [
    claim,
    postInsert,
    replyCountUpdate,
    eventInsert,
    ...notificationInserts,
    ...additionalStatements,
  ];
  let batchResults: Awaited<ReturnType<Db["batch"]>>;
  try {
    batchResults = await db.batch(statements);
  } catch (error) {
    const code = createPostCommitErrorCode(error);
    if (code) throw new CreatePostError(code);
    throw error;
  }

  const callerClaimed = Array.isArray(batchResults[0]) && batchResults[0].length === 1;
  const committed = classifyCommittedContentCreateOperation(
    prepared,
    postId,
    callerClaimed,
    await readContentCreateOperation(db, prepared.operationId),
  );
  if (committed.outcome === "unclaimed") {
    const currentThread = await getThread(db, prepared.threadId);
    if (!currentThread) throw new CreatePostError("THREAD_NOT_FOUND");
    if (currentThread.isLocked) throw new CreatePostError("THREAD_LOCKED");
    throw new Error("CONTENT_CREATE_OPERATION_UNCLAIMED");
  }
  if (committed.outcome !== "applied") return committed;
  return {
    ...committed,
    notified: notifRows.map((row) => ({ recipientId: row.recipientId, type: row.type })),
  };
}

/** Edit a post's content. Author-only: returns "not_found" / "forbidden" so the
 * caller can answer 404 vs 403 without inferring permission from rows touched. */
export async function updatePost(
  db: Db,
  postId: string,
  authorId: string,
  content: string,
): Promise<MutationResult> {
  const [row] = await db
    .select({ authorId: posts.authorId })
    .from(posts)
    .where(eq(posts.id, postId))
    .limit(1);
  if (!row) return "not_found";
  if (row.authorId !== authorId) return "forbidden";
  await db
    .update(posts)
    .set({
      content: content.trim().slice(0, FORUM_BODY_MAX_LENGTH),
      isEdited: true,
      updatedAt: new Date(),
    })
    .where(eq(posts.id, postId));
  return "ok";
}

/**
 * Soft-delete a post. The author may always remove their own; a moderator with
 * jurisdiction over the parent thread's forum (or global_moderator/admin) may
 * take it down — a takedown additionally writes a `delete_content` ledger row
 * in the same transaction. Hides it and decrements the thread's reply_count in
 * the same batch (transaction). Idempotent.
 */
export async function softDeletePost(
  db: Db,
  postId: string,
  actor: ForumActor,
  opts: { reason?: string; authorityCondition?: SQL } = {},
): Promise<MutationResult> {
  const [row] = await db
    .select({
      authorId: posts.authorId,
      threadId: posts.threadId,
      deletedAt: posts.deletedAt,
      forumSlug: threads.forumSlug,
    })
    .from(posts)
    .innerJoin(threads, eq(posts.threadId, threads.id))
    .where(eq(posts.id, postId))
    .limit(1);
  if (!row) return "not_found";
  const isAuthor = row.authorId === actor.userId;
  if (!isAuthor && !canModerateForum(actor, row.forumSlug)) return "forbidden";
  if (row.deletedAt && !opts.authorityCondition) return "ok";
  const now = new Date();
  const authorityCondition = opts.authorityCondition ?? sql`1 = 1`;
  const authoritySnapshot = db
    .select({ allowed: sql<number>`CASE WHEN ${authorityCondition} THEN 1 ELSE 0 END` })
    .from(posts)
    .where(eq(posts.id, postId))
    .limit(1);
  // The compensating event re-folds the `forum.posts` count after deletion
  // (ACHIEVE-1) — its userId is always the AUTHOR's, even on a takedown; it
  // rides the same transaction as the soft-delete and the reply-count
  // decrement. Each attempt gets a collision-resistant identity; the guarded
  // update still ensures only a real transition owns an event.
  const eventId = postTransitionEventId("forum.post.deleted", postId);
  const deleteUpdate = db
    .update(posts)
    .set({ deletedAt: now, deletedBy: actor.userId })
    .where(and(eq(posts.id, postId), isNull(posts.deletedAt), authorityCondition));
  const counterUpdate = db
    .update(threads)
    .set({
      replyCount: sql`MAX(0, ${threads.replyCount} - 1)`,
      // FORUM-4: when the deleted post was the newest reply, the denormalized
      // last_reply_* used to keep pointing at it. Recompute from the surviving
      // posts (the subqueries exclude this post explicitly, so they're correct
      // whether or not the delete above is visible yet within the batch).
      lastReplyAt: sql`(SELECT ${posts.createdAt} FROM ${posts} WHERE ${posts.threadId} = ${row.threadId} AND ${posts.deletedAt} IS NULL AND ${posts.id} <> ${postId} ORDER BY ${posts.replyOrdinal} DESC LIMIT 1)`,
      lastReplyAuthorId: sql`(SELECT ${posts.authorId} FROM ${posts} WHERE ${posts.threadId} = ${row.threadId} AND ${posts.deletedAt} IS NULL AND ${posts.id} <> ${postId} ORDER BY ${posts.replyOrdinal} DESC LIMIT 1)`,
    })
    .where(and(eq(threads.id, row.threadId), sql`changes() = 1`));
  const eventInsert = recordEventAfterPreviousChange(db, {
    id: eventId,
    userId: row.authorId,
    type: "forum.post.deleted",
    payload: { postId, threadId: row.threadId },
    ts: now,
  });
  let results: Awaited<ReturnType<Db["batch"]>>;
  if (isAuthor) {
    results = await db.batch([authoritySnapshot, deleteUpdate, counterUpdate, eventInsert]);
  } else {
    results = await db.batch([
      authoritySnapshot,
      deleteUpdate,
      counterUpdate,
      eventInsert,
      insertModerationActionAfterPreviousChange(db, {
        actorId: actor.userId,
        action: "delete_content",
        targetType: "post",
        targetId: postId,
        reason: opts.reason,
      }),
    ]);
  }
  const authorityRows = results[0];
  if (authorityRows.length === 0) return "not_found";
  if (authorityRows[0]?.allowed !== 1) return "forbidden";
  return "ok";
}

/**
 * Moderator-only recovery for a hidden reply. Restores the row, repairs the
 * thread denormalized counters, emits the compensating achievement event, and
 * writes a `restore_content` moderation ledger entry in one transaction.
 *
 * Parent threads stay authoritative: a post under a deleted thread is not
 * restored here because that would re-expose content under an invisible route.
 */
export async function restorePost(
  db: Db,
  postId: string,
  actor: ForumActor,
  opts: { reason?: string; authorityCondition?: SQL } = {},
): Promise<MutationResult> {
  const [row] = await db
    .select({
      authorId: posts.authorId,
      threadId: posts.threadId,
      deletedAt: posts.deletedAt,
      forumSlug: threads.forumSlug,
      threadDeletedAt: threads.deletedAt,
    })
    .from(posts)
    .innerJoin(threads, eq(posts.threadId, threads.id))
    .where(eq(posts.id, postId))
    .limit(1);
  if (!row || row.threadDeletedAt) return "not_found";
  if (!canModerateForum(actor, row.forumSlug)) return "forbidden";
  if (!row.deletedAt && !opts.authorityCondition) return "ok";

  const now = new Date();
  const authorityCondition = opts.authorityCondition ?? sql`1 = 1`;
  const authoritySnapshot = db
    .select({ allowed: sql<number>`CASE WHEN ${authorityCondition} THEN 1 ELSE 0 END` })
    .from(posts)
    .where(eq(posts.id, postId))
    .limit(1);
  const eventId = postTransitionEventId("forum.post.restored", postId);
  const restoreUpdate = db
    .update(posts)
    .set({ deletedAt: null, deletedBy: null })
    .where(
      and(
        eq(posts.id, postId),
        isNotNull(posts.deletedAt),
        authorityCondition,
        sql`EXISTS (
          SELECT 1
          FROM ${threads}
          WHERE ${threads.id} = ${posts.threadId}
            AND ${threads.deletedAt} IS NULL
        )`,
      ),
    );
  const counterUpdate = db
    .update(threads)
    .set({
      replyCount: sql`${threads.replyCount} + 1`,
      lastReplyAt: sql`(SELECT ${posts.createdAt} FROM ${posts} WHERE ${posts.threadId} = ${row.threadId} AND (${posts.deletedAt} IS NULL OR ${posts.id} = ${postId}) ORDER BY ${posts.replyOrdinal} DESC LIMIT 1)`,
      lastReplyAuthorId: sql`(SELECT ${posts.authorId} FROM ${posts} WHERE ${posts.threadId} = ${row.threadId} AND (${posts.deletedAt} IS NULL OR ${posts.id} = ${postId}) ORDER BY ${posts.replyOrdinal} DESC LIMIT 1)`,
    })
    .where(and(eq(threads.id, row.threadId), sql`changes() = 1`));
  const eventInsert = recordEventAfterPreviousChange(db, {
    id: eventId,
    userId: row.authorId,
    type: "forum.post.restored",
    payload: { postId, threadId: row.threadId },
    ts: now,
  });

  const parentState = db
    .select({ deletedAt: threads.deletedAt })
    .from(threads)
    .where(eq(threads.id, row.threadId))
    .limit(1);
  const [authorityRows, , , , , parentRows] = await db.batch([
    authoritySnapshot,
    restoreUpdate,
    counterUpdate,
    eventInsert,
    insertModerationActionAfterPreviousChange(db, {
      actorId: actor.userId,
      action: "restore_content",
      targetType: "post",
      targetId: postId,
      reason: opts.reason,
    }),
    parentState,
  ]);
  if (authorityRows.length === 0) return "not_found";
  if (authorityRows[0]?.allowed !== 1) return "forbidden";
  return parentRows[0] && !parentRows[0].deletedAt ? "ok" : "not_found";
}

/**
 * Repair path for the denormalized counters: recompute reply_count /
 * last_reply_* from the posts table. Use after any incident that could have
 * desynced them (or from an admin tool).
 */
export async function recomputeThreadReplyCount(db: Db, threadId: string): Promise<void> {
  await db
    .update(threads)
    .set({
      replyCount: sql`(SELECT count(*) FROM ${posts} WHERE ${posts.threadId} = ${threadId} AND ${posts.deletedAt} IS NULL)`,
      lastReplyAt: sql`(SELECT ${posts.createdAt} FROM ${posts} WHERE ${posts.threadId} = ${threadId} AND ${posts.deletedAt} IS NULL ORDER BY ${posts.replyOrdinal} DESC LIMIT 1)`,
      lastReplyAuthorId: sql`(SELECT ${posts.authorId} FROM ${posts} WHERE ${posts.threadId} = ${threadId} AND ${posts.deletedAt} IS NULL ORDER BY ${posts.replyOrdinal} DESC LIMIT 1)`,
    })
    .where(eq(threads.id, threadId));
}
