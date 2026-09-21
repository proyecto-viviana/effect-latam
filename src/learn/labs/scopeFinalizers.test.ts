import { describe, expect, it } from "vite-plus/test";
import { describeScopePreset, runScopePreset } from "./scopeFinalizers";

describe("I07 scopeFinalizers engine", () => {
  it("describe never executes", () => {
    for (const id of ["success-release", "fail-still-releases", "nested-order"] as const) {
      const d = describeScopePreset(id);
      expect(d.executed).toBe(false);
      expect(d.steps.length).toBeGreaterThan(0);
    }
  });

  it("success-release runs use then release", async () => {
    const r = await runScopePreset("success-release");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toBe("resource-ok");
      expect(r.lifecycle).toEqual(["acquire", "use", "release"]);
    }
  });

  it("fail-still-releases finalizer on fail", async () => {
    const r = await runScopePreset("fail-still-releases");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errorMessage).toContain("use-failed");
      expect(r.lifecycle).toEqual(["acquire", "use", "release"]);
    }
  });

  it("nested-order releases LIFO", async () => {
    const r = await runScopePreset("nested-order");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.lifecycle).toEqual([
        "outer-acquire",
        "inner-acquire",
        "use",
        "inner-release",
        "outer-release",
      ]);
    }
  });
});
