/**
 * The achievements registry. "An achievement is just data + a predicate over a
 * stat snapshot." Mirrors the games registry: a plain value built from an
 * explicit list (see each app's `catalog`), NOT a global populated by import
 * side effects — apps set `"sideEffects": false`, so a side-effect registration
 * import would be tree-shaken away in the production bundle.
 *
 * The shared engine (server.ts) never imports app content; each app composes its
 * registry from the defaults plus its own themed/custom achievements and passes
 * it into evaluate()/listUserAchievements(). Metric names are plain strings (the
 * engine is content-agnostic); buildSnapshot derives their values from existing
 * social tables.
 */

export type AchievementCategory = "forum" | "games" | "tools" | "account" | "custom";

/**
 * A named-metric snapshot of a user's stats (e.g. `forum.posts`, `games.played`,
 * `games.best.<categoryId>`). Absent metrics read as 0.
 */
export type AchievementSnapshot = Record<string, number>;

export interface AchievementProgress {
  current: number;
  target: number;
}

export type AchievementKind = "cosmetic" | "economic";

export type AchievementTextParam = string | number | boolean | null;
export type AchievementTextParams = Record<string, AchievementTextParam>;
export type AchievementTextResolver = (
  key: string,
  fallback: string,
  params?: AchievementTextParams,
) => string;

export interface AchievementTextOptions {
  resolveText?: AchievementTextResolver;
  secretTitleKey?: string;
  secretDescriptionKey?: string;
  secretTitle?: string;
  secretDescription?: string;
  notificationTitleKey?: string;
  notificationTitle?: string;
  notificationTitleParams?: AchievementTextParams;
}

export const ACHIEVEMENT_SECRET_TITLE_KEY = "achievements.secret.title";
export const ACHIEVEMENT_SECRET_DESCRIPTION_KEY = "achievements.secret.description";
export const ACHIEVEMENT_NOTIFICATION_TITLE_KEY = "achievements.notification.unlocked.title";

/**
 * The event shape consumed by declarative achievement aggregators. The durable
 * event log lands in a later slice; this is the in-memory contract for reducers
 * and `when` predicates.
 */
export interface AchievementEvent {
  id: string;
  userId: string;
  type: string;
  payload: Record<string, unknown>;
  ts: Date;
  seq?: number;
}

interface AggregatorBase {
  /** Numeric snapshot key populated by this event fold. */
  metric: string;
  /**
   * Optional payload field appended to `metric` as `metric.<value>`.
   * Used for keyed metrics such as `games.best.<categoryId>`.
   */
  metricKeyField?: string;
  /** Open, namespaced event type, e.g. `forum.post.created`. */
  event: string;
  /** Optional event predicate. For run aggregators, a non-match resets the run. */
  when?: (event: AchievementEvent) => boolean;
}

export interface CountAggregatorSpec extends AggregatorBase {
  agg: "count";
  /**
   * Signed step applied per matching event (default +1). A compensating source
   * with `delta: -1` on the matching reversal event (e.g. `forum.post.deleted`)
   * lets a count re-fold after content is removed; the metric is clamped at 0 so
   * an orphan reversal can never drive it negative.
   */
  delta?: number;
}

export interface FieldAggregatorSpec extends AggregatorBase {
  agg: "sum" | "max";
  field: string;
}

export interface DistinctAggregatorSpec extends AggregatorBase {
  agg: "distinct";
  field: string;
}

export interface RunAggregatorSpec extends AggregatorBase {
  agg: "longestRun" | "currentStreak";
}

export interface LastTimestampAggregatorSpec extends AggregatorBase {
  agg: "lastTs";
}

export type AggregatorSpec =
  | CountAggregatorSpec
  | FieldAggregatorSpec
  | DistinctAggregatorSpec
  | RunAggregatorSpec
  | LastTimestampAggregatorSpec;

export type AchievementSource = AggregatorSpec | readonly AggregatorSpec[];

export interface AchievementDefinition {
  id: string;
  title: string;
  description: string;
  titleKey?: string;
  titleParams?: AchievementTextParams;
  descKey?: string;
  descParams?: AchievementTextParams;
  icon?: string;
  category: AchievementCategory;
  /** Cosmetic achievements only unlock a badge; economic achievements may mint app rewards. */
  kind?: AchievementKind;
  /** Hidden from the catalog (title/description withheld) until unlocked. */
  secret?: boolean;
  /**
   * The common case: a single metric that must reach `threshold`. The engine
   * derives both the unlock check and the progress bar from these.
   */
  metric?: string;
  threshold?: number;
  /**
   * Optional event-fold metadata for future event-derived snapshots. It does not
   * change unlock/progress semantics: aggregators only populate numeric snapshot
   * metrics that `metric`/`threshold`, `check`, and `progress` already read.
   */
  source?: AchievementSource;
  /** Custom unlock predicate — overrides metric/threshold when present. */
  check?: (snapshot: AchievementSnapshot) => boolean;
  /** Custom progress — overrides the metric-derived bar; `null` = no bar. */
  progress?: (snapshot: AchievementSnapshot) => AchievementProgress | null;
}

export function resolveAchievementText(
  key: string | undefined,
  fallback: string,
  params: AchievementTextParams | undefined,
  opts: AchievementTextOptions | undefined,
): string {
  if (!key || !opts?.resolveText) return fallback;
  return opts.resolveText(key, fallback, params);
}

export function renderAchievementTitle(
  def: AchievementDefinition,
  opts?: AchievementTextOptions,
): string {
  return resolveAchievementText(def.titleKey, def.title, def.titleParams, opts);
}

export function renderAchievementDescription(
  def: AchievementDefinition,
  opts?: AchievementTextOptions,
): string {
  return resolveAchievementText(def.descKey, def.description, def.descParams, opts);
}

export function renderAchievementSecretTitle(opts?: AchievementTextOptions): string {
  return resolveAchievementText(
    opts?.secretTitleKey ?? ACHIEVEMENT_SECRET_TITLE_KEY,
    opts?.secretTitle ?? ACHIEVEMENT_SECRET_TITLE_KEY,
    undefined,
    opts,
  );
}

export function renderAchievementSecretDescription(opts?: AchievementTextOptions): string {
  return resolveAchievementText(
    opts?.secretDescriptionKey ?? ACHIEVEMENT_SECRET_DESCRIPTION_KEY,
    opts?.secretDescription ?? ACHIEVEMENT_SECRET_DESCRIPTION_KEY,
    undefined,
    opts,
  );
}

export function renderAchievementNotificationTitle(
  def: AchievementDefinition,
  opts?: AchievementTextOptions,
): string {
  const title = renderAchievementTitle(def, opts);
  return resolveAchievementText(
    opts?.notificationTitleKey ?? ACHIEVEMENT_NOTIFICATION_TITLE_KEY,
    opts?.notificationTitle ?? title,
    { ...opts?.notificationTitleParams, title },
    opts,
  );
}

export interface SnapshotAchievementDefinition extends AchievementDefinition {
  source?: undefined;
}

export interface EventDerivedAchievementDefinition extends AchievementDefinition {
  source: AchievementSource;
}

export interface AchievementsRegistry {
  /** All definitions, in registration order. */
  list(): AchievementDefinition[];
  get(id: string): AchievementDefinition | null;
  /** Distinct metric names referenced by defs and source aggregators. */
  metricsUsed(): string[];
  /** Definitions with at least one source aggregator for each event type. */
  rulesByEventType(): Map<string, AchievementDefinition[]>;
  /**
   * Definitions with an unlock predicate but NO source aggregator — their
   * satisfaction is read purely from the snapshot (e.g. the time-derived
   * `account.ageDays`), never folded from an event. Because they bind no event
   * type, `rulesByEventType()` can never surface them, so the event-driven
   * write path must evaluate them separately; otherwise they only ever unlock
   * on a full read-path reconcile and never fire a notification (ACHIEVE-5).
   */
  snapshotDerivedDefs(): AchievementDefinition[];
  /** Flattened source aggregators, in definition/source order. */
  aggregators(): AggregatorSpec[];
}

/** Whether a definition can ever unlock (custom check, or a metric threshold). */
function hasUnlockPredicate(def: AchievementDefinition): boolean {
  return def.check != null || (def.metric != null && def.threshold != null);
}

function metricValue(snapshot: AchievementSnapshot, metric: string): number {
  return snapshot[metric] ?? 0;
}

/** Whether a definition is satisfied by a snapshot (custom check wins). */
export function isUnlocked(def: AchievementDefinition, snapshot: AchievementSnapshot): boolean {
  if (def.check) return def.check(snapshot);
  if (def.metric != null && def.threshold != null) {
    return metricValue(snapshot, def.metric) >= def.threshold;
  }
  return false;
}

/** A definition's progress toward unlock (custom progress wins); `null` = no bar. */
export function progressFor(
  def: AchievementDefinition,
  snapshot: AchievementSnapshot,
): AchievementProgress | null {
  if (def.progress) return def.progress(snapshot);
  if (def.metric != null && def.threshold != null) {
    return {
      current: Math.min(metricValue(snapshot, def.metric), def.threshold),
      target: def.threshold,
    };
  }
  return null;
}

function sourcesFor(def: AchievementDefinition): AggregatorSpec[] {
  const source = def.source;
  if (source == null) return [];
  return Array.isArray(source) ? [...source] : [source as AggregatorSpec];
}

function validateSource(def: AchievementDefinition, source: AggregatorSpec): void {
  if (source.metric.trim().length === 0) {
    throw new Error(`Achievement ${def.id} has a source with an empty metric`);
  }
  if (source.event.trim().length === 0) {
    throw new Error(`Achievement ${def.id} has a source with an empty event type`);
  }
  if (source.metricKeyField != null && source.metricKeyField.trim().length === 0) {
    throw new Error(`Achievement ${def.id} has a source with an empty metric key field`);
  }
}

export function createAchievementsRegistry(defs: AchievementDefinition[]): AchievementsRegistry {
  const byId = new Map<string, AchievementDefinition>();
  const aggregators: AggregatorSpec[] = [];
  const defsByEventType = new Map<string, AchievementDefinition[]>();
  const snapshotDerived: AchievementDefinition[] = [];

  for (const def of defs) {
    // Two defs sharing an id would clobber each other's unlock rows — fail loud.
    if (byId.has(def.id)) throw new Error(`Duplicate achievement id: ${def.id}`);
    byId.set(def.id, def);

    const sources = sourcesFor(def);
    for (const source of sources) {
      validateSource(def, source);
      aggregators.push(source);

      const eventDefs = defsByEventType.get(source.event);
      if (eventDefs) {
        if (!eventDefs.includes(def)) eventDefs.push(def);
      } else {
        defsByEventType.set(source.event, [def]);
      }
    }

    // A def with a predicate but no source aggregator reads solely from the
    // snapshot (time-derived metrics, custom checks over derived values), so it
    // binds no event type and rulesByEventType() can never surface it (ACHIEVE-5).
    if (sources.length === 0 && hasUnlockPredicate(def)) {
      snapshotDerived.push(def);
    }
  }

  return {
    list: () => [...byId.values()],
    get: (id) => byId.get(id) ?? null,
    metricsUsed: () => [
      ...new Set(
        defs.flatMap((d) => [
          ...(d.metric ? [d.metric] : []),
          ...sourcesFor(d).map((s) => s.metric),
        ]),
      ),
    ],
    rulesByEventType: () =>
      new Map([...defsByEventType].map(([event, eventDefs]) => [event, [...eventDefs]])),
    snapshotDerivedDefs: () => [...snapshotDerived],
    aggregators: () => [...aggregators],
  };
}
