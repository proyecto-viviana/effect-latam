/**
 * I05 pure engine — Schedule + retry (deterministic counts, no wall-clock backoff).
 * Effect.retry + Schedule.recurs. describe never runs.
 */

import { Data, Effect, Exit, Option, Schedule } from "effect";

export type SchedulePresetId = "succeed-first" | "retry-then-ok" | "retry-exhausted";

export const SCHEDULE_PRESET_IDS: readonly SchedulePresetId[] = [
  "succeed-first",
  "retry-then-ok",
  "retry-exhausted",
] as const;

export type StructuralStep = { id: string; label: string };

export type DescribeResult = {
  mode: "describe";
  presetId: SchedulePresetId;
  steps: readonly StructuralStep[];
  executed: false;
};

export type TraceEvent = {
  stepId: string;
  status: "ok" | "fail" | "skipped";
  detail: string;
};

export type RunResult =
  | {
      mode: "run";
      presetId: SchedulePresetId;
      ok: true;
      value: string;
      attempts: number;
      trace: readonly TraceEvent[];
      executed: true;
    }
  | {
      mode: "run";
      presetId: SchedulePresetId;
      ok: false;
      /** Tag of the last error; retry hands it back unchanged once the budget is spent. */
      errorKind: string;
      errorMessage: string;
      attempts: number;
      trace: readonly TraceEvent[];
      executed: true;
    };

const PRESET_STEPS: Record<SchedulePresetId, readonly StructuralStep[]> = {
  "succeed-first": [
    { id: "s1", label: "program succeeds on attempt 1" },
    { id: "s2", label: "Effect.retry(…, Schedule.recurs(3)) unused" },
  ],
  "retry-then-ok": [
    { id: "s1", label: "fail on attempts 1–2, succeed on 3" },
    { id: "s2", label: "Schedule.recurs(5) allows retries" },
    { id: "s3", label: "value: recovered-ok" },
  ],
  "retry-exhausted": [
    { id: "s1", label: "always fail(new ServiceDown(…))" },
    { id: "s2", label: "Schedule.recurs(2) → 3 total attempts" },
    { id: "s3", label: "the last ServiceDown comes back in the error channel" },
  ],
};

export function describeSchedulePreset(presetId: SchedulePresetId): DescribeResult {
  return {
    mode: "describe",
    presetId,
    steps: PRESET_STEPS[presetId],
    executed: false,
  };
}

class ServiceDown extends Data.TaggedError("ServiceDown")<{
  message: string;
}> {}

function flakyProgram(failUntilAttempt: number, successValue: string) {
  let attempt = 0;
  return {
    getAttempts: () => attempt,
    effect: Effect.suspend(() => {
      attempt += 1;
      if (attempt < failUntilAttempt) {
        return Effect.fail(new ServiceDown({ message: `attempt-${attempt}` }));
      }
      return Effect.succeed(successValue);
    }),
  };
}

export async function runSchedulePreset(presetId: SchedulePresetId): Promise<RunResult> {
  const trace: TraceEvent[] = [];

  if (presetId === "succeed-first") {
    const { effect, getAttempts } = flakyProgram(1, "ok-first");
    const value = await Effect.runPromise(Effect.retry(effect, Schedule.recurs(3)));
    const attempts = getAttempts();
    trace.push({ stepId: "s1", status: "ok", detail: `attempt=${attempts}` });
    trace.push({
      stepId: "s2",
      status: "ok",
      detail: "no retries needed",
    });
    return {
      mode: "run",
      presetId,
      ok: true,
      value,
      attempts,
      trace,
      executed: true,
    };
  }

  if (presetId === "retry-then-ok") {
    const { effect, getAttempts } = flakyProgram(3, "recovered-ok");
    const value = await Effect.runPromise(Effect.retry(effect, Schedule.recurs(5)));
    const attempts = getAttempts();
    trace.push({
      stepId: "s1",
      status: "ok",
      detail: `failed then ok; attempts=${attempts}`,
    });
    trace.push({ stepId: "s2", status: "ok", detail: "Schedule.recurs(5)" });
    trace.push({ stepId: "s3", status: "ok", detail: value });
    return {
      mode: "run",
      presetId,
      ok: true,
      value,
      attempts,
      trace,
      executed: true,
    };
  }

  // retry-exhausted: always fail, recurs(2) → initial + 2 retries = 3 attempts
  {
    let attempts = 0;
    const alwaysFail = Effect.suspend(() => {
      attempts += 1;
      return Effect.fail(new ServiceDown({ message: "still-broken" }));
    });
    const exit = await Effect.runPromiseExit(Effect.retry(alwaysFail, Schedule.recurs(2)));
    if (Exit.isSuccess(exit)) {
      return {
        mode: "run",
        presetId,
        ok: true,
        value: exit.value,
        attempts,
        trace,
        executed: true,
      };
    }
    const error = Exit.findErrorOption(exit);
    const errorKind = Option.isSome(error) ? error.value._tag : "Defect";
    const msg = Option.isSome(error) ? error.value.message : String(exit.cause);
    trace.push({
      stepId: "s1",
      status: "fail",
      detail: `always fail; attempts=${attempts}`,
    });
    trace.push({
      stepId: "s2",
      status: "ok",
      detail: "Schedule.recurs(2) budget spent",
    });
    trace.push({ stepId: "s3", status: "fail", detail: `${errorKind}: ${msg}` });
    return {
      mode: "run",
      presetId,
      ok: false,
      errorKind,
      errorMessage: msg,
      attempts,
      trace,
      executed: true,
    };
  }
}

export function schedulePresetLabel(id: SchedulePresetId): string {
  return id;
}
