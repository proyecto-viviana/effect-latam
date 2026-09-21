import { describe, expect, it } from "vite-plus/test";
import { describeLayerPreset, runLayerPreset } from "./layerProvide";

describe("I03 layerProvide engine", () => {
  it("describe never executes", () => {
    for (const id of ["missing-service", "provide-live", "provide-mock"] as const) {
      const d = describeLayerPreset(id);
      expect(d.executed).toBe(false);
      expect(d.steps.length).toBeGreaterThan(0);
    }
  });

  it("missing-service fails without provide", () => {
    const r = runLayerPreset("missing-service");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errorKind).toBe("MissingService");
      expect(r.provided).toBe(false);
      expect(r.errorMessage.toLowerCase()).toContain("greeter");
    }
  });

  it("provide-live returns hola latam", () => {
    const r = runLayerPreset("provide-live");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toBe("hola latam");
      expect(r.provided).toBe(true);
    }
  });

  it("provide-mock swaps implementation", () => {
    const r = runLayerPreset("provide-mock");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toBe("mock:latam");
      expect(r.provided).toBe(true);
    }
  });
});
