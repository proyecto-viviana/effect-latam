import { describe, expect, it } from "vite-plus/test";
import { describeSchedulePreset, runSchedulePreset } from "./scheduleLab";

describe("I05 scheduleLab engine", () => {
  it("describe never executes", () => {
    for (const id of ["succeed-first", "retry-then-ok", "retry-exhausted"] as const) {
      const d = describeSchedulePreset(id);
      expect(d.executed).toBe(false);
      expect(d.steps.length).toBeGreaterThan(0);
    }
  });

  it("succeed-first needs one attempt", async () => {
    const r = await runSchedulePreset("succeed-first");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toBe("ok-first");
      expect(r.attempts).toBe(1);
    }
  });

  it("retry-then-ok recovers on attempt 3", async () => {
    const r = await runSchedulePreset("retry-then-ok");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toBe("recovered-ok");
      expect(r.attempts).toBe(3);
    }
  });

  it("retry-exhausted fails after budget", async () => {
    const r = await runSchedulePreset("retry-exhausted");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errorKind).toBe("ServiceDown");
      expect(r.errorMessage).toContain("still-broken");
      expect(r.attempts).toBe(3);
    }
  });
});
