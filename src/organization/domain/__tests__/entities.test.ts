import { describe, expect, it } from "vitest";
import { createBusinessUnit, createOperation, createSite } from "../entities";
import { InvalidNameError } from "../errors";

describe("entity factories", () => {
  it("builds a business unit with a trimmed name", () => {
    expect(createBusinessUnit({ id: "bu-1", tenantId: "t", name: " Norte " })).toEqual({
      ok: true,
      value: { id: "bu-1", tenantId: "t", name: "Norte" },
    });
  });

  it("builds an operation under its business unit", () => {
    const result = createOperation({ id: "op-1", tenantId: "t", businessUnitId: "bu-1", name: "Mina 1" });
    expect(result.ok && result.value).toEqual({
      id: "op-1",
      tenantId: "t",
      businessUnitId: "bu-1",
      name: "Mina 1",
    });
  });

  it("builds a site", () => {
    const result = createSite({ id: "s-1", tenantId: "t", name: "Taller" });
    expect(result.ok && result.value).toEqual({ id: "s-1", tenantId: "t", name: "Taller" });
  });

  it("rejects an invalid name in every factory", () => {
    const results = [
      createBusinessUnit({ id: "1", tenantId: "t", name: " " }),
      createOperation({ id: "1", tenantId: "t", businessUnitId: "b", name: "" }),
      createSite({ id: "1", tenantId: "t", name: "x".repeat(500) }),
    ];
    for (const result of results) expect(!result.ok && result.error).toBeInstanceOf(InvalidNameError);
  });
});
