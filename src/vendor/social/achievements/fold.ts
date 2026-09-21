import type { AchievementEvent, AchievementSnapshot, AggregatorSpec } from "./registry";

export interface RunFoldState {
  current: number;
  longest: number;
}

export interface AchievementFoldState {
  distinctValues: Record<string, string[]>;
  runs: Record<string, RunFoldState>;
}

export interface FoldResult {
  snapshot: AchievementSnapshot;
  state: AchievementFoldState;
  lastSeq: number;
}

interface MutableFoldState {
  distinctValues: Map<string, Set<string>>;
  runs: Map<string, RunFoldState>;
}

export interface FoldOptions {
  initialSnapshot?: AchievementSnapshot;
  initialState?: AchievementFoldState;
}

/** Fold events into a numeric achievement snapshot. Input order is not trusted. */
export function fold(
  events: readonly AchievementEvent[],
  aggregators: readonly AggregatorSpec[],
  opts: FoldOptions = {},
): AchievementSnapshot {
  return foldWithState(events, aggregators, opts).snapshot;
}

/**
 * Fold events and expose the serializable working state needed by projection
 * rebuilds. Incremental projection updates are intentionally left to T13.
 */
export function foldWithState(
  events: readonly AchievementEvent[],
  aggregators: readonly AggregatorSpec[],
  opts: FoldOptions = {},
): FoldResult {
  const snapshot: AchievementSnapshot = { ...opts.initialSnapshot };
  const state = mutableState(opts.initialState);
  const unique = uniqueAggregators(aggregators);
  const ordered = [...events].sort(compareEvents);

  for (const event of ordered) {
    for (const aggregator of unique) {
      if (aggregator.event !== event.type) continue;
      applyAggregator(snapshot, state, event, aggregator);
    }
  }

  return {
    snapshot,
    state: serializeState(state),
    lastSeq: ordered.reduce((max, event) => Math.max(max, event.seq ?? 0), 0),
  };
}

function compareEvents(a: AchievementEvent, b: AchievementEvent): number {
  const byTs = a.ts.getTime() - b.ts.getTime();
  if (byTs !== 0) return byTs;

  const bySeq = (a.seq ?? 0) - (b.seq ?? 0);
  if (bySeq !== 0) return bySeq;

  return a.id.localeCompare(b.id);
}

function applyAggregator(
  snapshot: AchievementSnapshot,
  state: MutableFoldState,
  event: AchievementEvent,
  aggregator: AggregatorSpec,
): void {
  const metric = metricKey(event, aggregator);
  if (metric == null) return;

  switch (aggregator.agg) {
    case "count": {
      if (!matchesNonRunAggregator(event, aggregator)) return;
      // A compensating source (e.g. `forum.post.deleted` with delta -1) re-folds
      // the metric after deletion; clamp at 0 so an orphan reversal can't go negative.
      const delta = aggregator.delta ?? 1;
      snapshot[metric] = Math.max(0, (snapshot[metric] ?? 0) + delta);
      return;
    }
    case "sum": {
      if (!matchesNonRunAggregator(event, aggregator)) return;
      const value = numericPayloadValue(event, aggregator.field);
      if (value == null) return;
      snapshot[metric] = (snapshot[metric] ?? 0) + value;
      return;
    }
    case "max": {
      if (!matchesNonRunAggregator(event, aggregator)) return;
      const value = numericPayloadValue(event, aggregator.field);
      if (value == null) return;
      snapshot[metric] = hasMetric(snapshot, metric)
        ? Math.max(snapshot[metric] ?? 0, value)
        : value;
      return;
    }
    case "distinct": {
      if (!matchesNonRunAggregator(event, aggregator)) return;
      const value = distinctPayloadValue(event, aggregator.field);
      if (value == null) return;

      const key = aggregatorStateKey(aggregator, metric);
      const values = state.distinctValues.get(key) ?? new Set<string>();
      if (!values.has(value)) {
        values.add(value);
        snapshot[metric] = (snapshot[metric] ?? 0) + 1;
      }
      state.distinctValues.set(key, values);
      return;
    }
    case "currentStreak":
    case "longestRun": {
      const key = aggregatorStateKey(aggregator, metric);
      const run = state.runs.get(key) ?? initialRunState(snapshot, metric, aggregator.agg);
      const matches = aggregator.when ? aggregator.when(event) : true;

      if (matches) {
        run.current += 1;
        run.longest = Math.max(run.longest, run.current);
      } else {
        run.current = 0;
      }

      snapshot[metric] = aggregator.agg === "currentStreak" ? run.current : run.longest;
      state.runs.set(key, run);
      return;
    }
    case "lastTs": {
      if (!matchesNonRunAggregator(event, aggregator)) return;
      const timestamp = event.ts.getTime();
      if (Number.isFinite(timestamp)) snapshot[metric] = timestamp;
      return;
    }
  }
}

function matchesNonRunAggregator(event: AchievementEvent, aggregator: AggregatorSpec): boolean {
  if (aggregator.agg === "currentStreak" || aggregator.agg === "longestRun") return true;
  return aggregator.when ? aggregator.when(event) : true;
}

function metricKey(event: AchievementEvent, aggregator: AggregatorSpec): string | null {
  if (aggregator.metricKeyField == null) return aggregator.metric;

  const value = metricKeyValue(event.payload[aggregator.metricKeyField]);
  return value == null ? null : `${aggregator.metric}.${value}`;
}

function metricKeyValue(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  return null;
}

function numericPayloadValue(event: AchievementEvent, field: string): number | null {
  const value = event.payload[field];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function distinctPayloadValue(event: AchievementEvent, field: string): string | null {
  const value = event.payload[field];

  if (typeof value === "string") return `string:${value}`;
  if (typeof value === "number" && Number.isFinite(value)) return `number:${value}`;
  if (typeof value === "boolean") return `boolean:${value}`;

  return null;
}

function hasMetric(snapshot: AchievementSnapshot, metric: string): boolean {
  return Object.prototype.hasOwnProperty.call(snapshot, metric);
}

function initialRunState(
  snapshot: AchievementSnapshot,
  metric: string,
  agg: "currentStreak" | "longestRun",
): RunFoldState {
  const metricValue = snapshot[metric] ?? 0;
  const current = agg === "currentStreak" ? metricValue : 0;
  const longest = agg === "longestRun" ? metricValue : current;
  return { current, longest };
}

function mutableState(state: AchievementFoldState | undefined): MutableFoldState {
  return {
    distinctValues: new Map(
      Object.entries(state?.distinctValues ?? {}).map(([key, values]) => [key, new Set(values)]),
    ),
    runs: new Map(Object.entries(state?.runs ?? {}).map(([key, run]) => [key, { ...run }])),
  };
}

function serializeState(state: MutableFoldState): AchievementFoldState {
  return {
    distinctValues: Object.fromEntries(
      [...state.distinctValues]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, values]) => [key, [...values].sort()]),
    ),
    runs: Object.fromEntries(
      [...state.runs].sort(([a], [b]) => a.localeCompare(b)).map(([key, run]) => [key, { ...run }]),
    ),
  };
}

function uniqueAggregators(aggregators: readonly AggregatorSpec[]): AggregatorSpec[] {
  const seen = new Set<string>();
  const unique: AggregatorSpec[] = [];

  for (const aggregator of aggregators) {
    const key = aggregatorSpecKey(aggregator);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(aggregator);
  }

  return unique;
}

function aggregatorSpecKey(aggregator: AggregatorSpec): string {
  const base = `${aggregator.agg}:${aggregator.event}:${aggregator.metric}:${
    aggregator.metricKeyField ?? ""
  }:${aggregator.when ? aggregator.when.toString() : "always"}`;

  switch (aggregator.agg) {
    case "count":
    case "lastTs":
      return base;
    case "sum":
    case "max":
    case "distinct":
      return `${base}:${aggregator.field}`;
    case "currentStreak":
    case "longestRun":
      return base;
  }
}

function aggregatorStateKey(aggregator: AggregatorSpec, metric: string): string {
  return `${aggregatorSpecKey(aggregator)}:${metric}`;
}
