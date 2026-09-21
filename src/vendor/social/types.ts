import type { ModerationActionType } from "../moderation/index";

/** Outcome of an author-scoped mutation: distinguishes 404 from 403 (no row-count conflation). */
export type MutationResult = "ok" | "not_found" | "forbidden";

/** Current shared verbs plus the sole pre-contract report-resolution verb. */
export type ModerationTimelineAction = ModerationActionType | "resolve_report";

/** Client copy for a moderation timeline must account for every durable verb. */
export type ModerationTimelineActionLabels = Readonly<Record<ModerationTimelineAction, string>>;

export interface CreateThreadInput {
  forumSlug: string;
  title: string;
  content: string;
}

export interface CreatePostInput {
  threadId: string;
  content: string;
}

export interface CreatePostResult {
  id: string;
  /** Recipients an in-app notification was generated for. */
  notified: NotifiedRecipient[];
}

export const THREAD_LIST_STATUSES = ["all", "open", "locked"] as const;
export type ThreadListStatus = (typeof THREAD_LIST_STATUSES)[number];

export const THREAD_LIST_SORTS = ["activity", "newest", "replies"] as const;
export type ThreadListSort = (typeof THREAD_LIST_SORTS)[number];

export interface ThreadListQuery {
  forumSlug: string;
  page?: number;
  limit?: number;
  q?: string;
  status?: ThreadListStatus;
  sort?: ThreadListSort;
}

export interface PostListQuery {
  threadId: string;
  page?: number;
  limit?: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface Author {
  id: string;
  username: string | null;
  name: string | null;
  avatarUrl: string | null;
}

export interface ThreadWithAuthor {
  id: string;
  forumSlug: string;
  title: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  replyCount: number;
  lastReplyAt: Date | null;
  isPinned: boolean;
  isLocked: boolean;
  author: Author;
  lastReplyAuthor: Author | null;
}

export interface SavedThreadWithAuthor extends ThreadWithAuthor {
  savedAt: Date;
}

export interface PostWithAuthor {
  id: string;
  threadId: string;
  content: string;
  replyOrdinal: number;
  createdAt: Date;
  updatedAt: Date;
  isEdited: boolean;
  author: Author;
  signature: string | null;
}

export type ReportTargetType = "thread" | "post";
export type ReportStatus = "open" | "resolved" | "dismissed";

export interface CreateReportInput {
  targetType: ReportTargetType;
  targetId: string;
  reason: string;
}

export type NotificationType = "reply" | "mention" | "achievement" | "system" | "report";

/** The forum notification types — the subset that rides along with a new post. */
export type ForumNotificationType = "reply" | "mention";

export const SOCIAL_GROUP_KINDS = ["official", "community"] as const;
export type SocialGroupKind = (typeof SOCIAL_GROUP_KINDS)[number];

export const SOCIAL_GROUP_ROLES = ["admin", "rep", "member"] as const;
export type SocialGroupRole = (typeof SOCIAL_GROUP_ROLES)[number];

export const SOCIAL_GROUP_INVITE_STATUSES = [
  "pending",
  "accepted",
  "declined",
  "cancelled",
  "expired",
] as const;
export type SocialGroupInviteStatus = (typeof SOCIAL_GROUP_INVITE_STATUSES)[number];

export const SOCIAL_GROUP_CLAIM_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "cancelled",
] as const;
export type SocialGroupClaimStatus = (typeof SOCIAL_GROUP_CLAIM_STATUSES)[number];

export const SOCIAL_GROUP_WORKFLOW_OPERATION_KINDS = [
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
] as const;
export type SocialGroupWorkflowOperationKind =
  (typeof SOCIAL_GROUP_WORKFLOW_OPERATION_KINDS)[number];

// Persisted ledger outcomes. Replay, operation-ID conflict, and infrastructure
// failure are command-boundary results that do not create a second ledger row.
export const SOCIAL_GROUP_WORKFLOW_OUTCOMES = [
  "created",
  "applied",
  "duplicate_pending",
  "transition_conflict",
  "expired",
  "not_eligible",
  "forbidden",
  "not_found",
] as const;
export type SocialGroupWorkflowOutcome = (typeof SOCIAL_GROUP_WORKFLOW_OUTCOMES)[number];

export const SOCIAL_GROUP_MEMBERSHIP_ACTIONS = ["upsert", "remove"] as const;
export type SocialGroupMembershipAction = (typeof SOCIAL_GROUP_MEMBERSHIP_ACTIONS)[number];

export const SOCIAL_GROUP_MEMBERSHIP_PROVENANCES = [
  "legacy",
  "invitation",
  "role_request",
  "direct_admin",
] as const;
export type SocialGroupMembershipProvenance = (typeof SOCIAL_GROUP_MEMBERSHIP_PROVENANCES)[number];

export const SOCIAL_SUBSCRIPTION_TARGET_TYPES = ["group", "user"] as const;
export type SocialSubscriptionTargetType = (typeof SOCIAL_SUBSCRIPTION_TARGET_TYPES)[number];

export const SOCIAL_FEED_EVENT_TYPES = ["market_created", "post_created", "system"] as const;
export type SocialFeedEventType = (typeof SOCIAL_FEED_EVENT_TYPES)[number];

/** A recipient flagged for notification when a post is created. */
export interface NotifiedRecipient {
  recipientId: string;
  type: ForumNotificationType;
}

/**
 * A notification enriched for the bell dropdown. Forum types (reply/mention)
 * populate the thread context (threadId/forumSlug/threadTitle/actor); non-forum
 * types (achievement/system) leave those null and use the generic
 * `title`/`href`/`icon`.
 */
export interface NotificationItem {
  id: string;
  type: NotificationType;
  threadId: string | null;
  postId: string | null;
  forumSlug: string | null;
  threadTitle: string | null;
  actor: Author | null;
  read: boolean;
  createdAt: Date;
  /** Generic render fields for non-forum notifications (from the row's payload JSON). */
  title?: string | null;
  titleKey?: string | null;
  titleParams?: Record<string, unknown> | null;
  href?: string | null;
  icon?: string | null;
}

export interface ModerationTimelineItem {
  id: string;
  action: ModerationTimelineAction;
  targetType: "thread" | "post" | "user" | "report" | "setting";
  targetId: string;
  reason: string;
  createdAt: Date;
  actor: Author;
}

/** A queued report enriched for the moderation view: reporter, a content
 * preview, and where to link (forumSlug + threadId; null if the target was
 * since removed). */
export interface ReportWithContext {
  id: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: string;
  status: ReportStatus;
  createdAt: Date;
  reporter: Author;
  /** Who wrote the reported content — null when the target is already gone. */
  author: Author | null;
  /** Who actioned it + when — null while open (the resolved-audit view). */
  resolver: Author | null;
  resolvedAt: Date | null;
  forumSlug: string | null;
  threadId: string | null;
  targetDeletedAt: Date | null;
  preview: string;
  timeline: ModerationTimelineItem[];
}

export interface ReportModerationSummary {
  open: number;
  resolved: number;
  dismissed: number;
  history: number;
  total: number;
}
