import { describe, expect, it } from "vite-plus/test";
import { describeFiberPreset, runFiberPreset } from "./fiberRaceAll";

describe("I04 fiberRaceAll engine", () => {
  it("describe never executes", () => {
    for (const id of ["all-success", "all-one-fails", "race-left", "race-fast-wins"] as const) {
      const d = describeFiberPreset(id);
      expect(d.executed).toBe(false);
      expect(d.steps.length).toBeGreaterThan(0);
    }
  });

  it("all-success collects both", async () => {
    const r = await runFiberPreset("all-success");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toBe('["alpha","beta"]');
      expect(r.combinator).toBe("all");
    }
  });

  it("all-one-fails short-circuits", async () => {
    const r = await runFiberPreset("all-one-fails");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errorKind).toBe("FiberFail");
      expect(r.errorMessage).toContain("fiber-b-fail");
      expect(r.trace.some((e) => e.status === "skipped")).toBe(true);
    }
  });

  it("race-left prefers left when both ready", async () => {
    const r = await runFiberPreset("race-left");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toBe("left");
      expect(r.combinator).toBe("race");
    }
  });

  it("race-fast-wins picks the immediate fiber", async () => {
    const r = await runFiberPreset("race-fast-wins");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toBe("fast");
      expect(r.combinator).toBe("race");
    }
  });
});
