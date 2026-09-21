import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Minimal projection of the host app's `users` table — only the columns the
 * package joins on (author/actor names; the tier-list public profile and the
 * achievements engine read `created_at`/`updated_at`/`avatar_url`; report
 * alerting selects `role` to find staff recipients). It maps to the same
 * physical `users` table the host owns; declaring it here lets the package read
 * these without importing the app's auth schema.
 *
 * Drizzle only emits the columns a query selects, so hosts whose users table
 * lacks one of these are unaffected as long as they don't run the query paths
 * that select it (`role` is read only by report alerting, which is opt-in).
 *
 * Deliberately NOT re-exported from `db/schema.ts`: the host's drizzle aggregate
 * owns the canonical `users` (with email, role, …) and its migrations, so there
 * must be exactly one `users` in that aggregate.
 */
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username"),
  name: text("name"),
  email: text("email").notNull(),
  role: text("role"),
  avatarUrl: text("avatar_url"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});
