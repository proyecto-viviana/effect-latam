import type {
  ModerationActionType,
  ModerationCategory,
  ModerationCaseSource,
  ModerationContentStatus,
  ModerationRecommendationAction,
  UserModerationState,
} from "./types";

const recommendationActions = new Set<ModerationRecommendationAction>([
  "allow",
  "flag",
  "hide",
  "restrict_user",
]);
const actionTypes = new Set<ModerationActionType>([
  "allow",
  "flag",
  "hide",
  "restrict_user",
  "hold_for_review",
  "restore_content",
  "uphold",
  "delete_content",
  "ban_user",
  "pin_thread",
  "unpin_thread",
  "lock_thread",
  "unlock_thread",
  "clear_restriction",
  "mark_false_positive",
]);
const categories = new Set<ModerationCategory>([
  "harassment",
  "hate",
  "threat",
  "sexual",
  "self_harm",
  "spam",
  "privacy",
  "other",
]);
const caseSources = new Set<ModerationCaseSource>(["admin", "ai", "system", "user_report"]);
const contentStatuses = new Set<ModerationContentStatus>([
  "visible",
  "flagged",
  "pending_review",
  "hidden",
  "deleted",
]);
const userStates = new Set<UserModerationState>(["active", "restricted", "banned"]);

export function parseModerationRecommendationAction(
  value: unknown,
): ModerationRecommendationAction | null {
  return typeof value === "string" &&
    recommendationActions.has(value as ModerationRecommendationAction)
    ? (value as ModerationRecommendationAction)
    : null;
}

export function parseModerationActionType(value: unknown): ModerationActionType | null {
  return typeof value === "string" && actionTypes.has(value as ModerationActionType)
    ? (value as ModerationActionType)
    : null;
}

export function parseModerationCategories(value: unknown): ModerationCategory[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? parseJsonArray(value) : [];
  return raw
    .filter(
      (item): item is ModerationCategory =>
        typeof item === "string" && categories.has(item as ModerationCategory),
    )
    .slice(0, 8);
}

export function parseModerationCaseSource(value: unknown): ModerationCaseSource {
  return typeof value === "string" && caseSources.has(value as ModerationCaseSource)
    ? (value as ModerationCaseSource)
    : "system";
}

export function parseModerationContentStatus(value: unknown): ModerationContentStatus {
  return typeof value === "string" && contentStatuses.has(value as ModerationContentStatus)
    ? (value as ModerationContentStatus)
    : "pending_review";
}

export function parseUserModerationState(value: unknown): UserModerationState {
  return typeof value === "string" && userStates.has(value as UserModerationState)
    ? (value as UserModerationState)
    : "restricted";
}

function parseJsonArray(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
