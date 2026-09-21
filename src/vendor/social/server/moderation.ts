import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "../db";
import { appSettings, forumModerators, moderationActions } from "../db/schema";
import { users } from "../db/users";

/**
 * Moderation persistence helpers: per-forum moderator grants, the
 * moderation_actions audit ledger, and runtime app settings. Pure D1/Drizzle —
 * authorization decisions live in ../permissions.ts and the host's API layer.
 */

/**
 * Ledger verbs: the moderation module's ModerationActionType vocabulary
 * (delete_content, restrict_user, restore_content, clear_restriction, uphold, …)
 * extended with the forum-specific administrative verbs it doesn't cover.
 */
export type ModerationLedgerAction =
  | import("../../moderation/index").ModerationActionType
  | "role_change"
  | "forum_moderator_grant"
  | "forum_moderator_revoke"
  | "launch_mode_change"
  | "mail_outbox_replay";

export type ModerationTargetType = "thread" | "post" | "user" | "report" | "setting";

export interface ModerationLedgerEntry {
  actorId: string;
  action: ModerationLedgerAction;
  targetType: ModerationTargetType;
  targetId: string;
  reason?: string;
}

/**
 * Insert statement for a ledger row, unawaited so enforcement writes can put it
 * in the same `db.batch` as the action it audits (atomic: no takedown without
 * its audit row).
 */
export function insertModerationAction(db: Db, entry: ModerationLedgerEntry) {
  return db.insert(moderationActions).values({
    id: crypto.randomUUID(),
    actorId: entry.actorId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    reason: entry.reason ?? "",
  });
}

/**
 * Batch-only audit insert owned by the immediately preceding successful
 * one-row statement. This keeps a stale transition replay from creating an
 * audit row for work another request already committed.
 */
export function insertModerationActionAfterPreviousChange(db: Db, entry: ModerationLedgerEntry) {
  const createdAt = new Date();
  return db.insert(moderationActions).select(sql`
    SELECT ${crypto.randomUUID()}, ${entry.actorId}, ${entry.action}, ${entry.targetType},
           ${entry.targetId}, ${entry.reason ?? ""},
           ${Math.floor(createdAt.getTime() / 1_000)}
    WHERE changes() = 1
  `);
}

/** Standalone ledger write for actions that aren't part of a batch. */
export async function recordModerationAction(db: Db, entry: ModerationLedgerEntry): Promise<void> {
  await insertModerationAction(db, entry);
}

const MODERATION_LOG_LIMIT = 50;

/** Recent ledger rows, newest first (admin panel audit view). */
export async function listModerationActions(db: Db, limit = MODERATION_LOG_LIMIT) {
  const actor = users;
  const rows = await db
    .select({
      action: moderationActions,
      actor: { id: actor.id, username: actor.username, name: actor.name },
    })
    .from(moderationActions)
    .leftJoin(actor, eq(moderationActions.actorId, actor.id))
    .orderBy(asc(moderationActions.createdAt))
    .limit(Math.min(200, limit));
  // asc + reverse keeps ties stable relative to insert order within a batch.
  return rows.reverse();
}

/** The forum slugs a user has moderator jurisdiction over. */
export async function forumModSlugsFor(db: Db, userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ forumSlug: forumModerators.forumSlug })
    .from(forumModerators)
    .where(eq(forumModerators.userId, userId));
  return new Set(rows.map((r) => r.forumSlug));
}

export interface ForumModeratorGrant {
  userId: string;
  username: string | null;
  name: string | null;
  forumSlug: string;
  grantedBy: string;
  createdAt: Date;
}

/** All grants, joined with the user for display (admin panel). */
export async function listForumModerators(db: Db): Promise<ForumModeratorGrant[]> {
  const rows = await db
    .select({
      userId: forumModerators.userId,
      username: users.username,
      name: users.name,
      forumSlug: forumModerators.forumSlug,
      grantedBy: forumModerators.grantedBy,
      createdAt: forumModerators.createdAt,
    })
    .from(forumModerators)
    .leftJoin(users, eq(forumModerators.userId, users.id))
    .orderBy(asc(forumModerators.forumSlug), asc(forumModerators.createdAt));
  return rows;
}

/** Idempotent grant (PK = user+forum). Slug validity is the host's check. */
export async function grantForumModerator(
  db: Db,
  input: { userId: string; forumSlug: string; grantedBy: string },
): Promise<void> {
  await db
    .insert(forumModerators)
    .values(input)
    .onConflictDoNothing({ target: [forumModerators.userId, forumModerators.forumSlug] });
}

export async function revokeForumModerator(
  db: Db,
  input: { userId: string; forumSlug: string },
): Promise<void> {
  await db
    .delete(forumModerators)
    .where(
      and(eq(forumModerators.userId, input.userId), eq(forumModerators.forumSlug, input.forumSlug)),
    );
}

/**
 * Runtime launch switch: "gated" (allowlist only, the default — unknown or
 * missing values fail closed) or "open" (public). Stored in app_settings so
 * flipping it is an admin action, not a deploy.
 */
export type LaunchMode = "gated" | "open";

const LAUNCH_MODE_KEY = "launch_mode";

export async function getLaunchMode(db: Db): Promise<LaunchMode> {
  return (await getAppSetting(db, LAUNCH_MODE_KEY)) === "open" ? "open" : "gated";
}

export async function setLaunchMode(db: Db, mode: LaunchMode): Promise<void> {
  await setAppSetting(db, LAUNCH_MODE_KEY, mode);
}

export async function getAppSetting(db: Db, key: string): Promise<string | null> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .limit(1);
  return row?.value ?? null;
}

export async function setAppSetting(db: Db, key: string, value: string): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedAt: new Date() },
    });
}
