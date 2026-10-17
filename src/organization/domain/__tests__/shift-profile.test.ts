import { describe, expect, it } from "vitest";
import {
  InvalidDateError,
  InvalidShiftsError,
  ShiftProfileNotAfterError,
  ShiftProfileOverlapError,
} from "../errors";
import { parseIsoDate, parseShifts, setShiftProfile, type ShiftProfile } from "../shift-profile";

const version = (shifts: ShiftProfile["shifts"], validFrom: string, validTo: string | null): ShiftProfile => ({
  operationId: "op-1",
  shifts,
  validFrom,
  validTo,
});

const set = (existing: ShiftProfile[], shifts: ShiftProfile["shifts"], validFrom: string) =>
  setShiftProfile(existing, { operationId: "op-1", shifts, validFrom });

describe("parseIsoDate", () => {
  it("accepts a real calendar date", () => {
    expect(parseIsoDate("2026-02-28")).toEqual({ ok: true, value: "2026-02-28" });
  });

  it("rejects malformed and impossible dates", () => {
    for (const raw of ["2026-1-1", "2026-02-30", "26-01-01", "", "2026-01-01T00:00:00Z"]) {
      const result = parseIsoDate(raw);
      expect(!result.ok && result.error).toBeInstanceOf(InvalidDateError);
    }
  });
});

describe("parseShifts", () => {
  it("accepts the four profiles", () => {
    for (const raw of ["1", "2", "3", "24h"]) expect(parseShifts(raw).ok).toBe(true);
  });

  it("rejects anything else", () => {
    const result = parseShifts("4");
    expect(!result.ok && result.error).toBeInstanceOf(InvalidShiftsError);
  });
});

describe("setShiftProfile", () => {
  it("creates the first version open", () => {
    expect(set([], "2", "2026-03-01")).toEqual({ ok: true, value: [version("2", "2026-03-01", null)] });
  });

  it("closes the open version the day before the new one starts", () => {
    const result = set([version("1", "2026-01-01", null)], "3", "2026-03-01");
    expect(result).toEqual({
      ok: true,
      value: [version("1", "2026-01-01", "2026-02-28"), version("3", "2026-03-01", null)],
    });
  });

  it("keeps earlier closed versions untouched", () => {
    const existing = [version("1", "2026-01-01", "2026-01-31"), version("2", "2026-02-01", null)];
    const result = set(existing, "24h", "2026-02-02");
    expect(result.ok && result.value).toEqual([
      version("1", "2026-01-01", "2026-01-31"),
      version("2", "2026-02-01", "2026-02-01"),
      version("24h", "2026-02-02", null),
    ]);
  });

  it("rejects a start that is not after the open version's start", () => {
    for (const from of ["2026-01-01", "2025-12-31"]) {
      const result = set([version("1", "2026-01-01", null)], "2", from);
      expect(!result.ok && result.error).toBeInstanceOf(ShiftProfileNotAfterError);
    }
  });

  it("rejects a start inside an already closed version", () => {
    const existing = [version("1", "2026-01-01", "2026-01-31")];
    const result = set(existing, "2", "2026-01-15");
    expect(!result.ok && result.error).toBeInstanceOf(ShiftProfileOverlapError);
    expect(!result.ok && result.error.code).toBe("shift_profile_overlap");
  });

  it("rejects an invalid date", () => {
    const result = set([], "2", "2026-13-01");
    expect(!result.ok && result.error).toBeInstanceOf(InvalidDateError);
  });
});
