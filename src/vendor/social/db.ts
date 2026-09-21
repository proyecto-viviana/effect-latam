import type { DrizzleD1Database } from "drizzle-orm/d1";

/**
 * A schema-agnostic D1 handle. social uses only the core query builder
 * (`select`/`insert`/`update`/`delete`/`batch`) — never the relational
 * `db.query.*` API — so it needs no schema generic. drizzle's schema generic is
 * invariant, so `any` is what lets the host pass its fully-typed
 * `drizzle(d1, { schema })` handle regardless of the host's table set. Internal
 * type-safety is unaffected: every query uses an explicit `.select({...})`.
 */
// oxlint-disable-next-line typescript/no-explicit-any -- schema-agnostic by design
export type Db = DrizzleD1Database<any>;
