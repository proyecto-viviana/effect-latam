import {
  EMPTY_DENY_BAG,
  canDo,
  denyBag,
  entitlementBag,
  type ActionDefinition,
  type Decision,
  type DenyBag,
  type EntitlementBag,
} from "../entitlements/index";

/**
 * The shared forum permission core, built on the entitlements module (`../../entitlements`)
 * (same composition pattern as tortafritapp's src/authz/actions.ts). Pure — no
 * DB, no Solid — so the API layer and the UI can both import it. The host app
 * re-exports the role ladder from its `auth/roles.ts` and supplies the actor
 * (role + moderation state + forum-moderator jurisdiction) from its own tables.
 */

/**
 * Role ladder: `moderator` has jurisdiction only over forums assigned in
 * `forum_moderators`; `global_moderator` is every moderation power everywhere
 * but no admin panel; `admin` is everything.
 */
export const FORUM_USER_ROLES = ["user", "moderator", "global_moderator", "admin"] as const;
export type ForumUserRole = (typeof FORUM_USER_ROLES)[number];

const FORUM_ROLE_RANK: Record<ForumUserRole, number> = {
  user: 0,
  moderator: 1,
  global_moderator: 2,
  admin: 3,
};

/** True if `role` meets or exceeds `min` (e.g. a moderation action needs >= moderator). */
export function hasForumRole(role: ForumUserRole, min: ForumUserRole): boolean {
  return FORUM_ROLE_RANK[role] >= FORUM_ROLE_RANK[min];
}

export function parseForumUserRole(raw: string | null | undefined): ForumUserRole | null {
  return (FORUM_USER_ROLES as readonly string[]).includes(raw ?? "")
    ? (raw as ForumUserRole)
    : null;
}

/**
 * User moderation state (mirrors the moderation module's
 * UserModerationState plus `banned`): `restricted` = write-mute (reads fine,
 * every UGC write denied); `banned` = no participation at all.
 */
export type ForumModerationState = "active" | "restricted" | "banned";

export const FORUM_CAPABILITY = {
  ugcWrite: "forum.ugc.write",
  moderate: "forum.moderate",
  moderateAll: "forum.moderate.all",
  restrictUsers: "forum.users.restrict",
  adminPanel: "forum.admin.panel",
} as const;

const ALL_FORUM_CAPABILITIES = Object.values(FORUM_CAPABILITY);

export const FORUM_ACTION = {
  threadCreate: "forum.thread.create",
  postCreate: "forum.post.create",
  contentEdit: "forum.content.edit",
  contentDeleteOwn: "forum.content.delete_own",
  contentTakedown: "forum.content.takedown",
  forumModerate: "forum.moderate",
  userRestrict: "forum.user.restrict",
  adminPanelAccess: "forum.admin.panel.access",
} as const;

export type ForumActionId = (typeof FORUM_ACTION)[keyof typeof FORUM_ACTION];

export const FORUM_ACTIONS = {
  [FORUM_ACTION.threadCreate]: {
    id: FORUM_ACTION.threadCreate,
    capabilities: [FORUM_CAPABILITY.ugcWrite],
  },
  [FORUM_ACTION.postCreate]: {
    id: FORUM_ACTION.postCreate,
    capabilities: [FORUM_CAPABILITY.ugcWrite],
  },
  [FORUM_ACTION.contentEdit]: {
    id: FORUM_ACTION.contentEdit,
    capabilities: [FORUM_CAPABILITY.ugcWrite],
  },
  [FORUM_ACTION.contentDeleteOwn]: {
    id: FORUM_ACTION.contentDeleteOwn,
    capabilities: [FORUM_CAPABILITY.ugcWrite],
  },
  [FORUM_ACTION.contentTakedown]: {
    id: FORUM_ACTION.contentTakedown,
    capabilities: [FORUM_CAPABILITY.moderate],
  },
  [FORUM_ACTION.forumModerate]: {
    id: FORUM_ACTION.forumModerate,
    capabilities: [FORUM_CAPABILITY.moderate],
  },
  [FORUM_ACTION.userRestrict]: {
    id: FORUM_ACTION.userRestrict,
    capabilities: [FORUM_CAPABILITY.restrictUsers],
  },
  [FORUM_ACTION.adminPanelAccess]: {
    id: FORUM_ACTION.adminPanelAccess,
    capabilities: [FORUM_CAPABILITY.adminPanel],
  },
} satisfies Record<ForumActionId, ActionDefinition>;

/**
 * The acting user, as the host resolves it: `role` from its users table,
 * moderation state/expiry from the same row, and (for plain moderators) the
 * forum slugs granted in `forum_moderators`. `forumModSlugs` left undefined
 * means jurisdiction is unknown (not yet loaded) — scoped checks then fall
 * back to role-only and the caller must load slugs before a per-forum verdict.
 */
export interface ForumActor {
  userId: string;
  role: ForumUserRole;
  moderationState?: ForumModerationState;
  restrictionExpiresAt?: Date | null;
  forumModSlugs?: ReadonlySet<string>;
}

/**
 * Whether the actor's restriction/ban is currently in force. `restrictionExpiresAt`
 * time-boxes both states; null/undefined expiry = indefinite. Accepts any shape
 * carrying the two state fields (a full actor or a raw users row).
 */
export function restrictionActive(
  actor: Pick<ForumActor, "moderationState" | "restrictionExpiresAt">,
  now: Date = new Date(),
): boolean {
  const state = actor.moderationState ?? "active";
  if (state === "active") return false;
  const expiresAt = actor.restrictionExpiresAt;
  return !expiresAt || expiresAt.getTime() > now.getTime();
}

export function entitlementBagForActor(actor: ForumActor): EntitlementBag {
  return entitlementBag({ capabilities: capabilitiesForRole(actor.role) });
}

function capabilitiesForRole(role: ForumUserRole): string[] {
  switch (role) {
    case "admin":
      return ALL_FORUM_CAPABILITIES;
    case "global_moderator":
      return [
        FORUM_CAPABILITY.ugcWrite,
        FORUM_CAPABILITY.moderate,
        FORUM_CAPABILITY.moderateAll,
        FORUM_CAPABILITY.restrictUsers,
      ];
    case "moderator":
      return [FORUM_CAPABILITY.ugcWrite, FORUM_CAPABILITY.moderate];
    case "user":
      return [FORUM_CAPABILITY.ugcWrite];
  }
}

/** Denies win over grants (entitlements semantics), so a banned admin still loses everything. */
export function denyBagForActor(actor: ForumActor, now: Date = new Date()): DenyBag {
  if (!restrictionActive(actor, now)) return EMPTY_DENY_BAG;
  if (actor.moderationState === "banned") {
    return denyBag({ capabilities: ALL_FORUM_CAPABILITIES });
  }
  return denyBag({ capabilities: [FORUM_CAPABILITY.ugcWrite] });
}

/** Full entitlements decision for one forum action — the denial list carries the 403 reason. */
export function decideForumAction(
  actor: ForumActor,
  actionId: ForumActionId,
  now: Date = new Date(),
): Decision {
  return canDo({
    action: FORUM_ACTIONS[actionId],
    allow: entitlementBagForActor(actor),
    deny: denyBagForActor(actor, now),
  });
}

/** Can the actor create/edit UGC at all (thread/post writes)? Restriction and ban deny this. */
export function canWriteUgc(actor: ForumActor, now: Date = new Date()): Decision {
  return decideForumAction(actor, FORUM_ACTION.threadCreate, now);
}

/**
 * Can the actor moderate `forumSlug` (takedown, pin/lock, resolve its reports)?
 * global_moderator/admin pass everywhere; a plain moderator needs the slug in
 * their `forumModSlugs` grant set.
 */
export function canModerateForum(
  actor: ForumActor,
  forumSlug: string,
  now: Date = new Date(),
): boolean {
  if (!decideForumAction(actor, FORUM_ACTION.forumModerate, now).allowed) return false;
  if (hasForumRole(actor.role, "global_moderator")) return true;
  return actor.forumModSlugs?.has(forumSlug) ?? false;
}

/**
 * Can the actor moderate anything (gates the /moderacion surface)? With
 * `forumModSlugs` unloaded this is role-only — a moderator with zero grants
 * still sees an empty queue, never other forums' reports.
 */
export function canModerateSomeForum(actor: ForumActor, now: Date = new Date()): boolean {
  if (!decideForumAction(actor, FORUM_ACTION.forumModerate, now).allowed) return false;
  if (hasForumRole(actor.role, "global_moderator")) return true;
  return actor.forumModSlugs === undefined || actor.forumModSlugs.size > 0;
}

/** Can the actor restrict/ban users (global_moderator+)? */
export function canRestrictUsers(actor: ForumActor, now: Date = new Date()): boolean {
  return decideForumAction(actor, FORUM_ACTION.userRestrict, now).allowed;
}

/** Can the actor use the admin panel (admin only)? */
export function canAccessAdminPanel(actor: ForumActor, now: Date = new Date()): boolean {
  return decideForumAction(actor, FORUM_ACTION.adminPanelAccess, now).allowed;
}
