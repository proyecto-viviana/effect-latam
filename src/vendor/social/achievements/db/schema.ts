import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Achievement unlock records — one row per (user, achievement). Definitions live
 * in code (each app's catalog), so there is NO catalog/seed table here: only the
 * fact that a user unlocked a given achievement, and when. FK-less ids keep
 * social standalone-extractable (same convention as `user_best_scores`' composite
 * id). The pk is `${userId}:${achievementId}` so unlocking is an idempotent
 * `INSERT OR IGNORE` — re-evaluating never duplicates a row.
 */
export const userAchievements = sqliteTable(
  "user_achievements",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    achievementId: text("achievement_id").notNull(),
    unlockedAt: integer("unlocked_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index("user_achievements_user_idx").on(table.userId, table.unlockedAt)],
);

export type UserAchievement = typeof userAchievements.$inferSelect;
export type NewUserAchievement = typeof userAchievements.$inferInsert;

export const achievementEvents = sqliteTable(
  "achievement_events",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    id: text("id").notNull(),
    userId: text("user_id").notNull(),
    type: text("type").notNull(),
    payload: text("payload", { mode: "json" }).notNull().$type<Record<string, unknown>>(),
    ts: integer("ts", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("achievement_events_id_unique").on(table.id),
    index("ach_events_user_seq").on(table.userId, table.seq),
    index("ach_events_user_type").on(table.userId, table.type),
  ],
);

export type AchievementEventRow = typeof achievementEvents.$inferSelect;
export type NewAchievementEventRow = typeof achievementEvents.$inferInsert;

export const achievementProjection = sqliteTable("achievement_projection", {
  userId: text("user_id").primaryKey(),
  state: text("state", { mode: "json" }).notNull().$type<Record<string, unknown>>(),
  snapshot: text("snapshot", { mode: "json" }).notNull().$type<Record<string, number>>(),
  lastSeq: integer("last_seq").notNull(),
});

export type AchievementProjectionRow = typeof achievementProjection.$inferSelect;
export type NewAchievementProjectionRow = typeof achievementProjection.$inferInsert;
