import { describe, expect, it } from "vitest";
import { createUser } from "../user";

const valid = { id: "user-1", tenantId: "tenant-a", email: "ana@example.test", displayName: "Ana Test" };

describe("createUser", () => {
  it("creates an active user", () => {
    expect(createUser(valid)).toEqual({ ok: true, value: { ...valid, active: true } });
  });

  it("normalizes the email to trimmed lower case", () => {
    const result = createUser({ ...valid, email: "  Ana@Example.TEST " });
    expect(result.ok && result.value.email).toBe("ana@example.test");
  });

  it.each(["", "ana", "@example.test", "ana@", "a@b@c", "an a@example.test"])(
    "rejects the malformed email %j",
    (email) => {
      const result = createUser({ ...valid, email });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("validation");
    },
  );

  it("rejects empty identifiers and display name", () => {
    expect(createUser({ ...valid, id: "" }).ok).toBe(false);
    expect(createUser({ ...valid, tenantId: " " }).ok).toBe(false);
    expect(createUser({ ...valid, displayName: "" }).ok).toBe(false);
  });
});
