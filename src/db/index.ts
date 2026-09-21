import { drizzle } from "drizzle-orm/d1";
import type { Db as SocialDb } from "../vendor/social/db";
import * as schema from "./schema";

export function getDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

export type Db = ReturnType<typeof getDb>;

/**
 * social packages peer drizzle-orm; when linked outside the monorepo, types can
 * disagree on private symbols. Cast at the boundary — runtime is the same D1 handle.
 */
export function asSocialDb(db: Db): SocialDb {
  return db as unknown as SocialDb;
}
