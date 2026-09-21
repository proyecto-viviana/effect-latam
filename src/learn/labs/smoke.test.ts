import { describe, expect, it } from "vitest";
import { PRESET_IDS, describePreset } from "./effectGen";

describe("learn labs salvage", () => {
  it("effectGen engine still exports pure helpers", () => {
    expect(PRESET_IDS.length).toBeGreaterThan(0);
    const result = describePreset("hello-success");
    expect(result.mode).toBe("describe");
    expect(result.executed).toBe(false);
  });
});
