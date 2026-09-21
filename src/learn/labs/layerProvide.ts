/**
 * I03 pure engine — requirements / Layers (provide vs missing).
 * Effect v4: Context.Service + Layer.succeed + Effect.provide
 * Deterministic; describe never runs.
 */

import { Cause, Context, Effect, Exit, Layer } from "effect";

export type LayerPresetId = "missing-service" | "provide-live" | "provide-mock";

export const LAYER_PRESET_IDS: readonly LayerPresetId[] = [
  "missing-service",
  "provide-live",
  "provide-mock",
] as const;

export type StructuralStep = { id: string; label: string };

export type DescribeResult = {
  mode: "describe";
  presetId: LayerPresetId;
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
      presetId: LayerPresetId;
      ok: true;
      value: string;
      provided: boolean;
      trace: readonly TraceEvent[];
      executed: true;
    }
  | {
      mode: "run";
      presetId: LayerPresetId;
      ok: false;
      errorKind: "MissingService";
      errorMessage: string;
      provided: false;
      trace: readonly TraceEvent[];
      executed: true;
    };

/** Shared service key for all presets (stable teaching handle). */
export class Greeter extends Context.Service<Greeter, { readonly say: (name: string) => string }>()(
  "Greeter",
) {}

const PRESET_STEPS: Record<LayerPresetId, readonly StructuralStep[]> = {
  "missing-service": [
    { id: "s1", label: 'program: yield* Greeter; return greeter.say("latam")' },
    {
      id: "s2",
      label: "no Effect.provide — TypeScript rejects run*; forced past it, the runtime fails",
    },
  ],
  "provide-live": [
    { id: "s1", label: "Layer.succeed(Greeter, live impl)" },
    { id: "s2", label: "Effect.provide(program, Live)" },
    { id: "s3", label: 'run → "hola latam"' },
  ],
  "provide-mock": [
    { id: "s1", label: "Layer.succeed(Greeter, mock impl)" },
    { id: "s2", label: "Effect.provide(program, Mock)" },
    { id: "s3", label: 'run → "mock:latam"' },
  ],
};

const program = Effect.gen(function* () {
  const g = yield* Greeter;
  return g.say("latam");
});

const Live = Layer.succeed(Greeter, {
  say: (name: string) => `hola ${name}`,
});

const Mock = Layer.succeed(Greeter, {
  say: (name: string) => `mock:${name}`,
});

export function describeLayerPreset(presetId: LayerPresetId): DescribeResult {
  return {
    mode: "describe",
    presetId,
    steps: PRESET_STEPS[presetId],
    executed: false,
  };
}

export function runLayerPreset(presetId: LayerPresetId): RunResult {
  const trace: TraceEvent[] = [];

  if (presetId === "missing-service") {
    trace.push({
      stepId: "s1",
      status: "ok",
      detail: "program requires Greeter",
    });
    // `Effect.runSync(program)` does not compile: Greeter is still in the
    // requirements. The cast forces it through to show what the types prevent.
    const exit = Effect.runSyncExit(program as Effect.Effect<string, never, never>);
    if (Exit.isSuccess(exit)) {
      return {
        mode: "run",
        presetId,
        ok: true,
        value: exit.value,
        provided: false,
        trace,
        executed: true,
      };
    }
    const msg = Cause.pretty(exit.cause).split("\n")[0] ?? "";
    trace.push({ stepId: "s2", status: "fail", detail: msg });
    return {
      mode: "run",
      presetId,
      ok: false,
      errorKind: "MissingService",
      errorMessage: msg,
      provided: false,
      trace,
      executed: true,
    };
  }

  if (presetId === "provide-live") {
    trace.push({ stepId: "s1", status: "ok", detail: "Live layer built" });
    trace.push({ stepId: "s2", status: "ok", detail: "program provided Live" });
    const value = Effect.runSync(Effect.provide(program, Live));
    trace.push({ stepId: "s3", status: "ok", detail: value });
    return {
      mode: "run",
      presetId,
      ok: true,
      value,
      provided: true,
      trace,
      executed: true,
    };
  }

  // provide-mock
  trace.push({ stepId: "s1", status: "ok", detail: "Mock layer built" });
  trace.push({ stepId: "s2", status: "ok", detail: "program provided Mock" });
  const value = Effect.runSync(Effect.provide(program, Mock));
  trace.push({ stepId: "s3", status: "ok", detail: value });
  return {
    mode: "run",
    presetId,
    ok: true,
    value,
    provided: true,
    trace,
    executed: true,
  };
}

export function layerPresetLabel(id: LayerPresetId): string {
  return id;
}
