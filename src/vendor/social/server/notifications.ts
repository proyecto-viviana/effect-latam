import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { users } from "../db/users";
import type { Db } from "../db";
import { notificationPrefs, notifications, threads } from "../db/schema";
import type {
  ForumNotificationType,
  NotificationItem,
  NotificationType,
  NotifiedRecipient,
  PaginatedResponse,
} from "../types";
import { presentAuthor } from "./threads";

const DEFAULT_LIMIT = 20;

type NotificationRow = {
  notification: typeof notifications.$inferSelect;
  actor: {
    id: string | null;
    username: string | null;
    name: string | null;
    avatarUrl: string | null;
  } | null;
  threadTitle?: string | null;
  threadSlug?: string | null;
};

/** A forum (reply/mention) notification insert row — narrows the table's wider
 *  `type` union so the post path can't accidentally emit a non-forum type. */
type ForumNotificationRow = Omit<typeof notifications.$inferInsert, "type"> & {
  type: ForumNotificationType;
};

/** Best-effort parse of a notification's JSON payload (non-forum types). */
function parseData(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toNotificationItem(
  r: NotificationRow,
  opts: { forumContext: boolean } = { forumContext: true },
): NotificationItem {
  const n = r.notification;
  // Forum notifications render from the joined thread + actor context.
  if (n.type === "reply" || n.type === "mention") {
    return {
      id: n.id,
      type: n.type,
      threadId: n.threadId,
      postId: n.postId,
      forumSlug: opts.forumContext ? (r.threadSlug ?? null) : null,
      threadTitle: opts.forumContext ? (r.threadTitle ?? "(tema eliminado)") : null,
      actor: presentAuthor(n.actorId ?? "", r.actor),
      read: n.readAt != null,
      createdAt: n.createdAt,
    };
  }
  // Non-forum (achievement, …): render from the JSON payload, no thread/actor.
  const data = parseData(n.payloadJson);
  return {
    id: n.id,
    type: n.type,
    threadId: null,
    postId: null,
    forumSlug: null,
    threadTitle: null,
    actor: null,
    read: n.readAt != null,
    createdAt: n.createdAt,
    title: asString(data.title),
    titleKey: asString(data.titleKey),
    titleParams: asRecord(data.titleParams),
    href: asString(data.href),
    icon: asString(data.icon),
  };
}

export interface EmitNotificationParams {
  recipientId: string;
  type: NotificationType;
  actorId?: string | null;
  threadId?: string | null;
  postId?: string | null;
  /** Type-specific render payload (serialized to the row's `payload_json` column). */
  data?: Record<string, unknown> | null;
}

/**
 * Insert a single notification — the generic, content-agnostic entry point for
 * non-forum sources (achievements, and later system / game-invite events). The
 * forum path stays on `buildPostNotificationRows` so its inserts ride along
 * atomically with the post.
 */
export async function emit(db: Db, params: EmitNotificationParams): Promise<void> {
  await db.insert(notifications).values({
    id: crypto.randomUUID(),
    recipientId: params.recipientId,
    type: params.type,
    actorId: params.actorId ?? null,
    threadId: params.threadId ?? null,
    postId: params.postId ?? null,
    payloadJson: params.data != null ? JSON.stringify(params.data) : "{}",
    createdAt: new Date(),
  });
}

const MENTION_RE = /(^|[^A-Za-z0-9_])@([A-Za-z0-9_]{3,30})(?![A-Za-z0-9_])/g;

/** Distinct @usernames referenced in a body (as typed; matched case-insensitively later). */
export function parseMentions(content: string): string[] {
  const names = new Set<string>();
  for (const m of content.matchAll(MENTION_RE)) names.add(m[2]!);
  return [...names];
}

export interface PostNotificationParams {
  threadId: string;
  postId: string;
  /** The post's author — never notified about their own post. */
  actorId: string;
  content: string;
  /** Thread author, notified of a reply (unless they wrote the reply). */
  threadAuthorId: string;
}

/**
 * Resolve recipients for a new post and return notification rows to insert: the
 * thread author (a "reply") plus resolved @mentions. Deduped (a mention never
 * doubles a reply notification) and never the actor themselves. Returned to the
 * caller so they can be inserted inside the post's batch (atomic with the post).
 */
export async function buildPostNotificationRows(
  db: Db,
  p: PostNotificationParams,
): Promise<ForumNotificationRow[]> {
  const recipients = new Map<string, ForumNotificationType>();

  if (p.threadAuthorId !== p.actorId) recipients.set(p.threadAuthorId, "reply");

  const names = parseMentions(p.content);
  if (names.length > 0) {
    const lowered = names.map((n) => n.toLowerCase());
    const mentioned = await db
      .select({ id: users.id })
      .from(users)
      .where(inArray(sql`lower(${users.username})`, lowered));
    for (const u of mentioned) {
      if (u.id === p.actorId) continue;
      if (recipients.has(u.id)) continue; // a reply notification already covers them
      recipients.set(u.id, "mention");
    }
  }

  const now = new Date();
  return [...recipients].map(([recipientId, type]) => ({
    id: crypto.randomUUID(),
    recipientId,
    type,
    threadId: p.threadId,
    postId: p.postId,
    actorId: p.actorId,
    createdAt: now,
  }));
}

/** The recipient timeline behind the bell dropdown (newest first). */
export async function listNotifications(
  db: Db,
  recipientId: string,
  opts: { limit?: number } = {},
): Promise<NotificationItem[]> {
  const limit = Math.min(50, opts.limit ?? DEFAULT_LIMIT);
  const rows = await db
    .select({
      notification: notifications,
      actor: {
        id: users.id,
        username: users.username,
        name: users.name,
        avatarUrl: users.avatarUrl,
      },
      threadTitle: threads.title,
      threadSlug: threads.forumSlug,
    })
    .from(notifications)
    .leftJoin(users, eq(notifications.actorId, users.id))
    .leftJoin(threads, eq(notifications.threadId, threads.id))
    .where(eq(notifications.recipientId, recipientId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);

  return rows.map((row) => toNotificationItem(row));
}

/**
 * Recipient timeline for apps that use only content-agnostic notifications.
 * This deliberately avoids joining `threads`, so apps can consume notifications
 * without creating forum tables. Forum notifications still appear, but without
 * thread title/slug context.
 */
export async function listGenericNotifications(
  db: Db,
  recipientId: string,
  opts: { limit?: number } = {},
): Promise<NotificationItem[]> {
  const limit = Math.min(50, opts.limit ?? DEFAULT_LIMIT);
  const rows = await db
    .select({
      notification: notifications,
      actor: {
        id: users.id,
        username: users.username,
        name: users.name,
        avatarUrl: users.avatarUrl,
      },
    })
    .from(notifications)
    .leftJoin(users, eq(notifications.actorId, users.id))
    .where(eq(notifications.recipientId, recipientId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);

  return rows.map((row) => toNotificationItem(row, { forumContext: false }));
}

/** Full, paginated notification history (the "ver todas" page). */
export async function listNotificationsPage(
  db: Db,
  recipientId: string,
  query: { page?: number; limit?: number } = {},
): Promise<PaginatedResponse<NotificationItem>> {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(50, query.limit ?? 25);
  const offset = (page - 1) * limit;

  const rows = await db
    .select({
      notification: notifications,
      actor: {
        id: users.id,
        username: users.username,
        name: users.name,
        avatarUrl: users.avatarUrl,
      },
      threadTitle: threads.title,
      threadSlug: threads.forumSlug,
    })
    .from(notifications)
    .leftJoin(users, eq(notifications.actorId, users.id))
    .leftJoin(threads, eq(notifications.threadId, threads.id))
    .where(eq(notifications.recipientId, recipientId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit)
    .offset(offset);

  const [totalRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(notifications)
    .where(eq(notifications.recipientId, recipientId));
  const total = totalRow?.count ?? 0;
  const items = rows.map((row) => toNotificationItem(row));
  return { items, total, page, limit, hasMore: offset + items.length < total };
}

/**
 * Paginated notification history for apps that do not have forum tables.
 * Prefer `listNotificationsPage` in forum apps that need thread context.
 */
export async function listGenericNotificationsPage(
  db: Db,
  recipientId: string,
  query: { page?: number; limit?: number } = {},
): Promise<PaginatedResponse<NotificationItem>> {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(50, query.limit ?? 25);
  const offset = (page - 1) * limit;

  const rows = await db
    .select({
      notification: notifications,
      actor: {
        id: users.id,
        username: users.username,
        name: users.name,
        avatarUrl: users.avatarUrl,
      },
    })
    .from(notifications)
    .leftJoin(users, eq(notifications.actorId, users.id))
    .where(eq(notifications.recipientId, recipientId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit)
    .offset(offset);

  const [totalRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(notifications)
    .where(eq(notifications.recipientId, recipientId));
  const total = totalRow?.count ?? 0;
  const items = rows.map((row) => toNotificationItem(row, { forumContext: false }));
  return { items, total, page, limit, hasMore: offset + items.length < total };
}

export async function unreadCount(db: Db, recipientId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(notifications)
    .where(and(eq(notifications.recipientId, recipientId), isNull(notifications.readAt)));
  return row?.count ?? 0;
}

/** Mark the recipient's notifications read — a specific set, or all unread. */
export async function markRead(db: Db, recipientId: string, ids?: string[]): Promise<void> {
  // An explicit empty list is a no-op. Without this, `[]` falls through to the
  // `undefined` branch below and marks *every* unread notification read.
  if (ids && ids.length === 0) return;
  const scoped = and(
    eq(notifications.recipientId, recipientId),
    isNull(notifications.readAt),
    ids && ids.length > 0 ? inArray(notifications.id, ids) : undefined,
  );
  await db.update(notifications).set({ readAt: new Date() }).where(scoped);
}

/** Email preference: an absent row means the default (on). */
export async function getEmailEnabled(db: Db, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ emailEnabled: notificationPrefs.emailEnabled })
    .from(notificationPrefs)
    .where(eq(notificationPrefs.userId, userId))
    .limit(1);
  return row?.emailEnabled ?? true;
}

export async function setEmailEnabled(db: Db, userId: string, enabled: boolean): Promise<void> {
  await db
    .insert(notificationPrefs)
    .values({ userId, emailEnabled: enabled })
    .onConflictDoUpdate({ target: notificationPrefs.userId, set: { emailEnabled: enabled } });
}

export interface MailDeliveryRequest {
  /** Stable across retries. The mail service scopes uniqueness by caller. */
  idempotencyKey: string;
  to: string;
  subject: string;
  body: string;
}

/** Minimal mailer contract — injected so this module needn't know about the
 *  host mail transport. */
export interface Mailer {
  sendEmail(msg: MailDeliveryRequest): Promise<unknown>;
}

export interface PostEmailDelivery extends MailDeliveryRequest {
  recipient: NotifiedRecipient;
}

/**
 * Build a fixed-length delivery key without embedding raw forum identifiers.
 * The versioned JSON tuple is the canonical retry identity for this contract.
 */
export async function notificationEmailIdempotencyKey(
  eventId: string,
  recipient: NotifiedRecipient,
): Promise<string> {
  const canonicalTuple = JSON.stringify([
    "forum-post/v1",
    eventId,
    recipient.type,
    recipient.recipientId,
  ]);
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalTuple),
  );
  const digestHex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `v1:forum-post:sha256:${digestHex}`;
}

/** Resolve preference-gated recipients and freeze their normalized delivery envelopes. */
export async function buildPostEmailDeliveries(
  db: Db,
  params: {
    eventId: string;
    threadId: string;
    actorId: string;
    recipients: NotifiedRecipient[];
    baseUrl: string;
    appName: string;
    forumBasePath?: string;
  },
): Promise<PostEmailDelivery[]> {
  if (params.recipients.length === 0) return [];
  const ids = params.recipients.map((recipient) => recipient.recipientId);
  const [recipientRows, thread, actor] = await Promise.all([
    db
      .select({
        id: users.id,
        email: users.email,
        emailEnabled: notificationPrefs.emailEnabled,
      })
      .from(users)
      .leftJoin(notificationPrefs, eq(notificationPrefs.userId, users.id))
      .where(inArray(users.id, ids)),
    db
      .select({ title: threads.title, slug: threads.forumSlug })
      .from(threads)
      .where(eq(threads.id, params.threadId))
      .limit(1),
    db
      .select({ username: users.username, name: users.name })
      .from(users)
      .where(eq(users.id, params.actorId))
      .limit(1),
  ]);

  const slug = thread[0]?.slug;
  if (!slug) return [];
  const title = thread[0]?.title ?? "un tema";
  const basePath = params.forumBasePath ?? "forum";
  const url = `${params.baseUrl}/${basePath}/${slug}/thread/${params.threadId}`;
  const actorName = actor[0]?.username ?? actor[0]?.name ?? "Alguien";
  const typeByRecipient = new Map(params.recipients.map((r) => [r.recipientId, r.type]));

  return Promise.all(
    recipientRows
      .filter((row) => (row.emailEnabled ?? true) && row.email.trim())
      .map(async (row) => {
        const type = typeByRecipient.get(row.id) ?? "reply";
        const recipient = { recipientId: row.id, type };
        const isMention = type === "mention";
        const subject = (
          isMention
            ? `${actorName} te mencionó en ${params.appName}`
            : `${actorName} respondió en "${title}"`
        )
          .replace(/[\r\n]+/g, " ")
          .trim();
        const body = isMention
          ? `${actorName} te mencionó en "${title}".\n\nLeé el mensaje: ${url}\n\n—\nPodés desactivar estos correos en tu perfil.`
          : `${actorName} respondió a "${title}".\n\nLeé la respuesta: ${url}\n\n—\nPodés desactivar estos correos en tu perfil.`;
        return {
          recipient,
          idempotencyKey: await notificationEmailIdempotencyKey(params.eventId, recipient),
          to: row.email.trim().toLowerCase(),
          subject,
          body,
        };
      }),
  );
}

/**
 * Best-effort transactional email for the recipients of a new post, gated by
 * each recipient's email preference. Meant to run in `ctx.waitUntil` (off the
 * response path). No-ops when there's no mailer (binding absent / local dev),
 * and never throws — a send failure must not affect the request.
 */
export async function emailNewPostRecipients(
  db: Db,
  mailer: Mailer | null,
  params: {
    /** Durable post/event identifier used to deduplicate delivery retries. */
    eventId: string;
    threadId: string;
    actorId: string;
    recipients: NotifiedRecipient[];
    baseUrl: string;
    /** Brand shown in the mention subject ("X te mencionó en <appName>"). */
    appName: string;
    /** Forum path segment in the thread link — `forum` or `foros`. Defaults to `forum`. */
    forumBasePath?: string;
  },
): Promise<void> {
  if (!mailer || params.recipients.length === 0) return;
  try {
    const deliveries = await buildPostEmailDeliveries(db, params);
    await Promise.allSettled(
      deliveries.map(({ recipient: _recipient, ...request }) => mailer.sendEmail(request)),
    );
  } catch {
    // Best-effort: swallow so a mail outage never surfaces to the request.
  }
}
