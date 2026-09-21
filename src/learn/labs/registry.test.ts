import { describe, expect, it } from "vite-plus/test";
import { LABS } from "../catalog";
import { engineForLab } from "./registry";

const STUB = "Engine pure module ready";

describe("lab playground registry", () => {
  it("registers an engine for every catalog lab", () => {
    expect(LABS.map((lab) => lab.id)).toEqual(["i01", "i02", "i03", "i04", "i05", "i06", "i07"]);
    for (const lab of LABS) {
      const engine = engineForLab(lab.id);
      expect(engine.presetIds.length).toBeGreaterThan(0);
    }
  });

  it("describe returns structural executed:false from the real engine", () => {
    for (const lab of LABS) {
      const engine = engineForLab(lab.id);
      for (const presetId of engine.presetIds) {
        const result = engine.describe(presetId);
        expect(result.mode).toBe("describe");
        expect(result.executed).toBe(false);
        expect(result.presetId).toBe(presetId);
        expect(result.steps.length).toBeGreaterThan(0);
        expect(JSON.stringify(result)).not.toContain(STUB);
      }
    }
  });

  it("run matches engine fixtures and is never the stub", async () => {
    for (const lab of LABS) {
      const engine = engineForLab(lab.id);
      for (const presetId of engine.presetIds) {
        const result = (await engine.run(presetId)) as {
          mode: string;
          executed: boolean;
          presetId: string;
        };
        expect(result.mode).toBe("run");
        expect(result.executed).toBe(true);
        expect(result.presetId).toBe(presetId);
        expect(JSON.stringify(result)).not.toContain(STUB);
      }
    }
  });
});
