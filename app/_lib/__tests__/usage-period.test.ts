import { describe, expect, it } from "vitest";
import { copy } from "../copy";
import { parsePeriod, periodOptions, periodValue, PERIOD_MONTHS } from "../usage-period";

const TODAY = "2026-10-29";

describe("parsePeriod", () => {
  it("accepts a month of the last 24, this one included", () => {
    expect(parsePeriod("2026-10", TODAY)).toEqual({ year: 2026, month: 10 });
    expect(parsePeriod("2026-03", TODAY)).toEqual({ year: 2026, month: 3 });
    expect(parsePeriod("2024-11", TODAY)).toEqual({ year: 2024, month: 11 });
  });

  it("falls back to the current month for nothing, garbage, a repeated value, the future or too far back", () => {
    const current = { year: 2026, month: 10 };
    for (const raw of [undefined, "", "bogus", "2026-13", "2026-00", "26-10", "2026-1", "2026-10-01", ["2026-03", "2026-04"], "2026-11", "2027-01", "2024-10", "1999-01"]) {
      expect(parsePeriod(raw, TODAY), String(raw)).toEqual(current);
    }
  });

  it("works across a year boundary", () => {
    expect(parsePeriod("2025-01", "2026-01-05")).toEqual({ year: 2025, month: 1 });
    expect(parsePeriod("2024-02", "2026-01-05")).toEqual({ year: 2024, month: 2 });
    expect(parsePeriod("2024-01", "2026-01-05")).toEqual({ year: 2026, month: 1 });
  });
});

describe("periodOptions", () => {
  it("lists the last 24 months, the current one first, with a readable label", () => {
    const options = periodOptions(TODAY);
    expect(options).toHaveLength(PERIOD_MONTHS);
    expect(options[0]).toEqual({ value: "2026-10", label: `${copy.fleet.detail.usage.monthNames[9]} 2026` });
    expect(options[1]?.value).toBe("2026-09");
    expect(options[10]?.value).toBe("2025-12");
    expect(options.at(-1)?.value).toBe("2024-11");
  });
});

describe("periodValue", () => {
  it("writes YYYY-MM with a padded month", () => {
    expect(periodValue({ year: 2026, month: 3 })).toBe("2026-03");
  });
});
