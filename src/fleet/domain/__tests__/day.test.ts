import { describe, expect, it } from "vitest";
import { InvalidDayError } from "../errors";
import { compareDays, dayOf, parseDay, previousDay } from "../day";

describe("parseDay", () => {
  it.each(["2026-01-01", "2024-02-29", "1999-12-31"])("accepts %s", (raw) => {
    const day = parseDay(raw);
    expect(day.ok && day.value).toBe(raw);
  });

  it.each(["", "2026-1-1", "2026-13-01", "2026-02-30", "2025-02-29", "2026-01-01T00:00:00Z", " 2026-01-01", "01/01/2026", "2026-00-10"])(
    "rejects %j with a typed error on the day field",
    (raw) => {
      const day = parseDay(raw);
      expect(!day.ok && day.error).toBeInstanceOf(InvalidDayError);
      expect(!day.ok && day.error.code).toBe("invalid_day");
      expect(!day.ok && day.error.field).toBe("day");
    },
  );

  it("names the offending field", () => {
    const day = parseDay("nope", "validTo");
    expect(!day.ok && day.error.field).toBe("validTo");
  });
});

describe("compareDays", () => {
  it("orders days chronologically", () => {
    expect(compareDays("2026-01-01", "2026-01-02")).toBeLessThan(0);
    expect(compareDays("2026-02-01", "2026-01-31")).toBeGreaterThan(0);
    expect(compareDays("2026-03-04", "2026-03-04")).toBe(0);
    expect(compareDays("2025-12-31", "2026-01-01")).toBeLessThan(0);
  });
});

describe("previousDay", () => {
  it("steps back across month, year and leap boundaries without a timezone", () => {
    expect(previousDay("2026-03-01")).toBe("2026-02-28");
    expect(previousDay("2024-03-01")).toBe("2024-02-29");
    expect(previousDay("2026-01-01")).toBe("2025-12-31");
    expect(previousDay("2026-05-15")).toBe("2026-05-14");
  });
});

describe("dayOf", () => {
  it("is the UTC calendar day of an instant", () => {
    expect(dayOf(new Date("2026-01-01T23:59:59Z"))).toBe("2026-01-01");
    expect(dayOf(new Date("2026-01-02T00:00:00Z"))).toBe("2026-01-02");
  });
});
