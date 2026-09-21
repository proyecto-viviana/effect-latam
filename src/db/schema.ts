import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export type UserRole = "member" | "staff";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    name: text("name"),
    avatarUrl: text("avatar_url"),
    username: text("username").unique(),
    countryCode: text("country_code"),
    role: text("role").notNull().default("member"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index("users_country_idx").on(table.countryCode)],
);

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const communityCountries = sqliteTable("community_countries", {
  code: text("code").primaryKey(),
  firstRegisteredAt: integer("first_registered_at", { mode: "timestamp" }).notNull(),
});

export const learnVisits = sqliteTable(
  "learn_visits",
  {
    userId: text("user_id").notNull(),
    lessonId: text("lesson_id").notNull(),
    visitedAt: integer("visited_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.lessonId] }),
    index("learn_visits_user_idx").on(table.userId),
  ],
);

// Social forum engine tables (curated barrel includes achievement_events)
export * from "../vendor/social/forums/schema";
export { userAchievements, achievementProjection } from "../vendor/social/achievements/db/schema";
