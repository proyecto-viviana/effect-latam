import { expect, test } from "vitest";
import { pageNumber } from "./pagination";

test("bounds offsets without accepting malformed or fractional pages", () => {
  for (const value of [null, "", "0", "-1", "2.5", "2junk", "NaN", "Infinity", "9007199254740992"])
    expect(pageNumber(value)).toBe(1);
  expect(pageNumber("2")).toBe(2);
  expect(pageNumber("10001")).toBe(10_000);
});
