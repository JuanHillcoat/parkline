import { describe, expect, it } from "vitest";
import { InvalidNameError } from "../errors";
import { MAX_NAME_LENGTH, nameKey, parseName } from "../name";

describe("parseName", () => {
  it("trims the name", () => {
    expect(parseName("  Zona Norte  ")).toEqual({ ok: true, value: "Zona Norte" });
  });

  it("rejects an empty or blank name with a typed error", () => {
    for (const raw of ["", "   "]) {
      const result = parseName(raw);
      expect(!result.ok && result.error).toBeInstanceOf(InvalidNameError);
      expect(!result.ok && result.error.code).toBe("invalid_name");
    }
  });

  it("rejects a name longer than the maximum and accepts one of exactly the maximum", () => {
    expect(parseName("a".repeat(MAX_NAME_LENGTH)).ok).toBe(true);
    expect(parseName("a".repeat(MAX_NAME_LENGTH + 1)).ok).toBe(false);
  });
});

describe("nameKey", () => {
  it("ignores case, outer spaces and repeated inner whitespace", () => {
    expect(nameKey("  Zona   NORTE\t")).toBe(nameKey("zona norte"));
  });

  it("keeps different names apart", () => {
    expect(nameKey("Zona Norte")).not.toBe(nameKey("Zona Sur"));
  });
});
