import { and, asc, eq, gt } from "drizzle-orm";
import type { Db } from "../db";
import { emit } from "../server/notifications";
import {
  achievementEvents,
  achievementProjection,
  type AchievementProjectionRow,
  userAchievements,
} from "./db/schema";
import { foldWithState, type AchievementFoldState } from "./fold";
import {
  ACHIEVEMENT_NOTIFICATION_TITLE_KEY,
  ACHIEVEMENT_SECRET_DESCRIPTION_KEY,
  ACHIEVEMENT_SECRET_TITLE_KEY,
  isUnlocked,
  progressFor,
  renderAchievementDescription,
  renderAchievementNotificationTitle,
  renderAchievementSecretDescription,
  renderAchievementSecretTitle,
  renderAchievementTitle,
  type AchievementCategory,
  type AchievementDefinition,
  type AchievementEvent,
  type AchievementProgress,
  type AchievementsRegistry,
  type AchievementSnapshot,
  type AchievementTextOptions,
  type AchievementTextParams,
} from "./registry";

const DAY_MS = 86_400_000;
const PROJECTION_META_KEY = "__projection";

export interface AchievementProjectionMetadata {
  lastEventTs: number;
  lastEventSeq: number;
  lastEventId: string;
}

export interface AchievementProjectionState extends AchievementFoldState {
  [PROJECTION_META_KEY]?: AchievementProjectionMetadata;
}

export interface BuildSnapshotOptions {
  registry: AchievementsRegistry;
  now?: Date;
}

export interface BuildSnapshotFromEventsOptions {
  extra?: AchievementSnapshot;
  now?: Date;
}

export interface RebuiltAchievementProjection {
  snapshot: AchievementSnapshot;
  state: AchievementProjectionState;
  lastSeq: number;
}

export interface ParsedProjectionState {
  state: AchievementProjectionState;
  /**
   * True when deserialization had to discard or coerce stored fold state — a
   * `distinctValues` entry that wasn't a clean `string[]` (dropped non-array or
   * truncated non-string members), or a `runs` entry that wasn't a finite
   * `{ current, longest }`. A lossy state can no longer be trusted for an
   * incremental fold: a distinct set shorter than the count it produced re-adds
   * already-seen values, and a dropped run restarts a live streak — both drift.
   * Callers rebuild from the event log instead. (ACHIEVE-3)
   */
  lossy: boolean;
}

/** Read a user's metric snapshot from the materialized projection. */
export async function buildSnapshot(
  db: Db,
  userId: string,
  extra: AchievementSnapshot | undefined,
  opts: BuildSnapshotOptions,
): Promise<AchievementSnapshot> {
  return buildSnapshotFromProjection(db, opts.registry, userId, { extra, now: opts.now });
}

export async function buildSnapshotFromProjection(
  db: Db,
  registry: AchievementsRegistry,
  userId: string,
  opts: BuildSnapshotFromEventsOptions = {},
): Promise<AchievementSnapshot> {
  // Read path: resolve the projection WITHOUT persisting it (ACHIEVE-4). A page
  // load must not write the cache — the write path (evaluateAfterEvent /
  // executeRecordEvent / rebuildProjection) owns persistence.
  const projection = await readProjection(db, registry, userId);
  return snapshotFromProjection(db, userId, projection.snapshot, opts);
}

/**
 * Derive a full metric snapshot from a (stored) projection snapshot: re-applies
 * the account-derived metrics that aren't part of the stored fold, then layers
 * any caller-supplied `extra`. Shared by the read path
 * ({@link buildSnapshotFromProjection}) and the write path (`evaluateAfterEvent`).
 */
export async function snapshotFromProjection(
  db: Db,
  userId: string,
  storedSnapshot: AchievementSnapshot,
  opts: BuildSnapshotFromEventsOptions = {},
): Promise<AchievementSnapshot> {
  const snapshot = await withAccountDerivedMetrics(
    db,
    userId,
    storedSnapshot,
    opts.now ?? new Date(),
  );
  return { ...snapshot, ...opts.extra };
}

export async function buildSnapshotFromEvents(
  db: Db,
  registry: AchievementsRegistry,
  userId: string,
  opts: BuildSnapshotFromEventsOptions = {},
): Promise<AchievementSnapshot> {
  const events = await loadAchievementEvents(db, userId);
  const { snapshot } = foldEventSnapshot(events, registry);
  applyAccountDerivedMetrics(snapshot, events, opts.now ?? new Date());
  return { ...snapshot, ...opts.extra };
}

export async function rebuildProjection(
  db: Db,
  registry: AchievementsRegistry,
  userId: string,
  _opts: { now?: Date } = {},
): Promise<RebuiltAchievementProjection> {
  const result = await computeProjectionFromEvents(db, registry, userId);
  await persistProjection(db, userId, result);
  return result;
}

/** Fold the full event log into a fresh projection WITHOUT persisting it. */
async function computeProjectionFromEvents(
  db: Db,
  registry: AchievementsRegistry,
  userId: string,
): Promise<RebuiltAchievementProjection> {
  const events = await loadAchievementEvents(db, userId);
  return foldEventSnapshot(events, registry);
}

async function persistProjection(
  db: Db,
  userId: string,
  projection: RebuiltAchievementProjection,
): Promise<void> {
  await db
    .insert(achievementProjection)
    .values({
      userId,
      state: projection.state as unknown as Record<string, unknown>,
      snapshot: projection.snapshot,
      lastSeq: projection.lastSeq,
    })
    .onConflictDoUpdate({
      target: achievementProjection.userId,
      set: {
        state: projection.state as unknown as Record<string, unknown>,
        snapshot: projection.snapshot,
        lastSeq: projection.lastSeq,
      },
    });
}

interface ResolvedProjection {
  projection: RebuiltAchievementProjection;
  /** True when `projection` differs from the stored row and should be persisted. */
  dirty: boolean;
}

/**
 * Resolve a user's current projection (stored row + in-memory fold of any
 * pending events) WITHOUT writing it back. `dirty` reports whether the result
 * diverges from what's stored — the write path persists when dirty, the read
 * path ignores it. Self-heals corrupt/stale rows by recomputing from the log.
 */
async function resolveProjection(
  db: Db,
  registry: AchievementsRegistry,
  userId: string,
): Promise<ResolvedProjection> {
  const row = await loadProjectionRow(db, userId);
  if (!row) {
    return { projection: await computeProjectionFromEvents(db, registry, userId), dirty: true };
  }

  // The stored fold state must round-trip cleanly: a distinct aggregator's
  // snapshot count is only correct while its serialized set of seen values is
  // intact, and a longestRun can only continue an active run from its saved
  // { current, longest }. If deserialization had to drop a malformed entry or
  // filter out members, the surviving state is shorter than the counts it
  // produced, so an incremental fold would re-add already-counted values (or
  // restart a live run) and drift. Rebuild from the event log to self-heal.
  const parsed = parseProjectionState(row.state);
  if (parsed.lossy) {
    return { projection: await computeProjectionFromEvents(db, registry, userId), dirty: true };
  }

  const pending = await loadAchievementEventsAfterSeq(db, userId, row.lastSeq);
  const stored: RebuiltAchievementProjection = {
    snapshot: storageSnapshot(row.snapshot),
    state: parsed.state,
    lastSeq: row.lastSeq,
  };
  if (pending.length === 0) return { projection: stored, dirty: false };

  const meta = stored.state[PROJECTION_META_KEY];
  if (
    (row.lastSeq > 0 && !meta) ||
    (meta && pending.some((event) => compareEventToMeta(event, meta) < 0))
  ) {
    return { projection: await computeProjectionFromEvents(db, registry, userId), dirty: true };
  }

  const result = foldWithState(pending, registry.aggregators(), {
    initialSnapshot: storageSnapshot(stored.snapshot),
    initialState: foldStateFromProjectionState(stored.state),
  });
  const next: RebuiltAchievementProjection = {
    snapshot: result.snapshot,
    state: withProjectionMetadata(result.state, pending),
    lastSeq: Math.max(row.lastSeq, result.lastSeq),
  };
  return { projection: next, dirty: true };
}

/**
 * Resolve the projection and persist it back when it diverges from the stored
 * row — the write path (`evaluateAfterEvent`, `executeRecordEvent`, backfill).
 */
export async function syncAchievementProjection(
  db: Db,
  registry: AchievementsRegistry,
  userId: string,
): Promise<RebuiltAchievementProjection> {
  const { projection, dirty } = await resolveProjection(db, registry, userId);
  if (dirty) await persistProjection(db, userId, projection);
  return projection;
}

/**
 * Resolve the projection WITHOUT persisting it — the read path (ACHIEVE-4).
 * Returns the same up-to-date snapshot `syncAchievementProjection` would (it
 * folds pending events in memory) but never writes the cache, so a GET that
 * renders achievements has no write side effect.
 */
export async function readProjection(
  db: Db,
  registry: AchievementsRegistry,
  userId: string,
): Promise<RebuiltAchievementProjection> {
  return (await resolveProjection(db, registry, userId)).projection;
}

async function loadProjectionRow(db: Db, userId: string): Promise<AchievementProjectionRow | null> {
  const rows = await db
    .select()
    .from(achievementProjection)
    .where(eq(achievementProjection.userId, userId))
    .limit(1);

  return rows[0] ?? null;
}

async function loadAchievementEvents(db: Db, userId: string): Promise<AchievementEvent[]> {
  const rows = await db
    .select({
      seq: achievementEvents.seq,
      id: achievementEvents.id,
      userId: achievementEvents.userId,
      type: achievementEvents.type,
      payload: achievementEvents.payload,
      ts: achievementEvents.ts,
    })
    .from(achievementEvents)
    .where(eq(achievementEvents.userId, userId))
    .orderBy(asc(achievementEvents.ts), asc(achievementEvents.seq));

  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    type: row.type,
    payload: normalizePayload(row.payload),
    ts: normalizeDate(row.ts),
    seq: row.seq,
  }));
}

async function loadAchievementEventsAfterSeq(
  db: Db,
  userId: string,
  afterSeq: number,
): Promise<AchievementEvent[]> {
  const rows = await db
    .select({
      seq: achievementEvents.seq,
      id: achievementEvents.id,
      userId: achievementEvents.userId,
      type: achievementEvents.type,
      payload: achievementEvents.payload,
      ts: achievementEvents.ts,
    })
    .from(achievementEvents)
    .where(and(eq(achievementEvents.userId, userId), gt(achievementEvents.seq, afterSeq)))
    .orderBy(asc(achievementEvents.ts), asc(achievementEvents.seq));

  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    type: row.type,
    payload: normalizePayload(row.payload),
    ts: normalizeDate(row.ts),
    seq: row.seq,
  }));
}

function foldEventSnapshot(
  events: readonly AchievementEvent[],
  registry: AchievementsRegistry,
): RebuiltAchievementProjection {
  const result = foldWithState(events, registry.aggregators(), {
    initialSnapshot: baseSocialSnapshot(),
  });
  return {
    ...result,
    state: withProjectionMetadata(result.state, events),
  };
}

function baseSocialSnapshot(): AchievementSnapshot {
  return {
    "forum.posts": 0,
    "forum.threads": 0,
    "tools.tierlists": 0,
    "games.played": 0,
    "games.totalScore": 0,
  };
}

function applyAccountDerivedMetrics(
  snapshot: AchievementSnapshot,
  events: readonly AchievementEvent[],
  now: Date,
): void {
  const created = events.find((event) => event.type === "account.created");
  if (!created) return;

  snapshot["account.exists"] = 1;
  snapshot["account.hasAvatar"] = (snapshot["account.hasAvatar"] ?? 0) > 0 ? 1 : 0;

  const ageDays = Math.floor((now.getTime() - created.ts.getTime()) / DAY_MS);
  snapshot["account.ageDays"] = Math.max(0, ageDays);
}

async function withAccountDerivedMetrics(
  db: Db,
  userId: string,
  storedSnapshot: AchievementSnapshot,
  now: Date,
): Promise<AchievementSnapshot> {
  const snapshot = storageSnapshot(storedSnapshot);
  delete snapshot["account.ageDays"];

  const created = await loadFirstAccountCreatedEvent(db, userId);
  if (!created) return snapshot;

  snapshot["account.exists"] = 1;
  snapshot["account.hasAvatar"] = (snapshot["account.hasAvatar"] ?? 0) > 0 ? 1 : 0;

  const ageDays = Math.floor((now.getTime() - created.ts.getTime()) / DAY_MS);
  snapshot["account.ageDays"] = Math.max(0, ageDays);

  return snapshot;
}

async function loadFirstAccountCreatedEvent(
  db: Db,
  userId: string,
): Promise<AchievementEvent | null> {
  const rows = await db
    .select({
      seq: achievementEvents.seq,
      id: achievementEvents.id,
      userId: achievementEvents.userId,
      type: achievementEvents.type,
      payload: achievementEvents.payload,
      ts: achievementEvents.ts,
    })
    .from(achievementEvents)
    .where(and(eq(achievementEvents.userId, userId), eq(achievementEvents.type, "account.created")))
    .orderBy(asc(achievementEvents.ts), asc(achievementEvents.seq))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    userId: row.userId,
    type: row.type,
    payload: normalizePayload(row.payload),
    ts: normalizeDate(row.ts),
    seq: row.seq,
  };
}

function storageSnapshot(snapshot: AchievementSnapshot): AchievementSnapshot {
  const stored = { ...snapshot };
  delete stored["account.ageDays"];
  return stored;
}

function withProjectionMetadata(
  state: AchievementFoldState,
  events: readonly AchievementEvent[],
): AchievementProjectionState {
  const highWatermark = projectionHighWatermark(events);
  if (!highWatermark) return { ...state };

  return {
    ...state,
    [PROJECTION_META_KEY]: highWatermark,
  };
}

function projectionHighWatermark(
  events: readonly AchievementEvent[],
): AchievementProjectionMetadata | null {
  const event = [...events].sort(compareEvents).at(-1);
  if (!event) return null;

  return {
    lastEventTs: event.ts.getTime(),
    lastEventSeq: event.seq ?? 0,
    lastEventId: event.id,
  };
}

function compareEventToMeta(event: AchievementEvent, meta: AchievementProjectionMetadata): number {
  const byTs = event.ts.getTime() - meta.lastEventTs;
  if (byTs !== 0) return byTs;

  const bySeq = (event.seq ?? 0) - meta.lastEventSeq;
  if (bySeq !== 0) return bySeq;

  return event.id.localeCompare(meta.lastEventId);
}

function compareEvents(a: AchievementEvent, b: AchievementEvent): number {
  const byTs = a.ts.getTime() - b.ts.getTime();
  if (byTs !== 0) return byTs;

  const bySeq = (a.seq ?? 0) - (b.seq ?? 0);
  if (bySeq !== 0) return bySeq;

  return a.id.localeCompare(b.id);
}

/**
 * Deserialize a stored projection's fold state, tracking whether any entry had
 * to be discarded or coerced (see {@link ParsedProjectionState.lossy}). A clean
 * row round-trips byte-for-byte with `lossy: false`; absent `distinctValues` /
 * `runs` are treated as empty (not lossy) for backward compatibility with
 * legitimately-empty and legacy rows. Invalid `__projection` metadata is dropped
 * here but is NOT counted as lossy — the stale-watermark rebuild in
 * `syncAchievementProjection` (`lastSeq > 0 && !meta`) already covers it.
 */
export function parseProjectionState(value: Record<string, unknown>): ParsedProjectionState {
  let lossy = false;

  const distinctValues: Record<string, string[]> = {};
  if (value.distinctValues !== undefined) {
    if (isRecord(value.distinctValues)) {
      for (const [key, raw] of Object.entries(value.distinctValues)) {
        if (!Array.isArray(raw)) {
          lossy = true;
          continue;
        }
        const strings = raw.filter((item): item is string => typeof item === "string");
        if (strings.length !== raw.length) lossy = true;
        distinctValues[key] = strings;
      }
    } else {
      lossy = true;
    }
  }

  const runs: Record<string, { current: number; longest: number }> = {};
  if (value.runs !== undefined) {
    if (isRecord(value.runs)) {
      for (const [key, raw] of Object.entries(value.runs)) {
        if (
          isRecord(raw) &&
          typeof raw.current === "number" &&
          Number.isFinite(raw.current) &&
          typeof raw.longest === "number" &&
          Number.isFinite(raw.longest)
        ) {
          runs[key] = { current: raw.current, longest: raw.longest };
        } else {
          lossy = true;
        }
      }
    } else {
      lossy = true;
    }
  }

  const meta = isProjectionMetadata(value[PROJECTION_META_KEY])
    ? value[PROJECTION_META_KEY]
    : undefined;

  return {
    state: {
      distinctValues,
      runs,
      ...(meta ? { [PROJECTION_META_KEY]: meta } : {}),
    },
    lossy,
  };
}

function foldStateFromProjectionState(state: AchievementProjectionState): AchievementFoldState {
  return {
    distinctValues: state.distinctValues,
    runs: state.runs,
  };
}

function isProjectionMetadata(value: unknown): value is AchievementProjectionMetadata {
  return (
    isRecord(value) &&
    typeof value.lastEventTs === "number" &&
    Number.isFinite(value.lastEventTs) &&
    typeof value.lastEventSeq === "number" &&
    Number.isFinite(value.lastEventSeq) &&
    typeof value.lastEventId === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function normalizePayload(payload: unknown): Record<string, unknown> {
  if (payload != null && typeof payload === "object" && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }

  if (typeof payload === "string") {
    try {
      const parsed = JSON.parse(payload) as unknown;
      if (parsed != null && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }

  return {};
}

function normalizeDate(value: Date | number | string): Date {
  if (value instanceof Date) return value;
  return new Date(value);
}

export interface UnlockedAchievement {
  achievementId: string;
  title: string;
  titleKey?: string;
  titleParams?: AchievementTextParams;
  icon?: string;
  kind?: AchievementDefinition["kind"];
}

export interface AchievementNotificationOptions {
  notify: boolean;
  notificationHref?: string;
  sourceEventId?: string;
  text?: AchievementTextOptions;
}

export interface EvaluateOptions extends AchievementNotificationOptions {
  extra?: AchievementSnapshot;
  now?: Date;
}

/**
 * Reconcile a user's unlocks against the current snapshot: insert any newly
 * satisfied achievements (idempotent — pk `${userId}:${id}` + `INSERT OR IGNORE`)
 * and, when `notify`, emit a `type:"achievement"` notification per genuinely-new
 * unlock. Concurrency-safe: only rows the DB actually inserted (via `RETURNING`,
 * which skips conflicts) are notified, so a racing evaluate never double-emits.
 *
 * The read path runs this with `notify:false` (silent reconcile so existing
 * users catch historical unlocks on first load); action sites pass `notify:true`
 * off the response path (best-effort, like `emailNewPostRecipients`).
 */
export async function evaluate(
  db: Db,
  registry: AchievementsRegistry,
  userId: string,
  opts: EvaluateOptions = { notify: false },
): Promise<UnlockedAchievement[]> {
  const snapshot = await buildSnapshot(db, userId, opts.extra, { registry, now: opts.now });
  return evaluateSnapshot(db, registry, userId, snapshot, opts);
}

/**
 * Reconcile a user's unlocks against an app-supplied metric snapshot.
 */
export async function evaluateSnapshot(
  db: Db,
  registry: AchievementsRegistry,
  userId: string,
  snapshot: AchievementSnapshot,
  opts: AchievementNotificationOptions = { notify: false },
): Promise<UnlockedAchievement[]> {
  return evaluateDefinitionsSnapshot(db, registry.list(), userId, snapshot, opts);
}

export async function evaluateDefinitionsSnapshot(
  db: Db,
  defs: readonly AchievementDefinition[],
  userId: string,
  snapshot: AchievementSnapshot,
  opts: AchievementNotificationOptions = { notify: false },
): Promise<UnlockedAchievement[]> {
  const satisfied = defs.filter((def) => isUnlocked(def, snapshot));
  if (satisfied.length === 0) return [];

  const existing = await db
    .select({ achievementId: userAchievements.achievementId })
    .from(userAchievements)
    .where(eq(userAchievements.userId, userId));
  const have = new Set(existing.map((r) => r.achievementId));
  const candidates = satisfied.filter((def) => !have.has(def.id));
  if (candidates.length === 0) return [];

  const now = new Date();
  const insertedRows = await db
    .insert(userAchievements)
    .values(
      candidates.map((def) => ({
        id: `${userId}:${def.id}`,
        userId,
        achievementId: def.id,
        unlockedAt: now,
      })),
    )
    .onConflictDoNothing()
    .returning({ achievementId: userAchievements.achievementId });

  const insertedIds = new Set(insertedRows.map((r) => r.achievementId));
  const unlocked = candidates.filter((def) => insertedIds.has(def.id));
  if (unlocked.length === 0) return [];

  if (opts.notify) {
    for (const def of unlocked) {
      const achievementTitle = renderAchievementTitle(def, opts.text);
      const notificationTitleParams = {
        ...opts.text?.notificationTitleParams,
        title: achievementTitle,
      };
      await emit(db, {
        recipientId: userId,
        type: "achievement",
        data: {
          achievementId: def.id,
          achievementTitle,
          ...(def.titleKey ? { achievementTitleKey: def.titleKey } : {}),
          ...(def.titleParams ? { achievementTitleParams: def.titleParams } : {}),
          title: renderAchievementNotificationTitle(def, opts.text),
          titleKey: opts.text?.notificationTitleKey ?? ACHIEVEMENT_NOTIFICATION_TITLE_KEY,
          titleParams: notificationTitleParams,
          icon: def.icon ?? "🏆",
          href: opts.notificationHref ?? "/logros",
          ...(opts.sourceEventId ? { sourceEventId: opts.sourceEventId } : {}),
        },
      });
    }
  }

  return unlocked.map((def) => ({
    achievementId: def.id,
    title: renderAchievementTitle(def, opts.text),
    ...(def.titleKey ? { titleKey: def.titleKey } : {}),
    ...(def.titleParams ? { titleParams: def.titleParams } : {}),
    icon: def.icon,
    ...(def.kind ? { kind: def.kind } : {}),
  }));
}

export interface UserAchievementView {
  id: string;
  title: string;
  description: string;
  titleKey?: string;
  titleParams?: AchievementTextParams;
  descKey?: string;
  descParams?: AchievementTextParams;
  icon?: string;
  category: AchievementCategory;
  kind?: AchievementDefinition["kind"];
  secret: boolean;
  unlocked: boolean;
  unlockedAt: Date | null;
  progress: AchievementProgress | null;
}

export interface ListUserAchievementsOptions {
  now?: Date;
  text?: AchievementTextOptions;
}

/**
 * Every definition in the registry decorated with the user's unlock state and
 * progress — the data behind the `/logros` page and profile badges. A secret
 * achievement that's still locked has its title/description/icon masked.
 */
export async function listUserAchievements(
  db: Db,
  registry: AchievementsRegistry,
  userId: string,
  opts: ListUserAchievementsOptions = {},
): Promise<UserAchievementView[]> {
  const [snapshot, rows] = await Promise.all([
    buildSnapshot(db, userId, undefined, { registry, now: opts.now }),
    db
      .select({
        achievementId: userAchievements.achievementId,
        unlockedAt: userAchievements.unlockedAt,
      })
      .from(userAchievements)
      .where(eq(userAchievements.userId, userId)),
  ]);
  return decorateUserAchievements(registry, snapshot, rows, opts.text);
}

/**
 * Decorate registry definitions using an app-supplied snapshot.
 */
export async function listUserAchievementsFromSnapshot(
  db: Db,
  registry: AchievementsRegistry,
  userId: string,
  snapshot: AchievementSnapshot,
  opts: { text?: AchievementTextOptions } = {},
): Promise<UserAchievementView[]> {
  const rows = await db
    .select({
      achievementId: userAchievements.achievementId,
      unlockedAt: userAchievements.unlockedAt,
    })
    .from(userAchievements)
    .where(eq(userAchievements.userId, userId));
  return decorateUserAchievements(registry, snapshot, rows, opts.text);
}

function decorateUserAchievements(
  registry: AchievementsRegistry,
  snapshot: AchievementSnapshot,
  rows: { achievementId: string; unlockedAt: Date }[],
  text?: AchievementTextOptions,
): UserAchievementView[] {
  const unlockedAtById = new Map(rows.map((r) => [r.achievementId, r.unlockedAt]));

  return registry.list().map((def) => {
    const unlockedAt = unlockedAtById.get(def.id) ?? null;
    // Recorded, or satisfied-but-not-yet-recorded (a standalone read with no
    // prior evaluate still reports the truth).
    const unlocked = unlockedAt != null || isUnlocked(def, snapshot);
    const masked = def.secret === true && !unlocked;
    return {
      id: def.id,
      title: masked ? renderAchievementSecretTitle(text) : renderAchievementTitle(def, text),
      description: masked
        ? renderAchievementSecretDescription(text)
        : renderAchievementDescription(def, text),
      titleKey: masked ? (text?.secretTitleKey ?? ACHIEVEMENT_SECRET_TITLE_KEY) : def.titleKey,
      titleParams: masked ? undefined : def.titleParams,
      descKey: masked
        ? (text?.secretDescriptionKey ?? ACHIEVEMENT_SECRET_DESCRIPTION_KEY)
        : def.descKey,
      descParams: masked ? undefined : def.descParams,
      icon: masked ? "❓" : def.icon,
      category: def.category,
      kind: def.kind,
      secret: def.secret ?? false,
      unlocked,
      unlockedAt,
      progress: progressFor(def, snapshot),
    };
  });
}
