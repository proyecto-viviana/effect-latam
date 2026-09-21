import { describe, expect, it } from "vite-plus/test";
import { describeSchemaPreset, runSchemaPreset } from "./schemaDecode";

describe("I06 schemaDecode engine", () => {
  it("describe never executes", () => {
    for (const id of ["decode-ok", "decode-fail", "encode-ok"] as const) {
      const d = describeSchemaPreset(id);
      expect(d.executed).toBe(false);
      expect(d.steps.length).toBeGreaterThan(0);
    }
  });

  it("decode-ok yields person", () => {
    const r = runSchemaPreset("decode-ok");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toContain("ana");
      expect(r.value).toContain("30");
      expect(r.direction).toBe("decode");
    }
  });

  it("decode-fail surfaces SchemaError", () => {
    const r = runSchemaPreset("decode-fail");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errorKind).toBe("SchemaError");
      expect(r.errorMessage).toContain("Expected a finite number");
      expect(r.errorMessage).toContain('["age"]');
    }
  });

  it("encode-ok returns the wire shape", () => {
    const r = runSchemaPreset("encode-ok");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toBe('{"name":"ana","age":"30"}');
      expect(r.direction).toBe("encode");
    }
  });
});
