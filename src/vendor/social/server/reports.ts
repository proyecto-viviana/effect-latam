import { and, asc, desc, eq, inArray, isNull, like, ne, or, sql, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { alias } from "drizzle-orm/sqlite-core";
import { users } from "../db/users";
import type { Db } from "../db";
import {
  forumModerators,
  moderationActions,
  notifications,
  posts,
  reports,
  threads,
} from "../db/schema";
import type {
  CreateReportInput,
  MutationResult,
  ModerationTimelineItem,
  PaginatedResponse,
  ReportModerationSummary,
  ReportWithContext,
} from "../types";
import { presentAuthor } from "./threads";
import {
  compareModerationTimelineItems,
  parseModerationTimelineAction,
} from "./moderation-timeline";

const DEFAULT_LIMIT = 25;
const PREVIEW_LEN = 140;
const TIMELINE_LIMIT_PER_REPORT = 8;
const EMPTY_REPORT_SUMMARY: ReportModerationSummary = {
  open: 0,
  resolved: 0,
  dismissed: 0,
  history: 0,
  total: 0,
};

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_LEN ? `${flat.slice(0, PREVIEW_LEN)}…` : flat;
}

interface ReportTimelineScope {
  reportId: string;
  targetType: "thread" | "post";
  targetId: string;
  authorId: string | null;
}

/**
 * Moderation cards need a local case history without becoming a global user
 * audit log. Include durable ledger rows for:
 * - the report itself (uphold/false-positive decisions),
 * - the reported content target (delete/restore history),
 * - account actions only when their reason explicitly references this report.
 */
async function listReportTimelines(
  db: Db,
  scopes: readonly ReportTimelineScope[],
): Promise<Map<string, ModerationTimelineItem[]>> {
  const byReport = new Map<string, ModerationTimelineItem[]>();
  for (const scope of scopes) byReport.set(scope.reportId, []);
  if (scopes.length === 0) return byReport;

  const reportIds = scopes.map((scope) => scope.reportId);
  const conditions: Array<SQL | undefined> = [
    and(eq(moderationActions.targetType, "report"), inArray(moderationActions.targetId, reportIds)),
  ];
  for (const scope of scopes) {
    conditions.push(
      and(
        eq(moderationActions.targetType, scope.targetType),
        eq(moderationActions.targetId, scope.targetId),
      ),
    );
    if (scope.authorId) {
      conditions.push(
        and(
          eq(moderationActions.targetType, "user"),
          eq(moderationActions.targetId, scope.authorId),
          like(moderationActions.reason, `%reporte=${scope.reportId}%`),
        ),
      );
    }
  }

  const actor = alias(users, "timeline_actor");
  const rows = await db
    .select({
      action: moderationActions,
      actor: {
        id: actor.id,
        username: actor.username,
        name: actor.name,
        avatarUrl: actor.avatarUrl,
      },
    })
    .from(moderationActions)
    .leftJoin(actor, eq(moderationActions.actorId, actor.id))
    .where(or(...conditions))
    .orderBy(desc(moderationActions.createdAt))
    .limit(Math.min(250, scopes.length * TIMELINE_LIMIT_PER_REPORT * 3));

  const seenByReport = new Map<string, Set<string>>();
  const push = (reportId: string, row: (typeof rows)[number]) => {
    const bucket = byReport.get(reportId);
    if (!bucket) return;
    const seen = seenByReport.get(reportId) ?? new Set<string>();
    if (seen.has(row.action.id)) return;
    seen.add(row.action.id);
    seenByReport.set(reportId, seen);
    const action = parseModerationTimelineAction(row.action.action);
    if (!action) return;
    bucket.push({
      id: row.action.id,
      action,
      targetType: row.action.targetType,
      targetId: row.action.targetId,
      reason: row.action.reason,
      createdAt: row.action.createdAt,
      actor: presentAuthor(row.action.actorId, row.actor),
    });
  };

  for (const row of rows) {
    for (const scope of scopes) {
      const isReportAction =
        row.action.targetType === "report" && row.action.targetId === scope.reportId;
      const isTargetAction =
        row.action.targetType === scope.targetType && row.action.targetId === scope.targetId;
      const isReportScopedUserAction =
        !!scope.authorId &&
        row.action.targetType === "user" &&
        row.action.targetId === scope.authorId &&
        row.action.reason.includes(`reporte=${scope.reportId}`);
      if (isReportAction || isTargetAction || isReportScopedUserAction) {
        push(scope.reportId, row);
      }
    }
  }

  for (const bucket of byReport.values()) {
    bucket.sort(compareModerationTimelineItems);
    if (bucket.length > TIMELINE_LIMIT_PER_REPORT) bucket.length = TIMELINE_LIMIT_PER_REPORT;
  }

  return byReport;
}

/**
 * In-app alert for the moderation crew when a new report lands (B4). Opt-in per
 * host — it reads `users.role` and `forum_moderators`, which not every consumer
 * of this module has provisioned. `title`/`href` are rendered verbatim by the
 * generic notification presenter (payload_json), so the host supplies its own
 * copy and its own moderation-queue URL.
 */
export interface ReportAlertOptions {
  title: string;
  href: string;
}

/**
 * File a report against a live thread/post. Idempotent per (reporter, target):
 * a second report while the first is still open returns the existing id rather
 * than spamming the queue. `not_found` if the target doesn't exist or is deleted;
 * `self_report` if the reporter authored the target (you can't report yourself —
 * FORUM-5).
 *
 * With `opts.notify`, a genuinely-new report (not a dedup hit) also inserts
 * "report" notifications for global moderators/admins plus the target forum's
 * moderators — never the reporter or the reported author.
 */
export async function createReport(
  db: Db,
  reporterId: string,
  input: CreateReportInput,
  opts: { notify?: ReportAlertOptions } = {},
): Promise<{ id: string } | "not_found" | "self_report"> {
  const target =
    input.targetType === "thread"
      ? await db
          .select({
            id: threads.id,
            authorId: threads.authorId,
            forumSlug: threads.forumSlug,
            threadId: threads.id,
          })
          .from(threads)
          .where(and(eq(threads.id, input.targetId), isNull(threads.deletedAt)))
          .limit(1)
      : await db
          .select({
            id: posts.id,
            authorId: posts.authorId,
            forumSlug: threads.forumSlug,
            threadId: posts.threadId,
          })
          .from(posts)
          .innerJoin(threads, eq(posts.threadId, threads.id))
          .where(and(eq(posts.id, input.targetId), isNull(posts.deletedAt)))
          .limit(1);
  if (!target[0]) return "not_found";
  if (target[0].authorId === reporterId) return "self_report";

  const openDup = and(
    eq(reports.reporterId, reporterId),
    eq(reports.targetType, input.targetType),
    eq(reports.targetId, input.targetId),
    eq(reports.status, "open"),
  );

  const [dup] = await db.select({ id: reports.id }).from(reports).where(openDup).limit(1);
  if (dup) return { id: dup.id };

  // The SELECT above is the fast path; the `reports_open_unique_idx` partial
  // unique index is the atomic backstop (SEAM-6). If a concurrent request
  // inserted first, our insert is a no-op and we return the winner's id.
  const id = crypto.randomUUID();
  const now = new Date();
  const recipientIds = opts.notify
    ? await reportAlertRecipientIds(db, target[0].forumSlug, [reporterId, target[0].authorId])
    : [];
  const reportInsert = db
    .insert(reports)
    .values({
      id,
      reporterId,
      targetType: input.targetType,
      targetId: input.targetId,
      reason: input.reason.trim(),
      createdAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: reports.id });
  const ownsCandidate = sql`EXISTS (
    SELECT 1 FROM ${reports} AS candidate
    WHERE candidate.id = ${id}
      AND candidate.reporter_id = ${reporterId}
      AND candidate.target_type = ${input.targetType}
      AND candidate.target_id = ${input.targetId}
      AND candidate.status = 'open'
  )`;
  const alertInserts = opts.notify
    ? recipientIds.map((recipientId) =>
        db.insert(notifications).select(sql`
          SELECT ${reportAlertNotificationId(id, recipientId)}, ${recipientId}, 'report',
                 ${target[0].threadId},
                 ${input.targetType === "post" ? input.targetId : null}, NULL,
                 ${JSON.stringify({ title: opts.notify!.title, href: opts.notify!.href })},
                 ${id}, NULL, ${Math.floor(now.getTime() / 1_000)}
          WHERE ${ownsCandidate}
        `),
      )
    : [];
  const statements: [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]] = [
    reportInsert,
    ...alertInserts,
  ];
  const batchResults = await db.batch(statements);
  const inserted = Array.isArray(batchResults[0]) && batchResults[0].length === 1;
  if (inserted) return { id };

  const [winner] = await db.select({ id: reports.id }).from(reports).where(openDup).limit(1);
  return { id: winner?.id ?? id };
}

function reportAlertNotificationId(reportId: string, recipientId: string): string {
  return `report-alert:${reportId}:${recipientId}`;
}

/** Resolve the unique report-alert audience before the atomic commit batch. */
async function reportAlertRecipientIds(
  db: Db,
  forumSlug: string,
  excludeIds: readonly string[],
): Promise<string[]> {
  const [staff, forumMods] = await Promise.all([
    db
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.role, ["global_moderator", "admin"])),
    db
      .select({ id: forumModerators.userId })
      .from(forumModerators)
      .where(eq(forumModerators.forumSlug, forumSlug)),
  ]);
  const recipients = new Set([...staff, ...forumMods].map((r) => r.id));
  for (const excluded of excludeIds) recipients.delete(excluded);
  return [...recipients].sort();
}

const resolver = alias(users, "resolver");

export interface ReportListQuery {
  page?: number;
  limit?: number;
  /**
   * Jurisdiction filter: only reports whose target lives in one of these
   * forums (a plain moderator's grant set). Undefined = unscoped; an empty
   * list matches nothing.
   */
  forumSlugs?: readonly string[];
}

export async function getReportModerationSummary(
  db: Db,
  query: Pick<ReportListQuery, "forumSlugs"> = {},
): Promise<ReportModerationSummary> {
  if (query.forumSlugs && query.forumSlugs.length === 0) return EMPTY_REPORT_SUMMARY;

  const postThread = alias(threads, "summary_post_thread");
  const rows = await db
    .select({ status: reports.status, count: sql<number>`count(*)` })
    .from(reports)
    .leftJoin(threads, and(eq(reports.targetType, "thread"), eq(threads.id, reports.targetId)))
    .leftJoin(posts, and(eq(reports.targetType, "post"), eq(posts.id, reports.targetId)))
    .leftJoin(postThread, and(eq(reports.targetType, "post"), eq(postThread.id, posts.threadId)))
    .where(
      query.forumSlugs
        ? or(
            inArray(threads.forumSlug, [...query.forumSlugs]),
            inArray(postThread.forumSlug, [...query.forumSlugs]),
          )
        : undefined,
    )
    .groupBy(reports.status);

  const summary = { ...EMPTY_REPORT_SUMMARY };
  for (const row of rows) {
    summary[row.status] = row.count;
  }
  summary.history = summary.resolved + summary.dismissed;
  summary.total = summary.open + summary.history;
  return summary;
}

/**
 * Shared report listing: each row joined to its reporter, its target (preview +
 * link), and its resolver. The two target joins are type-discriminated, so
 * exactly one side resolves per row. `open` = the FIFO queue; `resolved` = the
 * actioned-audit view (resolved/dismissed, newest first).
 */
async function queryReports(
  db: Db,
  scope: "open" | "resolved",
  query: ReportListQuery,
): Promise<PaginatedResponse<ReportWithContext>> {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(100, query.limit ?? DEFAULT_LIMIT);
  const offset = (page - 1) * limit;

  if (query.forumSlugs && query.forumSlugs.length === 0) {
    return { items: [], total: 0, page, limit, hasMore: false };
  }

  // For a post target we also need its parent thread (forum slug + link), via a
  // second `threads` alias on posts.threadId. Both the row query and the count
  // share the joins because the jurisdiction filter reads the joined slugs.
  const postThread = alias(threads, "post_thread");
  const contentAuthor = alias(users, "content_author");
  const statusCondition =
    scope === "open" ? eq(reports.status, "open") : ne(reports.status, "open");
  const jurisdiction = query.forumSlugs
    ? or(
        inArray(threads.forumSlug, [...query.forumSlugs]),
        inArray(postThread.forumSlug, [...query.forumSlugs]),
      )
    : undefined;
  const condition = and(statusCondition, jurisdiction);
  const order = scope === "open" ? asc(reports.createdAt) : desc(reports.resolvedAt);

  const rows = await db
    .select({
      report: reports,
      reporter: {
        id: users.id,
        username: users.username,
        name: users.name,
        avatarUrl: users.avatarUrl,
      },
      resolverRow: {
        id: resolver.id,
        username: resolver.username,
        name: resolver.name,
        avatarUrl: resolver.avatarUrl,
      },
      authorRow: {
        id: contentAuthor.id,
        username: contentAuthor.username,
        name: contentAuthor.name,
        avatarUrl: contentAuthor.avatarUrl,
      },
      threadTitle: threads.title,
      threadSlug: threads.forumSlug,
      threadAuthorId: threads.authorId,
      threadDeletedAt: threads.deletedAt,
      postContent: posts.content,
      postAuthorId: posts.authorId,
      postThreadId: posts.threadId,
      postThreadSlug: postThread.forumSlug,
      postDeletedAt: posts.deletedAt,
    })
    .from(reports)
    .leftJoin(users, eq(reports.reporterId, users.id))
    .leftJoin(resolver, eq(reports.resolvedBy, resolver.id))
    .leftJoin(threads, and(eq(reports.targetType, "thread"), eq(threads.id, reports.targetId)))
    .leftJoin(posts, and(eq(reports.targetType, "post"), eq(posts.id, reports.targetId)))
    .leftJoin(postThread, and(eq(reports.targetType, "post"), eq(postThread.id, posts.threadId)))
    // Exactly one target join resolves per row, so coalesce picks the author.
    .leftJoin(
      contentAuthor,
      eq(contentAuthor.id, sql`coalesce(${threads.authorId}, ${posts.authorId})`),
    )
    .where(condition)
    .orderBy(order)
    .limit(limit)
    .offset(offset);

  const totalRow = await db
    .select({ count: sql<number>`count(*)` })
    .from(reports)
    .leftJoin(threads, and(eq(reports.targetType, "thread"), eq(threads.id, reports.targetId)))
    .leftJoin(posts, and(eq(reports.targetType, "post"), eq(posts.id, reports.targetId)))
    .leftJoin(postThread, and(eq(reports.targetType, "post"), eq(postThread.id, posts.threadId)))
    .where(condition);
  const total = totalRow[0]?.count ?? 0;

  const timelineScopes: ReportTimelineScope[] = [];
  const items: ReportWithContext[] = rows.map((r) => {
    const isThread = r.report.targetType === "thread";
    const preview = isThread
      ? (r.threadTitle ?? "(tema eliminado)")
      : r.postContent != null
        ? excerpt(r.postContent)
        : "(mensaje eliminado)";
    const threadId = isThread
      ? r.threadTitle != null
        ? r.report.targetId
        : null
      : (r.postThreadId ?? null);
    const forumSlug = isThread ? (r.threadSlug ?? null) : (r.postThreadSlug ?? null);
    const authorId = isThread ? r.threadAuthorId : r.postAuthorId;
    timelineScopes.push({
      reportId: r.report.id,
      targetType: r.report.targetType,
      targetId: r.report.targetId,
      authorId: authorId ?? null,
    });
    return {
      id: r.report.id,
      targetType: r.report.targetType,
      targetId: r.report.targetId,
      reason: r.report.reason,
      status: r.report.status,
      createdAt: r.report.createdAt,
      reporter: presentAuthor(r.report.reporterId, r.reporter),
      author: authorId ? presentAuthor(authorId, r.authorRow) : null,
      resolver: r.report.resolvedBy ? presentAuthor(r.report.resolvedBy, r.resolverRow) : null,
      resolvedAt: r.report.resolvedAt,
      forumSlug,
      threadId,
      targetDeletedAt: isThread ? (r.threadDeletedAt ?? null) : (r.postDeletedAt ?? null),
      preview,
      timeline: [],
    };
  });
  const timelines = await listReportTimelines(db, timelineScopes);
  for (const item of items) item.timeline = timelines.get(item.id) ?? [];

  return { items, total, page, limit, hasMore: offset + items.length < total };
}

/** The moderation queue: open reports oldest-first (FIFO). */
export function listOpenReports(db: Db, query: ReportListQuery = {}) {
  return queryReports(db, "open", query);
}

/** Actioned reports (resolved/dismissed), newest-first — the audit view. */
export function listResolvedReports(db: Db, query: ReportListQuery = {}) {
  return queryReports(db, "resolved", query);
}

export interface ReportContext {
  id: string;
  status: string;
  targetType: "thread" | "post";
  targetId: string;
  /** null when the target (or its parent thread) is already gone. */
  forumSlug: string | null;
  authorId: string | null;
}

/**
 * One report with the context enforcement needs: the target's forum (for
 * jurisdiction checks on resolve-with-takedown) and its author (for
 * restrict-from-report). Nulls mean the target no longer resolves.
 */
export async function getReportContext(db: Db, reportId: string): Promise<ReportContext | null> {
  const postThread = alias(threads, "post_thread");
  const [r] = await db
    .select({
      id: reports.id,
      status: reports.status,
      targetType: reports.targetType,
      targetId: reports.targetId,
      threadSlug: threads.forumSlug,
      threadAuthorId: threads.authorId,
      postAuthorId: posts.authorId,
      postThreadSlug: postThread.forumSlug,
    })
    .from(reports)
    .leftJoin(threads, and(eq(reports.targetType, "thread"), eq(threads.id, reports.targetId)))
    .leftJoin(posts, and(eq(reports.targetType, "post"), eq(posts.id, reports.targetId)))
    .leftJoin(postThread, and(eq(reports.targetType, "post"), eq(postThread.id, posts.threadId)))
    .where(eq(reports.id, reportId))
    .limit(1);
  if (!r) return null;
  const isThread = r.targetType === "thread";
  return {
    id: r.id,
    status: r.status,
    targetType: r.targetType,
    targetId: r.targetId,
    forumSlug: isThread ? r.threadSlug : r.postThreadSlug,
    authorId: isThread ? r.threadAuthorId : r.postAuthorId,
  };
}

/**
 * Resolve or dismiss a report. Idempotent: a non-open report is left as-is and
 * still reports "ok"; `not_found` only if the id is unknown.
 */
export async function resolveReport(
  db: Db,
  reportId: string,
  moderatorId: string,
  verdict: "resolved" | "dismissed",
): Promise<MutationResult> {
  const [row] = await db
    .select({ status: reports.status })
    .from(reports)
    .where(eq(reports.id, reportId))
    .limit(1);
  if (!row) return "not_found";
  if (row.status !== "open") return "ok";
  await db
    .update(reports)
    .set({ status: verdict, resolvedBy: moderatorId, resolvedAt: new Date() })
    .where(eq(reports.id, reportId));
  return "ok";
}
