import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const threads = sqliteTable(
  "threads",
  {
    id: text("id").primaryKey(),
    forumSlug: text("forum_slug").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    authorId: text("author_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    replyCount: integer("reply_count").notNull().default(0),
    lastReplyAt: integer("last_reply_at", { mode: "timestamp" }),
    lastReplyAuthorId: text("last_reply_author_id"),
    // High-water mark for the database-owned, per-thread reply chronology.
    nextReplyOrdinal: integer("next_reply_ordinal").notNull().default(1),
    isPinned: integer("is_pinned", { mode: "boolean" }).notNull().default(false),
    isLocked: integer("is_locked", { mode: "boolean" }).notNull().default(false),
    // Soft delete: NULL = live. Hidden from reads but the row (and history) stays.
    deletedAt: integer("deleted_at", { mode: "timestamp" }),
    // Who soft-deleted it (author self-delete or moderator takedown). FK-less like authorId.
    deletedBy: text("deleted_by"),
  },
  (table) => [
    index("threads_forum_slug_idx").on(table.forumSlug, table.createdAt),
    index("threads_author_idx").on(table.authorId),
  ],
);

export const posts = sqliteTable(
  "posts",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id").notNull(),
    content: text("content").notNull(),
    authorId: text("author_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    // Assigned by the posts reply-ordinal trigger. Zero is insert-only.
    replyOrdinal: integer("reply_ordinal").notNull().default(0),
    isEdited: integer("is_edited", { mode: "boolean" }).notNull().default(false),
    deletedAt: integer("deleted_at", { mode: "timestamp" }),
    deletedBy: text("deleted_by"),
  },
  (table) => [
    index("posts_thread_idx").on(table.threadId, table.createdAt),
    uniqueIndex("posts_thread_reply_ordinal_unique_idx").on(table.threadId, table.replyOrdinal),
  ],
);

/**
 * Immutable ownership for retry-safe forum content creation. Only committed
 * winners are stored; exact replay and operation-key conflict are derived from
 * this compact fingerprint-to-result mapping.
 */
export const contentCreateOperations = sqliteTable(
  "content_create_operations",
  {
    id: text("id").primaryKey(),
    contractVersion: text("contract_version", {
      enum: ["forum_content_create_v1"],
    }).notNull(),
    fingerprint: text("fingerprint").notNull(),
    kind: text("kind", { enum: ["reply", "thread"] }).notNull(),
    actorId: text("actor_id").notNull(),
    requestedThreadId: text("requested_thread_id").references(() => threads.id, {
      onDelete: "restrict",
    }),
    requestedForumSlug: text("requested_forum_slug"),
    resultPostId: text("result_post_id"),
    resultThreadId: text("result_thread_id"),
    committedAt: integer("committed_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("content_create_operations_result_post_idx")
      .on(table.resultPostId)
      .where(sql`${table.kind} = 'reply'`),
    uniqueIndex("content_create_operations_result_thread_idx")
      .on(table.resultThreadId)
      .where(sql`${table.kind} = 'thread'`),
    index("content_create_operations_actor_committed_idx").on(
      table.actorId,
      table.committedAt,
      table.id,
    ),
    check(
      "content_create_operations_id_check",
      sql`${table.id} = trim(${table.id})
        AND length(${table.id}) > 0
        AND length(${table.id}) <= 128`,
    ),
    check(
      "content_create_operations_contract_check",
      sql`${table.contractVersion} = 'forum_content_create_v1'`,
    ),
    check(
      "content_create_operations_fingerprint_check",
      sql`length(${table.fingerprint}) = 64
        AND ${table.fingerprint} = lower(${table.fingerprint})
        AND ${table.fingerprint} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check("content_create_operations_kind_check", sql`${table.kind} IN ('reply', 'thread')`),
    check(
      "content_create_operations_actor_check",
      sql`${table.actorId} = trim(${table.actorId})
        AND length(${table.actorId}) > 0`,
    ),
    check(
      "content_create_operations_identity_check",
      sql`(${table.requestedThreadId} IS NULL OR (
          ${table.requestedThreadId} = trim(${table.requestedThreadId})
          AND length(${table.requestedThreadId}) > 0
        )) AND (${table.requestedForumSlug} IS NULL OR (
          ${table.requestedForumSlug} = trim(${table.requestedForumSlug})
          AND length(${table.requestedForumSlug}) > 0
        )) AND (${table.resultPostId} IS NULL OR (
          ${table.resultPostId} = trim(${table.resultPostId})
          AND length(${table.resultPostId}) > 0
        )) AND (${table.resultThreadId} IS NULL OR (
          ${table.resultThreadId} = trim(${table.resultThreadId})
          AND length(${table.resultThreadId}) > 0
        ))`,
    ),
    check(
      "content_create_operations_shape_check",
      sql`(
        ${table.kind} = 'reply'
        AND ${table.requestedThreadId} IS NOT NULL
        AND ${table.requestedForumSlug} IS NULL
        AND ${table.resultPostId} IS NOT NULL
        AND ${table.resultThreadId} IS NULL
      ) OR (
        ${table.kind} = 'thread'
        AND ${table.requestedThreadId} IS NULL
        AND ${table.requestedForumSlug} IS NOT NULL
        AND ${table.resultPostId} IS NULL
        AND ${table.resultThreadId} IS NOT NULL
      )`,
    ),
    check(
      "content_create_operations_committed_at_check",
      sql`typeof(${table.committedAt}) = 'integer' AND ${table.committedAt} >= 0`,
    ),
  ],
);

/**
 * Immutable actor-owned audit and replay record for thread pin/lock commands.
 * The app keeps authorization; the shared command owns transition concurrency,
 * the before/after snapshot, and its moderation_actions rows in one D1 batch.
 */
export const threadModerationOperations = sqliteTable(
  "thread_moderation_operations",
  {
    id: text("id").primaryKey(),
    contractVersion: text("contract_version", {
      enum: ["thread_moderation_v1"],
    }).notNull(),
    fingerprint: text("fingerprint").notNull(),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "restrict" }),
    actorId: text("actor_id").notNull(),
    context: text("context").notNull(),
    reason: text("reason").notNull().default(""),
    field: text("field", { enum: ["pinned", "locked"] }).notNull(),
    expectedPreviousValue: integer("expected_previous_value", { mode: "boolean" }).notNull(),
    nextValue: integer("next_value", { mode: "boolean" }).notNull(),
    observedValue: integer("observed_value", { mode: "boolean" }).notNull(),
    outcome: text("outcome", {
      enum: ["applied", "transition_conflict"],
    }).notNull(),
    ownsEffects: integer("owns_effects", { mode: "boolean" }).notNull(),
    committedAt: integer("committed_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("thread_moderation_operations_thread_committed_idx").on(
      table.threadId,
      table.committedAt,
      table.id,
    ),
    index("thread_moderation_operations_actor_committed_idx").on(
      table.actorId,
      table.committedAt,
      table.id,
    ),
    check(
      "thread_moderation_operations_id_check",
      sql`${table.id} = trim(${table.id})
        AND length(${table.id}) > 0
        AND length(${table.id}) <= 128`,
    ),
    check(
      "thread_moderation_operations_contract_check",
      sql`${table.contractVersion} = 'thread_moderation_v1'`,
    ),
    check(
      "thread_moderation_operations_fingerprint_check",
      sql`length(${table.fingerprint}) = 64
        AND ${table.fingerprint} = lower(${table.fingerprint})
        AND ${table.fingerprint} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "thread_moderation_operations_actor_check",
      sql`${table.actorId} = trim(${table.actorId}) AND length(${table.actorId}) > 0`,
    ),
    check(
      "thread_moderation_operations_context_check",
      sql`${table.context} = trim(${table.context})
        AND length(${table.context}) > 0
        AND length(${table.context}) <= 80`,
    ),
    check(
      "thread_moderation_operations_reason_check",
      sql`${table.reason} = trim(${table.reason}) AND length(${table.reason}) <= 700`,
    ),
    check("thread_moderation_operations_field_check", sql`${table.field} IN ('pinned', 'locked')`),
    check(
      "thread_moderation_operations_state_check",
      sql`${table.expectedPreviousValue} IN (0, 1)
        AND ${table.nextValue} IN (0, 1)
        AND ${table.observedValue} IN (0, 1)
        AND ${table.expectedPreviousValue} != ${table.nextValue}`,
    ),
    check(
      "thread_moderation_operations_outcome_check",
      sql`(
        ${table.outcome} = 'applied'
        AND ${table.ownsEffects} = 1
        AND ${table.observedValue} = ${table.expectedPreviousValue}
      ) OR (
        ${table.outcome} = 'transition_conflict'
        AND ${table.ownsEffects} = 0
        AND ${table.observedValue} != ${table.expectedPreviousValue}
      )`,
    ),
    check(
      "thread_moderation_operations_committed_at_check",
      sql`typeof(${table.committedAt}) = 'integer' AND ${table.committedAt} >= 0`,
    ),
  ],
);

/**
 * Per-user saved forum threads. FK-less ids keep the social package
 * standalone-extractable like authorId/reporterId; reads join live threads and
 * hide saved rows whose thread has since been removed.
 */
export const threadBookmarks = sqliteTable(
  "thread_bookmarks",
  {
    userId: text("user_id").notNull(),
    threadId: text("thread_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.threadId] }),
    index("thread_bookmarks_user_created_idx").on(table.userId, table.createdAt),
    index("thread_bookmarks_thread_idx").on(table.threadId),
  ],
);

/**
 * Per-user signature appended below their posts. Separate table (not a users
 * column) so it stays a social concern — auth/lim need not know about it, and it
 * doesn't load on every session validation. FK-less user_id keeps social
 * standalone-extractable, consistent with the FK-less authorId pattern.
 */
export const signatures = sqliteTable("signatures", {
  userId: text("user_id").primaryKey(),
  content: text("content").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/**
 * User reports of threads/posts for moderator review. FK-less ids keep social
 * standalone-extractable (consistent with authorId). status drives the mod queue.
 */
export const reports = sqliteTable(
  "reports",
  {
    id: text("id").primaryKey(),
    reporterId: text("reporter_id").notNull(),
    targetType: text("target_type", { enum: ["thread", "post"] }).notNull(),
    targetId: text("target_id").notNull(),
    reason: text("reason").notNull(),
    status: text("status", { enum: ["open", "resolved", "dismissed"] })
      .notNull()
      .default("open"),
    resolvedBy: text("resolved_by"),
    resolvedAt: integer("resolved_at", { mode: "timestamp" }),
    resolutionOperationId: text("resolution_operation_id").references(
      (): AnySQLiteColumn => reportResolutionOperations.id,
      { onDelete: "restrict" },
    ),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("reports_status_idx").on(table.status, table.createdAt),
    // SEAM-6: enforce one *open* report per (reporter, target) at the DB level,
    // closing the check-then-insert race in createReport. Partial — resolved /
    // dismissed rows are excluded, so a later report can still be filed.
    uniqueIndex("reports_open_unique_idx")
      .on(table.reporterId, table.targetType, table.targetId)
      .where(sql`${table.status} = 'open'`),
    uniqueIndex("reports_resolution_operation_unique_idx")
      .on(table.resolutionOperationId)
      .where(sql`${table.resolutionOperationId} IS NOT NULL`),
  ],
);

/**
 * Immutable idempotency attempts for report resolution. Winning operations own
 * the terminal transition; conflicts retain the canonical winner needed for a
 * deterministic replay response without claiming any effects themselves.
 */
export const reportResolutionOperations = sqliteTable(
  "report_resolution_operations",
  {
    id: text("id").primaryKey(),
    contractVersion: text("contract_version", { enum: ["report_resolution_v1"] }).notNull(),
    fingerprint: text("fingerprint").notNull(),
    reportId: text("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "restrict" }),
    actorId: text("actor_id").notNull(),
    verdict: text("verdict", { enum: ["resolved", "dismissed"] }).notNull(),
    deleteContent: integer("delete_content", { mode: "boolean" }).notNull(),
    outcome: text("outcome", { enum: ["applied", "transition_conflict"] }).notNull(),
    ownsEffects: integer("owns_effects", { mode: "boolean" }).notNull(),
    canonicalOperationId: text("canonical_operation_id")
      .notNull()
      .references((): AnySQLiteColumn => reportResolutionOperations.id, {
        onDelete: "restrict",
      }),
    committedAt: integer("committed_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("report_resolution_operations_owner_idx")
      .on(table.reportId)
      .where(sql`${table.ownsEffects} = 1`),
    index("report_resolution_operations_report_committed_idx").on(
      table.reportId,
      table.committedAt,
      table.id,
    ),
    index("report_resolution_operations_canonical_idx").on(table.canonicalOperationId),
    check(
      "report_resolution_operations_id_check",
      sql`length(${table.id}) > 0 AND trim(${table.id}) = ${table.id}`,
    ),
    check(
      "report_resolution_operations_contract_check",
      sql`${table.contractVersion} = 'report_resolution_v1'`,
    ),
    check(
      "report_resolution_operations_fingerprint_check",
      sql`length(${table.fingerprint}) = 64
        AND ${table.fingerprint} = lower(${table.fingerprint})
        AND ${table.fingerprint} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "report_resolution_operations_verdict_check",
      sql`${table.verdict} IN ('resolved', 'dismissed')`,
    ),
    check(
      "report_resolution_operations_takedown_check",
      sql`${table.verdict} = 'resolved' OR ${table.deleteContent} = 0`,
    ),
    check(
      "report_resolution_operations_delete_content_check",
      sql`${table.deleteContent} IN (0, 1)`,
    ),
    check(
      "report_resolution_operations_committed_at_check",
      sql`typeof(${table.committedAt}) = 'integer' AND ${table.committedAt} >= 0`,
    ),
    check(
      "report_resolution_operations_outcome_check",
      sql`(
        ${table.outcome} = 'applied'
        AND ${table.ownsEffects} = 1
        AND ${table.canonicalOperationId} = ${table.id}
      ) OR (
        ${table.outcome} = 'transition_conflict'
        AND ${table.ownsEffects} = 0
        AND ${table.canonicalOperationId} != ${table.id}
      )`,
    ),
  ],
);

/** Immutable ledger of each authoritative effect owned by a winning operation. */
export const reportResolutionEffects = sqliteTable(
  "report_resolution_effects",
  {
    operationId: text("operation_id")
      .notNull()
      .references(() => reportResolutionOperations.id, { onDelete: "restrict" }),
    effectType: text("effect_type", {
      enum: [
        "report_terminal_state",
        "verdict_audit",
        "content_takedown",
        "content_takedown_audit",
      ],
    }).notNull(),
    committedAt: integer("committed_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.operationId, table.effectType] }),
    check(
      "report_resolution_effects_type_check",
      sql`${table.effectType} IN (
        'report_terminal_state',
        'verdict_audit',
        'content_takedown',
        'content_takedown_audit'
      )`,
    ),
    check(
      "report_resolution_effects_committed_at_check",
      sql`typeof(${table.committedAt}) = 'integer' AND ${table.committedAt} >= 0`,
    ),
  ],
);

/**
 * In-app notifications. Content-agnostic: forum types (reply/mention) carry
 * thread/post context, while non-forum types (achievement, system, and future
 * game-invite events) carry their render payload in `payload_json` and leave
 * thread/post/actor null. FK-less ids (recipient/actor/thread/post) keep
 * social standalone-extractable. `readAt` NULL = unread. Timeline and unread
 * indexes serve reads; a partial source-event index deduplicates owned producers.
 */
export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    recipientId: text("recipient_id").notNull(),
    type: text("type", {
      enum: ["reply", "mention", "achievement", "system", "report"],
    }).notNull(),
    // Nullable for non-forum notifications (an achievement has no thread/actor).
    threadId: text("thread_id"),
    postId: text("post_id"),
    actorId: text("actor_id"),
    // Type-specific render payload as JSON (e.g. achievement title/icon/href).
    payloadJson: text("payload_json").notNull().default("{}"),
    // Durable event provenance for retry-safe notification producers.
    sourceEventId: text("source_event_id"),
    readAt: integer("read_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("notifications_recipient_idx").on(table.recipientId, table.createdAt),
    index("notifications_unread_idx").on(table.recipientId, table.readAt),
    uniqueIndex("notifications_recipient_type_source_event_unique_idx")
      .on(table.recipientId, table.type, table.sourceEventId)
      .where(sql`${table.sourceEventId} IS NOT NULL`),
  ],
);

/** Per-user notification preferences. Absent row = defaults (email on). */
export const notificationPrefs = sqliteTable("notification_prefs", {
  userId: text("user_id").primaryKey(),
  emailEnabled: integer("email_enabled", { mode: "boolean" }).notNull().default(true),
});

/**
 * Per-forum moderator grants: a plain `moderator` role has jurisdiction only
 * over the slugs listed here (global_moderator/admin need no rows — they pass
 * everywhere). Forum slugs are the host's static board list, so no FK; user
 * ids stay FK-less like authorId for standalone extraction.
 */
export const forumModerators = sqliteTable(
  "forum_moderators",
  {
    userId: text("user_id").notNull(),
    forumSlug: text("forum_slug").notNull(),
    grantedBy: text("granted_by").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.forumSlug] }),
    index("forum_moderators_forum_idx").on(table.forumSlug),
  ],
);

/**
 * Runtime app settings (key/value). First consumer: the launch-gate mode
 * switch — flipping "gated" ↔ "open" from the admin panel without a deploy.
 */
export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

/**
 * Durable moderation/audit ledger (tortafritapp's moderation_actions pattern,
 * minus before/after JSON): every takedown, restrict/ban, report resolution,
 * role change, forum-mod grant, and launch flip writes a row. `action` verbs
 * follow the moderation module vocabulary (typed in server/moderation.ts;
 * TEXT here so the ledger never rejects a new verb).
 */
export const moderationActions = sqliteTable(
  "moderation_actions",
  {
    id: text("id").primaryKey(),
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type", {
      enum: ["thread", "post", "user", "report", "setting"],
    }).notNull(),
    targetId: text("target_id").notNull(),
    reason: text("reason").notNull().default(""),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("moderation_actions_created_idx").on(table.createdAt),
    index("moderation_actions_target_idx").on(table.targetType, table.targetId),
  ],
);

export const groups = sqliteTable(
  "groups",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    kind: text("kind", { enum: ["official", "community"] }).notNull(),
    ownerUserId: text("owner_user_id"),
    verified: integer("verified", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("groups_kind_verified_idx").on(table.kind, table.verified),
    index("groups_owner_idx").on(table.ownerUserId),
  ],
);

export const groupMembers = sqliteTable(
  "group_members",
  {
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    role: text("role", { enum: ["admin", "rep", "member"] }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    provenance: text("provenance", {
      enum: ["legacy", "invitation", "role_request", "direct_admin"],
    })
      .notNull()
      .default("legacy"),
    provenanceOperationId: text("provenance_operation_id").references(
      (): AnySQLiteColumn => groupMembershipEvents.operationId,
      { onDelete: "restrict" },
    ),
  },
  (table) => [
    primaryKey({ columns: [table.groupId, table.userId] }),
    index("group_members_user_idx").on(table.userId, table.role),
    check("group_members_role_check", sql`${table.role} IN ('admin', 'rep', 'member')`),
    check(
      "group_members_provenance_check",
      sql`${table.provenance} IN ('legacy', 'invitation', 'role_request', 'direct_admin')`,
    ),
    check(
      "group_members_provenance_operation_check",
      sql`(
        (${table.provenance} = 'legacy' AND ${table.provenanceOperationId} IS NULL)
        OR (${table.provenance} != 'legacy' AND ${table.provenanceOperationId} IS NOT NULL)
      )`,
    ),
  ],
);

export const groupInvites = sqliteTable(
  "group_invites",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    inviterUserId: text("inviter_user_id").notNull(),
    invitedUserId: text("invited_user_id").notNull(),
    role: text("role", { enum: ["admin", "rep", "member"] }).notNull(),
    status: text("status", {
      enum: ["pending", "accepted", "declined", "cancelled", "expired"],
    })
      .notNull()
      .default("pending"),
    message: text("message").notNull().default(""),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    respondedAt: integer("responded_at", { mode: "timestamp" }),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("group_invites_pending_unique_idx")
      .on(table.groupId, table.invitedUserId)
      .where(sql`${table.status} = 'pending'`),
    index("group_invites_group_status_idx").on(table.groupId, table.status, table.createdAt),
    index("group_invites_invited_status_idx").on(
      table.invitedUserId,
      table.status,
      table.createdAt,
    ),
    index("group_invites_pending_expiry_idx")
      .on(table.expiresAt, table.id)
      .where(sql`${table.status} = 'pending'`),
    check("group_invites_role_check", sql`${table.role} IN ('admin', 'rep', 'member')`),
    check(
      "group_invites_status_check",
      sql`${table.status} IN ('pending', 'accepted', 'declined', 'cancelled', 'expired')`,
    ),
    check("group_invites_message_check", sql`length(${table.message}) <= 500`),
    check("group_invites_expiry_check", sql`${table.expiresAt} = ${table.createdAt} + 1209600`),
  ],
);

export const groupClaims = sqliteTable(
  "group_claims",
  {
    id: text("id").primaryKey(),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    requesterUserId: text("requester_user_id").notNull(),
    requestedRole: text("requested_role", { enum: ["admin", "rep"] }).notNull(),
    status: text("status", {
      enum: ["pending", "approved", "rejected", "cancelled"],
    })
      .notNull()
      .default("pending"),
    reason: text("reason").notNull().default(""),
    reviewerUserId: text("reviewer_user_id"),
    resolutionNote: text("resolution_note").notNull().default(""),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    resolvedAt: integer("resolved_at", { mode: "timestamp" }),
  },
  (table) => [
    uniqueIndex("group_claims_pending_unique_idx")
      .on(table.groupId, table.requesterUserId)
      .where(sql`${table.status} = 'pending'`),
    index("group_claims_group_status_idx").on(table.groupId, table.status, table.createdAt),
    index("group_claims_requester_status_idx").on(
      table.requesterUserId,
      table.status,
      table.createdAt,
    ),
    check("group_claims_role_check", sql`${table.requestedRole} IN ('admin', 'rep')`),
    check(
      "group_claims_status_check",
      sql`${table.status} IN ('pending', 'approved', 'rejected', 'cancelled')`,
    ),
    check("group_claims_reason_check", sql`length(${table.reason}) <= 700`),
    check("group_claims_resolution_note_check", sql`length(${table.resolutionNote}) <= 700`),
  ],
);

/**
 * Immutable idempotency and transition-ownership records for group workflows.
 * App-owned user ids remain FK-less here; host migrations bind them to users.
 */
export const groupWorkflowOperations = sqliteTable(
  "group_workflow_operations",
  {
    id: text("id").primaryKey(),
    fingerprint: text("fingerprint").notNull(),
    kind: text("kind", {
      enum: [
        "invitation_create",
        "invitation_accept",
        "invitation_decline",
        "invitation_cancel",
        "invitation_expire",
        "role_request_create",
        "role_request_approve",
        "role_request_reject",
        "role_request_cancel",
        "membership_upsert",
        "membership_remove",
      ],
    }).notNull(),
    requestedResourceId: text("requested_resource_id").notNull(),
    outcome: text("outcome", {
      enum: [
        "created",
        "applied",
        "duplicate_pending",
        "transition_conflict",
        "expired",
        "not_eligible",
        "forbidden",
        "not_found",
      ],
    }).notNull(),
    canonicalStatus: text("canonical_status"),
    ownsEffects: integer("owns_effects", { mode: "boolean" }).notNull(),
    groupId: text("group_id").references(() => groups.id, { onDelete: "restrict" }),
    actorUserId: text("actor_user_id"),
    subjectUserId: text("subject_user_id"),
    invitationId: text("invitation_id").references(() => groupInvites.id, {
      onDelete: "restrict",
    }),
    claimId: text("claim_id").references(() => groupClaims.id, { onDelete: "restrict" }),
    committedAt: integer("committed_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("group_workflow_operations_invitation_create_idx")
      .on(table.invitationId)
      .where(sql`${table.kind} = 'invitation_create' AND ${table.ownsEffects} = 1`),
    uniqueIndex("group_workflow_operations_invitation_transition_idx")
      .on(table.invitationId)
      .where(
        sql`${table.kind} IN (
          'invitation_accept',
          'invitation_decline',
          'invitation_cancel',
          'invitation_expire'
        ) AND ${table.ownsEffects} = 1`,
      ),
    uniqueIndex("group_workflow_operations_role_request_create_idx")
      .on(table.claimId)
      .where(sql`${table.kind} = 'role_request_create' AND ${table.ownsEffects} = 1`),
    uniqueIndex("group_workflow_operations_role_request_transition_idx")
      .on(table.claimId)
      .where(
        sql`${table.kind} IN (
          'role_request_approve',
          'role_request_reject',
          'role_request_cancel'
        ) AND ${table.ownsEffects} = 1`,
      ),
    index("group_workflow_operations_actor_committed_idx").on(
      table.actorUserId,
      table.committedAt,
      table.id,
    ),
    index("group_workflow_operations_group_committed_idx").on(
      table.groupId,
      table.committedAt,
      table.id,
    ),
    check(
      "group_workflow_operations_id_check",
      sql`${table.id} = trim(${table.id})
        AND length(${table.id}) >= 8
        AND length(${table.id}) <= 128`,
    ),
    check(
      "group_workflow_operations_fingerprint_check",
      sql`length(${table.fingerprint}) = 64
        AND ${table.fingerprint} = lower(${table.fingerprint})
        AND ${table.fingerprint} NOT GLOB '*[^0-9a-f]*'`,
    ),
    check(
      "group_workflow_operations_requested_resource_check",
      sql`${table.requestedResourceId} = trim(${table.requestedResourceId})
        AND length(${table.requestedResourceId}) > 0
        AND length(${table.requestedResourceId}) <= 160`,
    ),
    check(
      "group_workflow_operations_kind_check",
      sql`${table.kind} IN (
        'invitation_create',
        'invitation_accept',
        'invitation_decline',
        'invitation_cancel',
        'invitation_expire',
        'role_request_create',
        'role_request_approve',
        'role_request_reject',
        'role_request_cancel',
        'membership_upsert',
        'membership_remove'
      )`,
    ),
    check(
      "group_workflow_operations_actor_check",
      sql`(
        ${table.kind} = 'invitation_expire'
        AND ${table.actorUserId} IS NULL
      ) OR (
        ${table.kind} <> 'invitation_expire'
        AND ${table.actorUserId} IS NOT NULL
      )`,
    ),
    check(
      "group_workflow_operations_committed_at_check",
      sql`typeof(${table.committedAt}) = 'integer' AND ${table.committedAt} >= 0`,
    ),
    check(
      "group_workflow_operations_outcome_check",
      sql`${table.outcome} IN (
        'created',
        'applied',
        'duplicate_pending',
        'transition_conflict',
        'expired',
        'not_eligible',
        'forbidden',
        'not_found'
      ) AND ${table.ownsEffects} IN (0, 1)`,
    ),
    check(
      "group_workflow_operations_resource_check",
      sql`(
        ${table.kind} IN (
          'invitation_create',
          'invitation_accept',
          'invitation_decline',
          'invitation_cancel',
          'invitation_expire'
        )
        AND ${table.claimId} IS NULL
        AND (
          ${table.invitationId} IS NOT NULL
          OR (
            ${table.ownsEffects} = 0
            AND ${table.outcome} IN ('not_eligible', 'forbidden', 'not_found')
          )
        )
      ) OR (
        ${table.kind} IN (
          'role_request_create',
          'role_request_approve',
          'role_request_reject',
          'role_request_cancel'
        )
        AND ${table.invitationId} IS NULL
        AND (
          ${table.claimId} IS NOT NULL
          OR (
            ${table.ownsEffects} = 0
            AND ${table.outcome} IN ('not_eligible', 'forbidden', 'not_found')
          )
        )
      ) OR (
        ${table.kind} IN ('membership_upsert', 'membership_remove')
        AND ${table.invitationId} IS NULL
        AND ${table.claimId} IS NULL
        AND ${table.groupId} IS NOT NULL
        AND ${table.subjectUserId} IS NOT NULL
      )`,
    ),
    check(
      "group_workflow_operations_status_check",
      sql`(
        ${table.invitationId} IS NOT NULL
        AND ${table.canonicalStatus} IS NOT NULL
        AND ${table.canonicalStatus} IN (
          'pending', 'accepted', 'declined', 'cancelled', 'expired'
        )
      ) OR (
        ${table.claimId} IS NOT NULL
        AND ${table.canonicalStatus} IS NOT NULL
        AND ${table.canonicalStatus} IN ('pending', 'approved', 'rejected', 'cancelled')
      ) OR (
        ${table.invitationId} IS NULL
        AND ${table.claimId} IS NULL
        AND ${table.canonicalStatus} IS NULL
      )`,
    ),
    check(
      "group_workflow_operations_ownership_check",
      sql`(
        ${table.kind} IN ('invitation_create', 'role_request_create')
        AND ${table.ownsEffects} = 1
        AND ${table.outcome} = 'created'
        AND ${table.canonicalStatus} = 'pending'
      ) OR (
        ${table.kind} = 'invitation_accept'
        AND ${table.ownsEffects} = 1
        AND ${table.outcome} = 'applied'
        AND ${table.canonicalStatus} = 'accepted'
      ) OR (
        ${table.kind} = 'invitation_decline'
        AND ${table.ownsEffects} = 1
        AND ${table.outcome} = 'applied'
        AND ${table.canonicalStatus} = 'declined'
      ) OR (
        ${table.kind} = 'invitation_cancel'
        AND ${table.ownsEffects} = 1
        AND ${table.outcome} = 'applied'
        AND ${table.canonicalStatus} = 'cancelled'
      ) OR (
        ${table.kind} = 'invitation_expire'
        AND ${table.ownsEffects} = 1
        AND ${table.outcome} = 'expired'
        AND ${table.canonicalStatus} = 'expired'
      ) OR (
        ${table.kind} = 'role_request_approve'
        AND ${table.ownsEffects} = 1
        AND ${table.outcome} = 'applied'
        AND ${table.canonicalStatus} = 'approved'
      ) OR (
        ${table.kind} = 'role_request_reject'
        AND ${table.ownsEffects} = 1
        AND ${table.outcome} = 'applied'
        AND ${table.canonicalStatus} = 'rejected'
      ) OR (
        ${table.kind} = 'role_request_cancel'
        AND ${table.ownsEffects} = 1
        AND ${table.outcome} = 'applied'
        AND ${table.canonicalStatus} = 'cancelled'
      ) OR (
        ${table.kind} IN ('membership_upsert', 'membership_remove')
        AND ${table.ownsEffects} = 1
        AND ${table.outcome} = 'applied'
        AND ${table.canonicalStatus} IS NULL
      ) OR (
        ${table.kind} IN ('invitation_create', 'role_request_create')
        AND ${table.ownsEffects} = 0
        AND ${table.outcome} = 'duplicate_pending'
        AND ${table.canonicalStatus} = 'pending'
      ) OR (
        ${table.kind} IN (
          'invitation_accept',
          'invitation_decline',
          'invitation_cancel',
          'invitation_expire'
        )
        AND ${table.ownsEffects} = 0
        AND ${table.outcome} = 'transition_conflict'
        AND ${table.canonicalStatus} IN ('accepted', 'declined', 'cancelled', 'expired')
      ) OR (
        ${table.kind} IN (
          'role_request_approve',
          'role_request_reject',
          'role_request_cancel'
        )
        AND ${table.ownsEffects} = 0
        AND ${table.outcome} = 'transition_conflict'
        AND ${table.canonicalStatus} IN ('approved', 'rejected', 'cancelled')
      ) OR (
        ${table.kind} IN (
          'invitation_create',
          'invitation_accept',
          'invitation_decline',
          'invitation_cancel',
          'invitation_expire'
        )
        AND ${table.ownsEffects} = 0
        AND ${table.outcome} = 'expired'
        AND ${table.canonicalStatus} = 'expired'
      ) OR (
        ${table.ownsEffects} = 0
        AND ${table.outcome} IN ('not_eligible', 'forbidden', 'not_found')
      )`,
    ),
  ],
);

/** Append-only provenance for role grants, changes, and removals. */
export const groupMembershipEvents = sqliteTable(
  "group_membership_events",
  {
    operationId: text("operation_id")
      .primaryKey()
      .references(() => groupWorkflowOperations.id, { onDelete: "restrict" }),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "restrict" }),
    userId: text("user_id").notNull(),
    actorUserId: text("actor_user_id").notNull(),
    action: text("action", { enum: ["upsert", "remove"] }).notNull(),
    previousRole: text("previous_role", { enum: ["admin", "rep", "member"] }),
    resultingRole: text("resulting_role", { enum: ["admin", "rep", "member"] }),
    provenance: text("provenance", {
      enum: ["invitation", "role_request", "direct_admin"],
    }).notNull(),
    invitationId: text("invitation_id").references(() => groupInvites.id, {
      onDelete: "restrict",
    }),
    claimId: text("claim_id").references(() => groupClaims.id, { onDelete: "restrict" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("group_membership_events_member_created_idx").on(
      table.groupId,
      table.userId,
      table.createdAt,
      table.operationId,
    ),
    index("group_membership_events_actor_created_idx").on(
      table.actorUserId,
      table.createdAt,
      table.operationId,
    ),
    check(
      "group_membership_events_roles_check",
      sql`(
        ${table.previousRole} IS NULL
        OR ${table.previousRole} IN ('admin', 'rep', 'member')
      ) AND (
        ${table.resultingRole} IS NULL
        OR ${table.resultingRole} IN ('admin', 'rep', 'member')
      )`,
    ),
    check(
      "group_membership_events_action_check",
      sql`(
        ${table.action} = 'upsert'
        AND ${table.resultingRole} IS NOT NULL
      ) OR (
        ${table.action} = 'remove'
        AND ${table.previousRole} IS NOT NULL
        AND ${table.resultingRole} IS NULL
      )`,
    ),
    check(
      "group_membership_events_provenance_check",
      sql`(
        ${table.provenance} = 'invitation'
        AND ${table.action} = 'upsert'
        AND ${table.invitationId} IS NOT NULL
        AND ${table.claimId} IS NULL
      ) OR (
        ${table.provenance} = 'role_request'
        AND ${table.action} = 'upsert'
        AND ${table.invitationId} IS NULL
        AND ${table.claimId} IS NOT NULL
      ) OR (
        ${table.provenance} = 'direct_admin'
        AND ${table.invitationId} IS NULL
        AND ${table.claimId} IS NULL
      )`,
    ),
    check(
      "group_membership_events_created_at_check",
      sql`typeof(${table.createdAt}) = 'integer' AND ${table.createdAt} >= 0`,
    ),
  ],
);

export const subscriptions = sqliteTable(
  "subscriptions",
  {
    subscriberId: text("subscriber_id").notNull(),
    targetType: text("target_type", { enum: ["group", "user"] }).notNull(),
    targetId: text("target_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.subscriberId, table.targetType, table.targetId] }),
    index("subscriptions_target_idx").on(table.targetType, table.targetId),
  ],
);

export const feedEvents = sqliteTable(
  "feed_events",
  {
    id: text("id").primaryKey(),
    targetType: text("target_type", { enum: ["group", "user"] }).notNull(),
    targetId: text("target_id").notNull(),
    actorId: text("actor_id"),
    eventType: text("event_type", {
      enum: ["market_created", "post_created", "system"],
    }).notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    href: text("href").notNull(),
    payloadJson: text("payload_json").notNull().default("{}"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("feed_events_target_created_idx").on(table.targetType, table.targetId, table.createdAt),
    index("feed_events_subject_idx").on(table.subjectType, table.subjectId),
  ],
);

export type Thread = typeof threads.$inferSelect;
export type NewThread = typeof threads.$inferInsert;
export type Post = typeof posts.$inferSelect;
export type NewPost = typeof posts.$inferInsert;
export type ContentCreateOperation = typeof contentCreateOperations.$inferSelect;
export type NewContentCreateOperation = typeof contentCreateOperations.$inferInsert;
export type ThreadModerationOperation = typeof threadModerationOperations.$inferSelect;
export type NewThreadModerationOperation = typeof threadModerationOperations.$inferInsert;
export type Signature = typeof signatures.$inferSelect;
export type Report = typeof reports.$inferSelect;
export type ReportResolutionOperation = typeof reportResolutionOperations.$inferSelect;
export type NewReportResolutionOperation = typeof reportResolutionOperations.$inferInsert;
export type ReportResolutionEffectRow = typeof reportResolutionEffects.$inferSelect;
export type NewReportResolutionEffect = typeof reportResolutionEffects.$inferInsert;
export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
export type ForumModerator = typeof forumModerators.$inferSelect;
export type AppSetting = typeof appSettings.$inferSelect;
export type ModerationActionRow = typeof moderationActions.$inferSelect;
export type Group = typeof groups.$inferSelect;
export type NewGroup = typeof groups.$inferInsert;
export type GroupMember = typeof groupMembers.$inferSelect;
export type NewGroupMember = typeof groupMembers.$inferInsert;
export type GroupInvite = typeof groupInvites.$inferSelect;
export type NewGroupInvite = typeof groupInvites.$inferInsert;
export type GroupClaim = typeof groupClaims.$inferSelect;
export type NewGroupClaim = typeof groupClaims.$inferInsert;
export type GroupWorkflowOperation = typeof groupWorkflowOperations.$inferSelect;
export type NewGroupWorkflowOperation = typeof groupWorkflowOperations.$inferInsert;
export type GroupMembershipEvent = typeof groupMembershipEvents.$inferSelect;
export type NewGroupMembershipEvent = typeof groupMembershipEvents.$inferInsert;
export type Subscription = typeof subscriptions.$inferSelect;
export type FeedEvent = typeof feedEvents.$inferSelect;
