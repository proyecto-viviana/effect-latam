/**
 * I07 pure engine — Scope / finalizers (acquire · use · release).
 * Effect.scoped + Effect.acquireRelease. describe never runs.
 */

import { Data, Effect, Exit, Option } from "effect";

export type ScopePresetId = "success-release" | "fail-still-releases" | "nested-order";

export const SCOPE_PRESET_IDS: readonly ScopePresetId[] = [
  "success-release",
  "fail-still-releases",
  "nested-order",
] as const;

export type StructuralStep = { id: string; label: string };

export type DescribeResult = {
  mode: "describe";
  presetId: ScopePresetId;
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
      presetId: ScopePresetId;
      ok: true;
      value: string;
      lifecycle: readonly string[];
      trace: readonly TraceEvent[];
      executed: true;
    }
  | {
      mode: "run";
      presetId: ScopePresetId;
      ok: false;
      errorKind: "ScopeFail";
      errorMessage: string;
      lifecycle: readonly string[];
      trace: readonly TraceEvent[];
      executed: true;
    };

class UseFailed extends Data.TaggedError("UseFailed")<{
  message: string;
}> {}

const PRESET_STEPS: Record<ScopePresetId, readonly StructuralStep[]> = {
  "success-release": [
    { id: "s1", label: "Effect.acquireRelease(acquire, release)" },
    { id: "s2", label: "use body succeeds" },
    { id: "s3", label: "scoped ends → finalizer runs" },
  ],
  "fail-still-releases": [
    { id: "s1", label: "Effect.acquireRelease(acquire, release)" },
    { id: "s2", label: "use body fails" },
    { id: "s3", label: "finalizer still runs on exit" },
  ],
  "nested-order": [
    { id: "s1", label: "outer resource acquired first" },
    { id: "s2", label: "inner resource acquired second" },
    { id: "s3", label: "release order: inner then outer (LIFO)" },
  ],
};

export function describeScopePreset(presetId: ScopePresetId): DescribeResult {
  return {
    mode: "describe",
    presetId,
    steps: PRESET_STEPS[presetId],
    executed: false,
  };
}

export async function runScopePreset(presetId: ScopePresetId): Promise<RunResult> {
  const lifecycle: string[] = [];
  const trace: TraceEvent[] = [];
  /** A resource whose acquire and release both leave a mark in the lifecycle. */
  const resource = (prefix: string) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        lifecycle.push(`${prefix}acquire`);
      }),
      () =>
        Effect.sync(() => {
          lifecycle.push(`${prefix}release`);
        }),
    );

  if (presetId === "success-release" || presetId === "fail-still-releases") {
    const program = Effect.gen(function* () {
      yield* resource("");
      lifecycle.push("use");
      if (presetId === "fail-still-releases") {
        return yield* new UseFailed({ message: "use-failed" });
      }
      return "resource-ok";
    });
    const exit = await Effect.runPromiseExit(Effect.scoped(program));
    trace.push({ stepId: "s1", status: "ok", detail: "acquired; release registered" });
    if (Exit.isSuccess(exit)) {
      trace.push({ stepId: "s2", status: "ok", detail: "use" });
      trace.push({ stepId: "s3", status: "ok", detail: `lifecycle=${lifecycle.join("→")}` });
      return {
        mode: "run",
        presetId,
        ok: true,
        value: exit.value,
        lifecycle: [...lifecycle],
        trace,
        executed: true,
      };
    }
    const error = Exit.findErrorOption(exit);
    const msg = Option.isSome(error) ? error.value.message : String(exit.cause);
    trace.push({ stepId: "s2", status: "fail", detail: msg });
    trace.push({ stepId: "s3", status: "ok", detail: `lifecycle=${lifecycle.join("→")}` });
    return {
      mode: "run",
      presetId,
      ok: false,
      errorKind: "ScopeFail",
      errorMessage: msg,
      lifecycle: [...lifecycle],
      trace,
      executed: true,
    };
  }

  // nested-order
  const program = Effect.gen(function* () {
    yield* resource("outer-");
    yield* resource("inner-");
    lifecycle.push("use");
    return "nested-ok";
  });
  const value = await Effect.runPromise(Effect.scoped(program));
  trace.push({ stepId: "s1", status: "ok", detail: "outer acquired" });
  trace.push({ stepId: "s2", status: "ok", detail: "inner acquired" });
  trace.push({ stepId: "s3", status: "ok", detail: `lifecycle=${lifecycle.join("→")}` });
  return {
    mode: "run",
    presetId,
    ok: true,
    value,
    lifecycle: [...lifecycle],
    trace,
    executed: true,
  };
}

export function scopePresetLabel(id: ScopePresetId): string {
  return id;
}
