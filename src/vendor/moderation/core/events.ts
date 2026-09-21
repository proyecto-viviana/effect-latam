export const MODERATION_EVENT_NAMES = [
  "moderation.case.opened",
  "moderation.case.resolved",
  "moderation.detector.requested",
  "moderation.detector.completed",
  "moderation.detector.skipped",
  "moderation.detector.failed",
  "moderation.content.flagged",
  "moderation.content.hidden",
  "moderation.content.deleted",
  "moderation.content.restored",
  "moderation.user.restricted",
  "moderation.user.banned",
  "moderation.user.restriction_cleared",
  "moderation.admin.decision_recorded",
  "moderation.action.reverted",
] as const;

export type ModerationEventName = (typeof MODERATION_EVENT_NAMES)[number];
