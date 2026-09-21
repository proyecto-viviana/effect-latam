/**
 * I01 pure engine — Effect.gen playground.
 * Deterministic: no Date.now, no Math.random, no React.
 *
 * Describe mode never calls Effect.run*.
 * Run mode uses Effect.runSyncExit on fixed presets.
 */

import { Data, Effect, Exit, Option } from "effect";

export type PresetId = "hello-success" | "two-steps" | "fail-short-circuit";

export const PRESET_IDS: readonly PresetId[] = [
  "hello-success",
  "two-steps",
  "fail-short-circuit",
] as const;

export type StructuralStep = {
  id: string;
  label: string;
};

export type DescribeResult = {
  mode: "describe";
  presetId: PresetId;
  steps: readonly StructuralStep[];
  /** Always false for describe — for tests asserting no execution path. */
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
      presetId: PresetId;
      ok: true;
      value: string;
      trace: readonly TraceEvent[];
      executed: true;
    }
  | {
      mode: "run";
      presetId: PresetId;
      ok: false;
      errorTag: string;
      errorMessage: string;
      trace: readonly TraceEvent[];
      executed: true;
    };

class DemoError extends Data.TaggedError("DemoError")<{
  message: string;
}> {}

/** Structural definitions — source of truth for Describe (not Effect internals). */
const PRESET_STEPS: Record<PresetId, readonly StructuralStep[]> = {
  "hello-success": [{ id: "s1", label: 'yield* Effect.succeed("hola effect latam")' }],
  "two-steps": [
    { id: "s1", label: 'yield* Effect.succeed("a")' },
    { id: "s2", label: 'yield* Effect.succeed("b")' },
    { id: "s3", label: 'return a + ":" + b' },
  ],
  "fail-short-circuit": [
    { id: "s1", label: 'yield* Effect.succeed("step-1")' },
    { id: "s2", label: "yield* new DemoError(…)" },
    { id: "s3", label: 'yield* Effect.succeed("step-3-never")' },
  ],
};

export function describePreset(presetId: PresetId): DescribeResult {
  return {
    mode: "describe",
    presetId,
    steps: PRESET_STEPS[presetId],
    executed: false,
  };
}

function buildProgram(presetId: PresetId): {
  effect: Effect.Effect<string, DemoError>;
  /** Called as the program progresses — pure callback for trace. */
  onStep: (e: TraceEvent) => void;
  getTrace: () => TraceEvent[];
} {
  const trace: TraceEvent[] = [];
  const onStep = (e: TraceEvent) => {
    trace.push(e);
  };

  if (presetId === "hello-success") {
    const effect = Effect.gen(function* () {
      const v = yield* Effect.succeed("hola effect latam");
      onStep({ stepId: "s1", status: "ok", detail: v });
      return v;
    });
    return { effect, onStep, getTrace: () => trace };
  }

  if (presetId === "two-steps") {
    const effect = Effect.gen(function* () {
      const a = yield* Effect.succeed("a");
      onStep({ stepId: "s1", status: "ok", detail: a });
      const b = yield* Effect.succeed("b");
      onStep({ stepId: "s2", status: "ok", detail: b });
      const out = `${a}:${b}`;
      onStep({ stepId: "s3", status: "ok", detail: out });
      return out;
    });
    return { effect, onStep, getTrace: () => trace };
  }

  // fail-short-circuit
  const effect = Effect.gen(function* () {
    const a = yield* Effect.succeed("step-1");
    onStep({ stepId: "s1", status: "ok", detail: a });
    yield* new DemoError({ message: "boom at step 2" });
    // unreachable
    const c = yield* Effect.succeed("step-3-never");
    onStep({ stepId: "s3", status: "ok", detail: c });
    return c;
  });
  return { effect, onStep, getTrace: () => trace };
}

export function runPreset(presetId: PresetId): RunResult {
  const { effect, getTrace } = buildProgram(presetId);
  const exit = Effect.runSyncExit(effect);

  if (Exit.isSuccess(exit)) {
    return {
      mode: "run",
      presetId,
      ok: true,
      value: exit.value,
      trace: getTrace(),
      executed: true,
    };
  }

  // Failure path — read the typed error out of the Cause, then mark the rest skipped
  const error = Exit.findErrorOption(exit);
  const errorTag = Option.isSome(error) ? error.value._tag : "Defect";
  const errorMessage = Option.isSome(error) ? error.value.message : String(exit.cause);

  const baseTrace = [...getTrace()];
  const structural = PRESET_STEPS[presetId];
  const failedStepId =
    structural.find((step) => !baseTrace.some((t) => t.stepId === step.id))?.id ?? "s?";
  baseTrace.push({
    stepId: failedStepId,
    status: "fail",
    detail: `${errorTag}: ${errorMessage}`,
  });

  const seen = new Set(baseTrace.map((t) => t.stepId));
  for (const step of structural) {
    if (!seen.has(step.id)) {
      baseTrace.push({
        stepId: step.id,
        status: "skipped",
        detail: "short-circuit — not reached",
      });
      seen.add(step.id);
    }
  }

  return {
    mode: "run",
    presetId,
    ok: false,
    errorTag,
    errorMessage,
    trace: baseTrace,
    executed: true,
  };
}

export function presetLabel(id: PresetId): string {
  switch (id) {
    case "hello-success":
      return "hello-success";
    case "two-steps":
      return "two-steps";
    case "fail-short-circuit":
      return "fail-short-circuit";
  }
}
