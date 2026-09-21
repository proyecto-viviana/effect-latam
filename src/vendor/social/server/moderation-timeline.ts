import { parseModerationActionType } from "../../moderation/index";
import type { ModerationTimelineAction, ModerationTimelineItem } from "../types";

// Higher-priority actions appear first when one command writes multiple ledger
// rows at the same timestamp. Keeping this exhaustive makes new verbs choose an
// intentional display order instead of silently falling back to identifier order.
const ACTION_PRIORITY = {
  restore_content: 50,
  unpin_thread: 48,
  unlock_thread: 47,
  pin_thread: 46,
  lock_thread: 45,
  uphold: 40,
  mark_false_positive: 40,
  resolve_report: 40,
  clear_restriction: 35,
  restrict_user: 30,
  ban_user: 30,
  hold_for_review: 25,
  hide: 25,
  delete_content: 20,
  flag: 15,
  allow: 10,
} as const satisfies Readonly<Record<ModerationTimelineAction, number>>;

export function parseModerationTimelineAction(value: unknown): ModerationTimelineAction | null {
  return value === "resolve_report" ? value : parseModerationActionType(value);
}

/** Newest first, then semantic action priority, then ASCII id descending. */
export function compareModerationTimelineItems(
  a: Pick<ModerationTimelineItem, "action" | "createdAt" | "id">,
  b: Pick<ModerationTimelineItem, "action" | "createdAt" | "id">,
): number {
  const byTime = b.createdAt.getTime() - a.createdAt.getTime();
  if (byTime !== 0) return byTime;

  const byAction = ACTION_PRIORITY[b.action] - ACTION_PRIORITY[a.action];
  if (byAction !== 0) return byAction;

  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
}
