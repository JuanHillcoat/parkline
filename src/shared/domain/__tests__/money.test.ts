import { describe, expect, it } from "vitest";
import { Money } from "../money";
import type { Result } from "../result";

const money = (amount: string, currency = "ARS"): Money => {
  const result = Money.parse(amount, currency);
  if (!result.ok) throw new Error(`bad fixture ${amount}`);
  return result.value;
};

const value = <T, E>(result: Result<T, E>): T => {
  if (!result.ok) throw new Error("expected ok");
  return result.value;
};

describe("Money", () => {
  it("parses decimal strings and formats with two decimals", () => {
    expect(money("1234.5").format()).toBe("ARS 1234.50");
    expect(money("-0.05").toDecimalString()).toBe("-0.05");
    expect(money("10").minorUnits).toBe(1000n);
  });

  it("rejects malformed amounts and currencies", () => {
    expect(Money.parse("1.234").ok).toBe(false);
    expect(Money.parse("abc").ok).toBe(false);
    expect(Money.parse("1", "ars").ok).toBe(false);
  });

  it("adds exactly without floating point drift", () => {
    const sum = value(money("0.10").add(money("0.20")));
    expect(sum.toDecimalString()).toBe("0.30");
    expect(value(money("0.30").subtract(money("0.10"))).toDecimalString()).toBe("0.20");
  });

  it("rejects mixed currencies with a typed error", () => {
    const result = money("1").add(money("1", "USD"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("currency_mismatch");
  });

  it("multiplies by integers", () => {
    expect(value(money("12.34").multiply(3, "half-up")).toDecimalString()).toBe("37.02");
    expect(Money.zero("ARS").multiply(1.5, "floor").ok).toBe(false);
  });

  it("multiplies by decimal factors with explicit rounding", () => {
    const base = money("10.01");
    expect(value(base.multiply("0.5", "floor")).toDecimalString()).toBe("5.00");
    expect(value(base.multiply("0.5", "ceil")).toDecimalString()).toBe("5.01");
    expect(value(base.multiply("0.5", "half-up")).toDecimalString()).toBe("5.01");
    expect(value(base.multiply("0.5", "half-even")).toDecimalString()).toBe("5.00");
    expect(value(money("-10.01").multiply("0.5", "floor")).toDecimalString()).toBe("-5.01");
    expect(value(money("-10.01").multiply("0.5", "down")).toDecimalString()).toBe("-5.00");
  });

  it("rejects invalid factors", () => {
    expect(money("1").multiply("x", "floor").ok).toBe(false);
  });

  it("allocates by days without losing cents", () => {
    const parts = value(money("100.00").allocateByDays([10, 10, 10]));
    expect(parts.map((p) => p.toDecimalString())).toEqual(["33.34", "33.33", "33.33"]);
    const total = parts.reduce((sum, p) => sum + p.minorUnits, 0n);
    expect(total).toBe(10000n);
  });

  it("allocates proportionally and handles negatives", () => {
    const parts = value(money("-10.00").allocateByDays([1, 2]));
    expect(parts.map((p) => p.toDecimalString())).toEqual(["-3.33", "-6.67"]);
  });

  it("rejects invalid day weights", () => {
    expect(money("1").allocateByDays([]).ok).toBe(false);
    expect(money("1").allocateByDays([0, 0]).ok).toBe(false);
    expect(money("1").allocateByDays([-1, 2]).ok).toBe(false);
  });

  it("compares by value and currency", () => {
    expect(money("1.00").equals(money("1"))).toBe(true);
    expect(money("1").equals(money("1", "USD"))).toBe(false);
  });
});
