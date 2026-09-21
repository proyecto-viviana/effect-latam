/**
 * Curated forum-tables barrel — the exact physical tables a host must mount to run
 * forums, and nothing else. Re-export this one module (`export * from
 * "./schema"`) instead of hand-picking from
 * `../db/schema`.
 *
 * It deliberately EXCLUDES the groups / market / feed tables (mount those from
 * `../db/schema` only if you use them), and it deliberately INCLUDES
 * `achievementEvents`: content creation batches an insert and content
 * deletion/restoration batches a transition-owned insert into
 * `achievement_events` (see `../server/threads.ts`, `../server/posts.ts`), so a
 * host that mounts forums without that table fails at *runtime* — a failure
 * `tsc`/`vite build` cannot catch. Bundling it here makes it impossible to forget.
 * (A matching migration for the physical table is still required.)
 */
export {
  threads,
  posts,
  signatures,
  reports,
  reportResolutionOperations,
  reportResolutionEffects,
  notifications,
  notificationPrefs,
} from "../db/schema";
export type {
  Thread,
  NewThread,
  Post,
  NewPost,
  Signature,
  Report,
  ReportResolutionOperation,
  NewReportResolutionOperation,
  ReportResolutionEffectRow,
  NewReportResolutionEffect,
  Notification,
  NewNotification,
} from "../db/schema";
export { achievementEvents } from "../achievements/db/schema";
export type { AchievementEventRow, NewAchievementEventRow } from "../achievements/db/schema";
