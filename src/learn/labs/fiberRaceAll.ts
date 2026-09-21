/**
 * I04 pure engine — structured concurrency: Effect.all / Effect.race.
 * Deterministic presets; describe never runs.
 * race-fast-wins uses a short delay (async); others are sync under runPromise.
 */

import { Data, Effect, Exit, Option } from "effect";

export type FiberPresetId = "all-success" | "all-one-fails" | "race-left" | "race-fast-wins";

export const FIBER_PRESET_IDS: readonly FiberPresetId[] = [
  "all-success",
  "all-one-fails",
  "race-left",
  "race-fast-wins",
] as const;

export type StructuralStep = { id: string; label: string };

export type DescribeResult = {
  mode: "describe";
  presetId: FiberPresetId;
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
      presetId: FiberPresetId;
      ok: true;
      value: string;
      combinator: "all" | "race";
      trace: readonly TraceEvent[];
      executed: true;
    }
  | {
      mode: "run";
      presetId: FiberPresetId;
      ok: false;
      errorKind: "FiberFail";
      errorMessage: string;
      combinator: "all" | "race";
      trace: readonly TraceEvent[];
      executed: true;
    };

class BranchFailed extends Data.TaggedError("BranchFailed")<{
  message: string;
}> {}

const PRESET_STEPS: Record<FiberPresetId, readonly StructuralStep[]> = {
  "all-success": [
    { id: "s1", label: 'fiber A: succeed("alpha")' },
    { id: "s2", label: 'fiber B: succeed("beta")' },
    { id: "s3", label: 'Effect.all([A, B], { concurrency: "unbounded" }) → ["alpha","beta"]' },
  ],
  "all-one-fails": [
    { id: "s1", label: 'fiber A: succeed("alpha")' },
    { id: "s2", label: "fiber B: fail(new BranchFailed(…))" },
    { id: "s3", label: "Effect.all fails; the other fibers are interrupted" },
  ],
  "race-left": [
    { id: "s1", label: 'left: succeed("left")' },
    { id: "s2", label: 'right: succeed("right")' },
    { id: "s3", label: "Effect.race → first success wins (left when both ready)" },
  ],
  "race-fast-wins": [
    { id: "s1", label: 'slow: delay(succeed("slow"), 40ms)' },
    { id: "s2", label: 'fast: succeed("fast")' },
    { id: "s3", label: 'Effect.race → "fast" wins; slow is interrupted' },
  ],
};

export function describeFiberPreset(presetId: FiberPresetId): DescribeResult {
  return {
    mode: "describe",
    presetId,
    steps: PRESET_STEPS[presetId],
    executed: false,
  };
}

export async function runFiberPreset(presetId: FiberPresetId): Promise<RunResult> {
  const trace: TraceEvent[] = [];
  /** A branch that records itself in the trace when it actually completes. */
  const branch = (stepId: string, value: string) =>
    Effect.sync(() => {
      trace.push({ stepId, status: "ok", detail: `${value} done` });
      return value;
    });

  if (presetId === "all-success" || presetId === "all-one-fails") {
    const second =
      presetId === "all-success"
        ? branch("s2", "beta")
        : Effect.fail(new BranchFailed({ message: "fiber-b-fail" }));
    const exit = await Effect.runPromiseExit(
      Effect.all([branch("s1", "alpha"), second], { concurrency: "unbounded" }),
    );
    if (Exit.isSuccess(exit)) {
      const joined = JSON.stringify(exit.value);
      trace.push({ stepId: "s3", status: "ok", detail: joined });
      return {
        mode: "run",
        presetId,
        ok: true,
        value: joined,
        combinator: "all",
        trace,
        executed: true,
      };
    }
    const error = Exit.findErrorOption(exit);
    const msg = Option.isSome(error) ? error.value.message : String(exit.cause);
    trace.push({ stepId: "s2", status: "fail", detail: msg });
    trace.push({
      stepId: "s3",
      status: "skipped",
      detail: "all fails as soon as one branch fails",
    });
    return {
      mode: "run",
      presetId,
      ok: false,
      errorKind: "FiberFail",
      errorMessage: msg,
      combinator: "all",
      trace,
      executed: true,
    };
  }

  const [first, second] =
    presetId === "race-left"
      ? [branch("s1", "left"), branch("s2", "right")]
      : [
          Effect.delay(branch("s1", "slow"), "40 millis").pipe(
            Effect.onInterrupt(() =>
              Effect.sync(() => {
                trace.push({ stepId: "s1", status: "skipped", detail: "slow interrupted" });
              }),
            ),
          ),
          branch("s2", "fast"),
        ];
  const value = await Effect.runPromise(Effect.race(first, second));
  trace.push({ stepId: "s3", status: "ok", detail: `winner=${value}` });
  return {
    mode: "run",
    presetId,
    ok: true,
    value,
    combinator: "race",
    trace,
    executed: true,
  };
}

export function fiberPresetLabel(id: FiberPresetId): string {
  return id;
}
