/**
 * I02 pure engine — typed error channel.
 * Deterministic: no Date.now, no Math.random, no React.
 *
 * Describe = structural recipe only (never Effect.run*).
 * Run = Effect.runSyncExit with optional catchTag recovery.
 */

import { Data, Effect, Exit, Option } from "effect";

export type ErrorPresetId = "success-path" | "fail-no-catch" | "fail-catch-tag" | "fail-wrong-tag";

export const ERROR_PRESET_IDS: readonly ErrorPresetId[] = [
  "success-path",
  "fail-no-catch",
  "fail-catch-tag",
  "fail-wrong-tag",
] as const;

export type StructuralStep = {
  id: string;
  label: string;
};

export type DescribeResult = {
  mode: "describe";
  presetId: ErrorPresetId;
  steps: readonly StructuralStep[];
  executed: false;
};

export type TraceEvent = {
  stepId: string;
  status: "ok" | "fail" | "caught" | "skipped";
  detail: string;
};

export type RunResult =
  | {
      mode: "run";
      presetId: ErrorPresetId;
      ok: true;
      value: string;
      recovered: boolean;
      trace: readonly TraceEvent[];
      executed: true;
    }
  | {
      mode: "run";
      presetId: ErrorPresetId;
      ok: false;
      errorTag: string;
      errorMessage: string;
      recovered: false;
      trace: readonly TraceEvent[];
      executed: true;
    };

class NetworkError extends Data.TaggedError("NetworkError")<{
  message: string;
}> {}

class ParseError extends Data.TaggedError("ParseError")<{
  message: string;
}> {}

const PRESET_STEPS: Record<ErrorPresetId, readonly StructuralStep[]> = {
  "success-path": [
    { id: "s1", label: 'yield* Effect.succeed("payload")' },
    { id: "s2", label: "return payload" },
  ],
  "fail-no-catch": [
    { id: "s1", label: 'yield* Effect.succeed("before")' },
    { id: "s2", label: "yield* new NetworkError(…)" },
    { id: "s3", label: 'yield* Effect.succeed("after — never")' },
  ],
  "fail-catch-tag": [
    { id: "s1", label: "yield* new NetworkError(…)" },
    { id: "s2", label: 'Effect.catchTag("NetworkError", …) → succeed recovered' },
    { id: "s3", label: "return recovered value" },
  ],
  "fail-wrong-tag": [
    { id: "s1", label: "yield* new NetworkError(…)" },
    { id: "s2", label: 'Effect.catchTag("ParseError", …) — does not match' },
    { id: "s3", label: "NetworkError stays in the error channel" },
  ],
};

/** The typed failure inside an Exit, read from its Cause rather than assumed. */
function typedFailure<E extends { _tag: string; message: string }>(
  exit: Exit.Exit<unknown, E>,
): { errorTag: string; errorMessage: string } {
  const error = Exit.findErrorOption(exit);
  return Option.isSome(error)
    ? { errorTag: error.value._tag, errorMessage: error.value.message }
    : { errorTag: "Defect", errorMessage: String(Exit.isFailure(exit) ? exit.cause : "") };
}

export function describeErrorPreset(presetId: ErrorPresetId): DescribeResult {
  return {
    mode: "describe",
    presetId,
    steps: PRESET_STEPS[presetId],
    executed: false,
  };
}

function runSuccessPath(): RunResult {
  const trace: TraceEvent[] = [];
  const effect = Effect.gen(function* () {
    const payload = yield* Effect.succeed("payload");
    trace.push({ stepId: "s1", status: "ok", detail: payload });
    trace.push({ stepId: "s2", status: "ok", detail: payload });
    return payload;
  });
  const value = Effect.runSync(effect);
  return {
    mode: "run",
    presetId: "success-path",
    ok: true,
    value,
    recovered: false,
    trace,
    executed: true,
  };
}

function runFailNoCatch(): RunResult {
  const trace: TraceEvent[] = [];
  const effect = Effect.gen(function* () {
    const before = yield* Effect.succeed("before");
    trace.push({ stepId: "s1", status: "ok", detail: before });
    yield* new NetworkError({ message: "timeout" });
    const after = yield* Effect.succeed("after — never");
    trace.push({ stepId: "s3", status: "ok", detail: after });
    return after;
  });

  const exit = Effect.runSyncExit(effect);
  if (Exit.isSuccess(exit)) {
    return {
      mode: "run",
      presetId: "fail-no-catch",
      ok: true,
      value: exit.value,
      recovered: false,
      trace,
      executed: true,
    };
  }

  const failure = typedFailure(exit);
  trace.push({
    stepId: "s2",
    status: "fail",
    detail: `${failure.errorTag}: ${failure.errorMessage}`,
  });
  trace.push({
    stepId: "s3",
    status: "skipped",
    detail: "short-circuit — not reached",
  });

  return {
    mode: "run",
    presetId: "fail-no-catch",
    ok: false,
    ...failure,
    recovered: false,
    trace,
    executed: true,
  };
}

function runFailCatchTag(): RunResult {
  const trace: TraceEvent[] = [];
  const core = Effect.gen(function* () {
    return yield* new NetworkError({ message: "timeout" });
  });

  const effect = core.pipe(
    Effect.catchTag("NetworkError", (e) => {
      trace.push({
        stepId: "s1",
        status: "fail",
        detail: `NetworkError: ${e.message}`,
      });
      trace.push({
        stepId: "s2",
        status: "caught",
        detail: "catchTag NetworkError → recover",
      });
      return Effect.succeed(`recovered:${e.message}`);
    }),
  );

  const value = Effect.runSync(effect);
  trace.push({ stepId: "s3", status: "ok", detail: value });

  return {
    mode: "run",
    presetId: "fail-catch-tag",
    ok: true,
    value,
    recovered: true,
    trace,
    executed: true,
  };
}

export function runErrorPreset(presetId: ErrorPresetId): RunResult {
  switch (presetId) {
    case "success-path":
      return runSuccessPath();
    case "fail-no-catch":
      return runFailNoCatch();
    case "fail-catch-tag":
      return runFailCatchTag();
    case "fail-wrong-tag":
      return runWrongCatchTag();
  }
}

export function errorPresetLabel(id: ErrorPresetId): string {
  return id;
}

/**
 * Program whose error channel is NetworkError | ParseError, but only fails with NetworkError.
 * catchTag('ParseError') leaves NetworkError unhandled — teaching exact-tag recovery.
 */
export function runWrongCatchTag(): RunResult {
  const trace: TraceEvent[] = [];
  const core: Effect.Effect<string, NetworkError | ParseError> = Effect.gen(function* () {
    return yield* new NetworkError({ message: "timeout" });
  });

  const effect = core.pipe(
    Effect.catchTag("ParseError", () => {
      trace.push({ stepId: "s2", status: "caught", detail: "wrong tag" });
      return Effect.succeed("should-not");
    }),
  );

  const exit = Effect.runSyncExit(effect);
  if (Exit.isSuccess(exit)) {
    return {
      mode: "run",
      presetId: "fail-wrong-tag",
      ok: true,
      value: exit.value,
      recovered: true,
      trace,
      executed: true,
    };
  }
  const failure = typedFailure(exit);
  trace.push({
    stepId: "s1",
    status: "fail",
    detail: `${failure.errorTag}: ${failure.errorMessage}`,
  });
  trace.push({ stepId: "s2", status: "skipped", detail: "catchTag ParseError did not match" });
  trace.push({
    stepId: "s3",
    status: "fail",
    detail: `${failure.errorTag} still unhandled`,
  });
  return {
    mode: "run",
    presetId: "fail-wrong-tag",
    ok: false,
    ...failure,
    recovered: false,
    trace,
    executed: true,
  };
}
