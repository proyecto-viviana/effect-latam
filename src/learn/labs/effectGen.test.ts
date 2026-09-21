import { describe, expect, it } from "vite-plus/test";
import { describePreset, runPreset } from "./effectGen";

describe("I01 effectGen engine", () => {
  it("describe never marks executed", () => {
    for (const id of ["hello-success", "two-steps", "fail-short-circuit"] as const) {
      const d = describePreset(id);
      expect(d.executed).toBe(false);
      expect(d.mode).toBe("describe");
      expect(d.steps.length).toBeGreaterThan(0);
    }
  });

  it("hello-success run returns fixed string", () => {
    const r = runPreset("hello-success");
    expect(r.executed).toBe(true);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toBe("hola effect latam");
      expect(r.trace.some((t) => t.status === "ok")).toBe(true);
    }
  });

  it("two-steps combines yields", () => {
    const r = runPreset("two-steps");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("a:b");
  });

  it("fail-short-circuit skips later steps", () => {
    const r = runPreset("fail-short-circuit");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errorTag).toBe("DemoError");
      const s3 = r.trace.find((t) => t.stepId === "s3");
      expect(s3?.status).toBe("skipped");
      expect(r.trace.some((t) => t.stepId === "s1" && t.status === "ok")).toBe(true);
      expect(r.trace.some((t) => t.status === "fail")).toBe(true);
    }
  });

  it("describe and run are independent for fail preset", () => {
    const d = describePreset("fail-short-circuit");
    expect(d.steps.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
    expect(d.executed).toBe(false);
    const r = runPreset("fail-short-circuit");
    expect(r.executed).toBe(true);
    expect(r.ok).toBe(false);
  });
});
