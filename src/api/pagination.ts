/** Keep D1 offsets bounded and reject fractional/non-numeric page inputs. */
export function pageNumber(raw: string | null): number {
  const value = Number(raw ?? "1");
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, 10_000) : 1;
}
