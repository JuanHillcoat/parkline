import { describe, expect, it } from "vitest";
import { parseCostCenter } from "../cost-center";
import { InvalidCostCenterError } from "../errors";

describe("parseCostCenter", () => {
  it("accepts exactly four digits and keeps the leading zeros", () => {
    for (const code of ["0050", "0009", "1234", "0000", "9999"]) {
      expect(parseCostCenter(code)).toEqual({ ok: true, value: code });
    }
  });

  it("trims the input and stores it without spaces", () => {
    expect(parseCostCenter("  0050 ")).toEqual({ ok: true, value: "0050" });
  });

  it("rejects anything that is not exactly four ASCII digits with a typed error", () => {
    for (const code of ["50", "00500", "abcd", "00 50", "", "   ", "005O", "-050", "00.5", "0050\n0051", "٠٠٠٠"]) {
      const result = parseCostCenter(code);
      expect(result.ok, JSON.stringify(code)).toBe(false);
      expect(!result.ok && result.error).toBeInstanceOf(InvalidCostCenterError);
      expect(!result.ok && result.error.code).toBe("invalid_cost_center");
    }
  });
});
