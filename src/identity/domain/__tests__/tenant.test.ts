import { describe, expect, it } from "vitest";
import { createTenant } from "../tenant";

describe("createTenant", () => {
  it("creates a tenant with trimmed fields", () => {
    expect(createTenant({ id: " tenant-a ", name: " Tenant A " })).toEqual({
      ok: true,
      value: { id: "tenant-a", name: "Tenant A" },
    });
  });

  it("rejects a blank id or name", () => {
    expect(createTenant({ id: " ", name: "Tenant A" }).ok).toBe(false);
    const result = createTenant({ id: "tenant-a", name: "  " });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("validation");
  });
});
