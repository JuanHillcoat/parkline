import { describe, expect, it } from "vitest";
import { createBusinessUnit, createOperation, createSite } from "../entities";
import { InvalidCostCenterError, InvalidNameError } from "../errors";

const operationInput = {
  id: "op-1",
  tenantId: "t",
  businessUnitId: "bu-1",
  siteId: "s-1",
  name: "Mina 1",
  costCenter: "0050",
};

describe("entity factories", () => {
  it("builds a business unit with a trimmed, uppercase name", () => {
    expect(createBusinessUnit({ id: "bu-1", tenantId: "t", name: " Norte " })).toEqual({
      ok: true,
      value: { id: "bu-1", tenantId: "t", name: "NORTE" },
    });
  });

  it("builds an operation with its division, its single site and its cost center", () => {
    const result = createOperation(operationInput);
    expect(result.ok && result.value).toEqual({
      id: "op-1",
      tenantId: "t",
      businessUnitId: "bu-1",
      siteId: "s-1",
      name: "MINA 1",
      costCenter: "0050",
    });
  });

  it("trims, uppercases and collapses the name and trims the cost center of an operation", () => {
    const result = createOperation({ ...operationInput, name: " Mina   1 ", costCenter: " 0009 " });
    expect(result.ok && result.value).toMatchObject({ name: "MINA 1", costCenter: "0009" });
  });

  it("builds a site and keeps the accents of its name", () => {
    const result = createSite({ id: "s-1", tenantId: "t", name: "Bahía Blanca" });
    expect(result.ok && result.value).toEqual({ id: "s-1", tenantId: "t", name: "BAHÍA BLANCA" });
  });

  it("rejects an invalid name in every factory", () => {
    const results = [
      createBusinessUnit({ id: "1", tenantId: "t", name: " " }),
      createOperation({ ...operationInput, name: "" }),
      createSite({ id: "1", tenantId: "t", name: "x".repeat(500) }),
    ];
    for (const result of results) expect(!result.ok && result.error).toBeInstanceOf(InvalidNameError);
  });

  it("rejects an invalid cost center when building an operation", () => {
    for (const costCenter of ["50", "00500", "abcd", "00 50", ""]) {
      const result = createOperation({ ...operationInput, costCenter });
      expect(!result.ok && result.error).toBeInstanceOf(InvalidCostCenterError);
    }
  });
});
