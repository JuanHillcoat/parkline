import { describe, expect, it } from "vitest";
import { compareDays, dayOf, parseDay, shiftDay } from "../day";
import { MAX_READING_TENTHS, parseReadingValue } from "../values";

describe("parseReadingValue", () => {
  it.each([
    [0, 0],
    [1250, 12500],
    [12.5, 125],
    [0.1 + 0.2, 3],
    [9_999_999.9, MAX_READING_TENTHS],
  ])("stores %s as %s tenths", (raw, tenths) => {
    const parsed = parseReadingValue(raw);
    expect(parsed.ok && parsed.value).toBe(tenths);
  });

  it.each([-0.1, 12.25, 10_000_000, 9_999_999.95, Number.NaN, Number.POSITIVE_INFINITY])("rejects %s", (raw) => {
    const parsed = parseReadingValue(raw);
    expect(!parsed.ok && parsed.error.code).toBe("invalid_reading_value");
  });

  it("normalizes negative zero", () => {
    const parsed = parseReadingValue(-0);
    expect(parsed.ok && Object.is(parsed.value, 0)).toBe(true);
  });
});

describe("days", () => {
  it("accepts real calendar days only", () => {
    expect(parseDay("2026-02-28").ok).toBe(true);
    const bad = parseDay("2026-02-30");
    expect(!bad.ok && bad.error.code).toBe("invalid_day");
    expect(parseDay("28/02/2026").ok).toBe(false);
  });

  it("compares, shifts and reads the UTC day of an instant", () => {
    expect(compareDays("2026-01-01", "2026-01-02")).toBeLessThan(0);
    expect(shiftDay("2026-03-01", -30)).toBe("2026-01-30");
    expect(dayOf(new Date("2026-05-05T23:59:59Z"))).toBe("2026-05-05");
  });
});
