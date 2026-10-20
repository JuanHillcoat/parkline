import { describe, expect, it } from "vitest";
import type { Result } from "../../../shared/domain/result";
import {
  InvalidBatteryQuantityError,
  InvalidInternalCodeError,
  InvalidMeterKindError,
  InvalidNameError,
  InvalidPreventiveIntervalError,
  InvalidTextError,
  InvalidYearError,
} from "../errors";
import {
  MAX_INTERNAL_CODE_LENGTH,
  MAX_PREVENTIVE_INTERVAL_HOURS,
  parseBatteryQuantity,
  parseInternalCode,
  parseMeterKind,
  parseName,
  parseOptionalText,
  parsePreventiveInterval,
  parseYear,
} from "../values";

const errorOf = <E>(result: Result<unknown, E>): E | undefined => (result.ok ? undefined : result.error);

describe("parseName", () => {
  it("stores the normalized name and rejects blank or too long names with invalid_name", () => {
    expect(parseName("  supplier   a ")).toEqual({ ok: true, value: "SUPPLIER A" });
    expect(errorOf(parseName("  "))).toBeInstanceOf(InvalidNameError);
    expect(errorOf(parseName("a".repeat(121)))?.code).toBe("invalid_name");
    expect(parseName("a".repeat(120)).ok).toBe(true);
  });
});

describe("parseInternalCode", () => {
  it("stores the code uppercase with collapsed whitespace", () => {
    expect(parseInternalCode("  c-043 ")).toEqual({ ok: true, value: "C-043" });
    expect(parseInternalCode("zx   037")).toEqual({ ok: true, value: "ZX 037" });
  });

  it("rejects a blank code and one over 40 characters with invalid_internal_code", () => {
    expect(errorOf(parseInternalCode("   "))).toBeInstanceOf(InvalidInternalCodeError);
    expect(parseInternalCode("9".repeat(MAX_INTERNAL_CODE_LENGTH)).ok).toBe(true);
    const long = parseInternalCode("9".repeat(MAX_INTERNAL_CODE_LENGTH + 1));
    expect(errorOf(long)?.code).toBe("invalid_internal_code");
  });
});

describe("parseMeterKind", () => {
  it("accepts hours, km and none only", () => {
    for (const kind of ["hours", "km", "none"]) expect(parseMeterKind(kind)).toEqual({ ok: true, value: kind });
    for (const bad of ["", "HOURS", "miles", " hours"]) {
      expect(errorOf(parseMeterKind(bad))).toBeInstanceOf(InvalidMeterKindError);
    }
    expect(errorOf(parseMeterKind("x"))?.code).toBe("invalid_meter_kind");
  });
});

describe("parsePreventiveInterval", () => {
  it("accepts null and positive integers up to the maximum", () => {
    expect(parsePreventiveInterval(null)).toEqual({ ok: true, value: null });
    expect(parsePreventiveInterval(1)).toEqual({ ok: true, value: 1 });
    expect(parsePreventiveInterval(MAX_PREVENTIVE_INTERVAL_HOURS)).toEqual({ ok: true, value: 10000 });
  });

  it("rejects zero, negatives, fractions, NaN and values over the maximum", () => {
    for (const bad of [0, -1, 250.5, Number.NaN, Number.POSITIVE_INFINITY, MAX_PREVENTIVE_INTERVAL_HOURS + 1]) {
      expect(errorOf(parsePreventiveInterval(bad)), String(bad)).toBeInstanceOf(InvalidPreventiveIntervalError);
    }
    expect(errorOf(parsePreventiveInterval(0))?.code).toBe("invalid_preventive_interval");
  });
});

describe("parseYear", () => {
  it("accepts null and integers from 1950 to the current year plus one", () => {
    expect(parseYear(null, 2026)).toEqual({ ok: true, value: null });
    expect(parseYear(1950, 2026)).toEqual({ ok: true, value: 1950 });
    expect(parseYear(2027, 2026)).toEqual({ ok: true, value: 2027 });
  });

  it("rejects 1949, next year plus one, fractions and NaN", () => {
    for (const bad of [1949, 2028, 2020.5, Number.NaN]) {
      expect(errorOf(parseYear(bad, 2026)), String(bad)).toBeInstanceOf(InvalidYearError);
    }
    expect(errorOf(parseYear(2028, 2026))?.code).toBe("invalid_year");
  });
});

describe("parseBatteryQuantity", () => {
  it("accepts null and integers from 0 to 4", () => {
    expect(parseBatteryQuantity(null)).toEqual({ ok: true, value: null });
    expect(parseBatteryQuantity(0)).toEqual({ ok: true, value: 0 });
    expect(parseBatteryQuantity(4)).toEqual({ ok: true, value: 4 });
  });

  it("rejects negatives, 5, fractions and NaN", () => {
    for (const bad of [-1, 5, 1.5, Number.NaN]) {
      expect(errorOf(parseBatteryQuantity(bad)), String(bad)).toBeInstanceOf(InvalidBatteryQuantityError);
    }
    expect(errorOf(parseBatteryQuantity(5))?.code).toBe("invalid_battery_quantity");
  });
});

describe("parseOptionalText", () => {
  it("trims, keeps inner text as typed and turns blank or null into null", () => {
    expect(parseOptionalText("  Brand  x ", 120, "brand")).toEqual({ ok: true, value: "Brand  x" });
    for (const empty of ["", "   ", "\t\n", null]) {
      expect(parseOptionalText(empty, 120, "brand")).toEqual({ ok: true, value: null });
    }
  });

  it("accepts exactly the maximum after trimming and rejects one more with invalid_text", () => {
    expect(parseOptionalText(` ${"a".repeat(60)} `, 60, "serialNumber").ok).toBe(true);
    const long = parseOptionalText("a".repeat(61), 60, "serialNumber");
    expect(errorOf(long)).toBeInstanceOf(InvalidTextError);
    expect(errorOf(long)?.code).toBe("invalid_text");
    expect(errorOf(long)?.field).toBe("serialNumber");
  });
});
