/**
 * I06 pure engine — Schema decode/encode as data.
 * Schema.Struct + decodeUnknownExit / encodeSync. describe never runs.
 */

import { Exit, Option, Schema } from "effect";

export type SchemaPresetId = "decode-ok" | "decode-fail" | "encode-ok";

export const SCHEMA_PRESET_IDS: readonly SchemaPresetId[] = [
  "decode-ok",
  "decode-fail",
  "encode-ok",
] as const;

export type StructuralStep = { id: string; label: string };

export type DescribeResult = {
  mode: "describe";
  presetId: SchemaPresetId;
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
      presetId: SchemaPresetId;
      ok: true;
      value: string;
      direction: "decode" | "encode";
      trace: readonly TraceEvent[];
      executed: true;
    }
  | {
      mode: "run";
      presetId: SchemaPresetId;
      ok: false;
      errorKind: "SchemaError";
      errorMessage: string;
      direction: "decode" | "encode";
      trace: readonly TraceEvent[];
      executed: true;
    };

/**
 * Teaching schema: person with name + age. The wire carries age as text, so
 * decode and encode visibly differ.
 */
export const Person = Schema.Struct({
  name: Schema.String,
  age: Schema.FiniteFromString,
});

const PRESET_STEPS: Record<SchemaPresetId, readonly StructuralStep[]> = {
  "decode-ok": [
    { id: "s1", label: 'input: { name: "ana", age: "30" }' },
    { id: "s2", label: "Schema.decodeUnknownExit(Person)" },
    { id: "s3", label: "value as typed Person" },
  ],
  "decode-fail": [
    { id: "s1", label: 'input: { name: "ana", age: "treinta" }' },
    { id: "s2", label: "decode fails — age is not a finite number" },
    { id: "s3", label: "failure is data (SchemaError in the Exit), nothing is thrown" },
  ],
  "encode-ok": [
    { id: "s1", label: 'value: { name: "ana", age: 30 }' },
    { id: "s2", label: "Schema.encodeSync(Person)" },
    { id: "s3", label: "encoded wire shape" },
  ],
};

export function describeSchemaPreset(presetId: SchemaPresetId): DescribeResult {
  return {
    mode: "describe",
    presetId,
    steps: PRESET_STEPS[presetId],
    executed: false,
  };
}

export function runSchemaPreset(presetId: SchemaPresetId): RunResult {
  const trace: TraceEvent[] = [];

  if (presetId === "decode-ok" || presetId === "decode-fail") {
    const input =
      presetId === "decode-ok" ? { name: "ana", age: "30" } : { name: "ana", age: "treinta" };
    trace.push({ stepId: "s1", status: "ok", detail: JSON.stringify(input) });
    const exit = Schema.decodeUnknownExit(Person)(input);
    if (Exit.isSuccess(exit)) {
      trace.push({ stepId: "s2", status: "ok", detail: "decode ok" });
      const out = JSON.stringify(exit.value);
      trace.push({ stepId: "s3", status: "ok", detail: out });
      return {
        mode: "run",
        presetId,
        ok: true,
        value: out,
        direction: "decode",
        trace,
        executed: true,
      };
    }
    const error = Exit.findErrorOption(exit);
    const msg = Option.isSome(error) ? error.value.message : String(exit.cause);
    trace.push({ stepId: "s2", status: "fail", detail: msg });
    trace.push({ stepId: "s3", status: "skipped", detail: "no typed value" });
    return {
      mode: "run",
      presetId,
      ok: false,
      errorKind: "SchemaError",
      errorMessage: msg,
      direction: "decode",
      trace,
      executed: true,
    };
  }

  // encode-ok
  {
    const value = { name: "ana", age: 30 };
    trace.push({ stepId: "s1", status: "ok", detail: JSON.stringify(value) });
    const encoded = Schema.encodeSync(Person)(value);
    const out = JSON.stringify(encoded);
    trace.push({ stepId: "s2", status: "ok", detail: "encode ok" });
    trace.push({ stepId: "s3", status: "ok", detail: out });
    return {
      mode: "run",
      presetId,
      ok: true,
      value: out,
      direction: "encode",
      trace,
      executed: true,
    };
  }
}

export function schemaPresetLabel(id: SchemaPresetId): string {
  return id;
}
