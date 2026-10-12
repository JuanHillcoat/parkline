import { describe, expect, it } from "vitest";
import { parseRole, ROLES } from "../role";

describe("parseRole", () => {
  it("accepts every known role", () => {
    for (const role of ROLES) {
      expect(parseRole(role)).toEqual({ ok: true, value: role });
    }
  });

  it("rejects an unknown role with a typed error", () => {
    const result = parseRole("superuser");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_role");
  });

  it("is case sensitive and rejects empty input", () => {
    expect(parseRole("Admin").ok).toBe(false);
    expect(parseRole("").ok).toBe(false);
  });
});
