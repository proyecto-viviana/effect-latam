import { describe, expect, it } from "vite-plus/test";
import { describeErrorPreset, runErrorPreset, runWrongCatchTag } from "./errorChannel";

describe("I02 errorChannel engine", () => {
  it("describe never executes", () => {
    for (const id of ["success-path", "fail-no-catch", "fail-catch-tag"] as const) {
      const d = describeErrorPreset(id);
      expect(d.executed).toBe(false);
      expect(d.steps.length).toBeGreaterThan(0);
    }
  });

  it("success-path returns payload", () => {
    const r = runErrorPreset("success-path");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toBe("payload");
      expect(r.recovered).toBe(false);
    }
  });

  it("fail-no-catch short-circuits and fails", () => {
    const r = runErrorPreset("fail-no-catch");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errorTag).toBe("NetworkError");
      expect(r.trace.find((t) => t.stepId === "s3")?.status).toBe("skipped");
      expect(r.trace.some((t) => t.status === "fail")).toBe(true);
    }
  });

  it("fail-catch-tag recovers via catchTag", () => {
    const r = runErrorPreset("fail-catch-tag");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.recovered).toBe(true);
      expect(r.value).toBe("recovered:timeout");
      expect(r.trace.some((t) => t.status === "caught")).toBe(true);
    }
  });

  it("wrong catchTag does not recover NetworkError", () => {
    const r = runWrongCatchTag();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errorTag).toBe("NetworkError");
      expect(r.recovered).toBe(false);
    }
  });
});
