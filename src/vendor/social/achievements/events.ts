import { sql } from "drizzle-orm";
import type { Db } from "../db";
import { achievementEvents } from "./db/schema";
import {
  evaluateDefinitionsSnapshot,
  snapshotFromProjection,
  syncAchievementProjection,
  type UnlockedAchievement,
} from "./server";
import type { AchievementDefinition, AchievementEvent, AchievementsRegistry } from "./registry";
import type { AchievementTextOptions } from "./registry";

export interface AchievementEventInput {
  id: string;
  userId: string;
  type: string;
  payload?: Record<string, unknown>;
  ts?: Date;
}

export interface RecordEventResult {
  inserted: boolean;
  event: AchievementEvent;
}

export interface RecordEventOptions {
  registry?: AchievementsRegistry;
  now?: Date;
}

export interface RecordEventStatementOptions {
  mode: "statement";
}

export interface EvaluateAfterEventOptions {
  notify: boolean;
  notificationHref?: string;
  now?: Date;
  text?: AchievementTextOptions;
}

export type IngestEventOptions = EvaluateAfterEventOptions;

type RecordEventStatement = ReturnType<typeof buildRecordEventStatement>;

export function recordEvent(
  db: Db,
  input: AchievementEventInput,
  opts: RecordEventStatementOptions,
): RecordEventStatement;
export function recordEvent(
  db: Db,
  input: AchievementEventInput,
  opts?: RecordEventOptions,
): Promise<RecordEventResult>;
export function recordEvent(
  db: Db,
  input: AchievementEventInput,
  opts: RecordEventOptions | RecordEventStatementOptions = {},
): Promise<RecordEventResult> | RecordEventStatement {
  const event = normalizeAchievementEvent(input);
  if ((opts as RecordEventStatementOptions).mode === "statement") {
    return buildRecordEventStatement(db, event);
  }

  return executeRecordEvent(db, event, opts as RecordEventOptions);
}

export function recordEventStatement(db: Db, input: AchievementEventInput): RecordEventStatement {
  return buildRecordEventStatement(db, normalizeAchievementEvent(input));
}

/**
 * Batch-only variant used after a guarded state transition. SQLite's
 * `changes()` refers to the immediately preceding statement, so this insert is
 * owned by the request that actually changed the row; stale replays emit no
 * event. Keep this statement adjacent to its guarded update (or another
 * one-row conditional side effect) inside the same D1 batch.
 */
export function recordEventAfterPreviousChange(db: Db, input: AchievementEventInput) {
  const event = normalizeAchievementEvent(input);
  return db.insert(achievementEvents).select(sql`
    SELECT NULL, ${event.id}, ${event.userId}, ${event.type}, ${JSON.stringify(event.payload)},
           ${Math.floor(event.ts.getTime() / 1_000)}
    WHERE changes() = 1
  `);
}

export async function evaluateAfterEvent(
  db: Db,
  registry: AchievementsRegistry,
  input: AchievementEventInput,
  opts: EvaluateAfterEventOptions = { notify: false },
): Promise<UnlockedAchievement[]> {
  const event = normalizeAchievementEvent(input);
  return reconcileUserEvents(db, registry, event.userId, [event.type], event.id, opts);
}

/**
 * Coalescing form of {@link evaluateAfterEvent} for a batch of already-recorded
 * events. Groups the batch by user and does ONE projection resolve + ONE
 * evaluation per user, over the union of the defs their event types bind.
 *
 * Per-event evaluation degrades badly here: the fold is order-sensitive, so any
 * event predating the last-folded one forces a full O(N) re-fold, and firing
 * evaluateAfterEvent once per event turns a B-event batch into O(B·N) work —
 * with the calls racing to persist the same user's projection row when fanned
 * out concurrently (the `Promise.all(events.map(evaluateAfterEvent))` pattern).
 * Folding the whole batch once collapses that to a single O(N) recompute per
 * distinct user, evaluated sequentially so same-user resolves never race
 * (ACHIEVE-6).
 */
export async function evaluateAfterEvents(
  db: Db,
  registry: AchievementsRegistry,
  inputs: readonly AchievementEventInput[],
  opts: EvaluateAfterEventOptions = { notify: false },
): Promise<UnlockedAchievement[]> {
  const events = inputs.map(normalizeAchievementEvent);
  if (events.length === 0) return [];

  // Group by user, preserving first-seen order; the first event stands in as the
  // representative provenance (sourceEventId) for that user's evaluation.
  const byUser = new Map<string, { types: Set<string>; sourceEventId: string }>();
  for (const event of events) {
    const entry = byUser.get(event.userId);
    if (entry) entry.types.add(event.type);
    else byUser.set(event.userId, { types: new Set([event.type]), sourceEventId: event.id });
  }

  const unlocked: UnlockedAchievement[] = [];
  for (const [userId, { types, sourceEventId }] of byUser) {
    unlocked.push(...(await reconcileUserEvents(db, registry, userId, types, sourceEventId, opts)));
  }
  return unlocked;
}

export async function ingestEvent(
  db: Db,
  registry: AchievementsRegistry,
  input: AchievementEventInput,
  opts: IngestEventOptions = { notify: false },
): Promise<UnlockedAchievement[]> {
  const event = normalizeAchievementEvent(input);
  const recorded = await recordEvent(db, event, { registry, now: opts.now });
  if (!recorded.inserted) return [];

  return evaluateAfterEvent(db, registry, recorded.event, opts);
}

/**
 * Bulk form of {@link ingestEvent}: records every event WITHOUT a per-event
 * projection sync, then reconciles once per user via {@link evaluateAfterEvents}.
 * Imports and other batch producers should use this so they fold the whole batch
 * a single time instead of paying the per-event read path per row (ACHIEVE-6).
 */
export async function ingestEvents(
  db: Db,
  registry: AchievementsRegistry,
  inputs: readonly AchievementEventInput[],
  opts: IngestEventOptions = { notify: false },
): Promise<UnlockedAchievement[]> {
  const recorded: AchievementEvent[] = [];
  for (const input of inputs) {
    // No registry passed → recordEvent does NOT sync the projection; the bulk
    // reconcile below folds everything once.
    const result = await recordEvent(db, input, { now: opts.now });
    if (result.inserted) recorded.push(result.event);
  }
  if (recorded.length === 0) return [];

  return evaluateAfterEvents(db, registry, recorded, opts);
}

/**
 * Persist a user's projection advance for the given event types, then evaluate
 * the defs those types bind plus the snapshot-derived (sourceless) defs against
 * the freshly-built snapshot. Shared by the single- and batch-event write paths.
 */
async function reconcileUserEvents(
  db: Db,
  registry: AchievementsRegistry,
  userId: string,
  eventTypes: Iterable<string>,
  sourceEventId: string,
  opts: EvaluateAfterEventOptions,
): Promise<UnlockedAchievement[]> {
  const affected = collectAffectedDefs(registry, eventTypes);
  // Hot path: events no rule binds can't advance a folded metric, so they never
  // unlock anything and we skip the projection/snapshot work entirely. (The
  // snapshot-derived defs also need a real triggering rule to piggyback on — an
  // otherwise-idle user is reconciled by the read path, not by inert events.)
  if (affected.length === 0) return [];

  // Write path: this runs after the events were recorded (often via a batched
  // statement-mode recordEvent that does NOT persist the projection), so persist
  // the projection advance here, then derive the snapshot. The read path stays
  // read-only via readProjection (ACHIEVE-4).
  const projection = await syncAchievementProjection(db, registry, userId);
  const snapshot = await snapshotFromProjection(db, userId, projection.snapshot, {
    now: opts.now,
  });

  // Piggyback the snapshot-derived (sourceless) defs onto this evaluation. They
  // bind no event type, so rulesByEventType() never lists them and the notifying
  // write path would otherwise skip them forever — leaving a time-derived badge
  // like `account-veteran` to unlock only on a silent read-path reconcile, never
  // with a notification. Re-reading them against the snapshot we just built costs
  // no extra DB work, so an active user crosses the threshold on their next event
  // (ACHIEVE-5). `snapshotDerived` is disjoint from `affected` (sourceless vs
  // sourced); evaluateDefinitionsSnapshot is idempotent regardless.
  const defs = [...affected, ...registry.snapshotDerivedDefs()];

  return evaluateDefinitionsSnapshot(db, defs, userId, snapshot, {
    notify: opts.notify,
    notificationHref: opts.notificationHref,
    sourceEventId,
    text: opts.text,
  });
}

/** Union of the defs bound by any of the given event types, de-duplicated. */
function collectAffectedDefs(
  registry: AchievementsRegistry,
  eventTypes: Iterable<string>,
): AchievementDefinition[] {
  const byEvent = registry.rulesByEventType();
  const seen = new Set<AchievementDefinition>();
  for (const type of eventTypes) {
    for (const def of byEvent.get(type) ?? []) seen.add(def);
  }
  return [...seen];
}

async function executeRecordEvent(
  db: Db,
  event: AchievementEvent,
  opts: RecordEventOptions,
): Promise<RecordEventResult> {
  const insertedRows = await buildRecordEventStatement(db, event);
  const inserted = insertedRows.length > 0;
  const insertedSeq = insertedRows[0]?.seq;
  const recordedEvent = insertedSeq == null ? event : { ...event, seq: insertedSeq };

  if (inserted && opts.registry) {
    await syncAchievementProjection(db, opts.registry, event.userId);
  }

  return { inserted, event: recordedEvent };
}

function buildRecordEventStatement(db: Db, event: AchievementEvent) {
  return db
    .insert(achievementEvents)
    .values({
      id: event.id,
      userId: event.userId,
      type: event.type,
      payload: event.payload,
      ts: event.ts,
    })
    .onConflictDoNothing({ target: achievementEvents.id })
    .returning({ id: achievementEvents.id, seq: achievementEvents.seq });
}

function normalizeAchievementEvent(input: AchievementEventInput): AchievementEvent {
  return {
    id: input.id,
    userId: input.userId,
    type: input.type,
    payload: normalizePayload(input.payload),
    ts: input.ts ?? new Date(),
  };
}

function normalizePayload(payload: Record<string, unknown> | undefined): Record<string, unknown> {
  return payload ?? {};
}
