import { describe, expect, it } from "vitest";
import { ACCENTED, MAX_NAME_LENGTH, PLAIN, nameKey, normalizeName, parseNormalizedText } from "../catalog-name";

describe("normalizeName", () => {
  it("trims, collapses inner whitespace and uppercases", () => {
    expect(normalizeName("  Zona \t  norte\n")).toBe("ZONA NORTE");
  });

  it("keeps accents and the letter N with tilde in the stored form", () => {
    expect(normalizeName("bahía blanca")).toBe("BAHÍA BLANCA");
    expect(normalizeName("Núñez")).toBe("NÚÑEZ");
  });

  it("is idempotent", () => {
    const once = normalizeName("  Camión   ñandú ");
    expect(normalizeName(once)).toBe(once);
  });

  it("does not crash on characters whose case mapping changes the length", () => {
    expect(() => normalizeName("Straße")).not.toThrow();
    expect(() => normalizeName("ﬁx")).not.toThrow();
  });
});

describe("parseNormalizedText", () => {
  it("returns the normalized (uppercase) text", () => {
    expect(parseNormalizedText("  Supplier   a  ", 40, "name")).toEqual({ ok: true, value: "SUPPLIER A" });
  });

  it("rejects empty or blank text, naming the label", () => {
    for (const raw of ["", "   ", "\t\n"]) {
      expect(parseNormalizedText(raw, 40, "internal code")).toEqual({
        ok: false,
        error: "The internal code is required",
      });
    }
  });

  it("accepts exactly the maximum and rejects one more, measured after normalization", () => {
    expect(parseNormalizedText("a".repeat(MAX_NAME_LENGTH), MAX_NAME_LENGTH, "name").ok).toBe(true);
    expect(parseNormalizedText(`${"a".repeat(MAX_NAME_LENGTH)}   `, MAX_NAME_LENGTH, "name").ok).toBe(true);
    expect(parseNormalizedText("a".repeat(MAX_NAME_LENGTH + 1), MAX_NAME_LENGTH, "name")).toEqual({
      ok: false,
      error: `The name has at most ${String(MAX_NAME_LENGTH)} characters`,
    });
    expect(parseNormalizedText(`${"a".repeat(MAX_NAME_LENGTH - 2)}   \t   b`, MAX_NAME_LENGTH, "name").ok).toBe(true);
    expect(parseNormalizedText(`${"a".repeat(MAX_NAME_LENGTH - 1)} b`, MAX_NAME_LENGTH, "name").ok).toBe(false);
  });
});

describe("nameKey", () => {
  it("ignores case, outer spaces and repeated inner whitespace", () => {
    expect(nameKey("  Zona   NORTE\t")).toBe(nameKey("zona norte"));
  });

  it("keeps different names apart", () => {
    expect(nameKey("Zona Norte")).not.toBe(nameKey("Zona Sur"));
  });

  it("ignores accents: every spelling of the same name gives the same key", () => {
    const key = nameKey("BAHÍA BLANCA");
    expect(key).toBe("BAHIA BLANCA");
    for (const raw of ["bahía blanca", "BAHIA  BLANCA", "Bahia Blanca", "bahia\tblanca"]) {
      expect(nameKey(raw), raw).toBe(key);
    }
  });

  it("folds every accented vowel in every case through the one explicit map", () => {
    expect(nameKey("ÁÀÂÄ ÉÈÊË ÍÌÎÏ ÓÒÔÖ ÚÙÛÜ")).toBe("AAAA EEEE IIII OOOO UUUU");
    expect(nameKey("áàâä éèêë íìîï óòôö úùûü")).toBe("AAAA EEEE IIII OOOO UUUU");
  });

  it("does not fold the letter N with tilde nor the letter C with cedilla", () => {
    expect(nameKey("Núñez")).toBe("NUÑEZ");
    expect(nameKey("NUÑEZ")).not.toBe(nameKey("NUNEZ"));
    expect(nameKey("Ç")).toBe("Ç");
    expect(nameKey("Ç")).not.toBe(nameKey("C"));
  });
});

describe("the accent fold map", () => {
  const expected: Readonly<Record<string, string>> = {
    "Á": "A", "À": "A", "Â": "A", "Ä": "A",
    "É": "E", "È": "E", "Ê": "E", "Ë": "E",
    "Í": "I", "Ì": "I", "Î": "I", "Ï": "I",
    "Ó": "O", "Ò": "O", "Ô": "O", "Ö": "O",
    "Ú": "U", "Ù": "U", "Û": "U", "Ü": "U",
  };

  it("keeps the two parallel strings aligned: same length, each accented letter over its plain one", () => {
    expect(ACCENTED).toHaveLength(PLAIN.length);
    expect(ACCENTED).toHaveLength(Object.keys(expected).length);
    for (let index = 0; index < ACCENTED.length; index += 1) {
      const letter = ACCENTED.charAt(index);
      expect(PLAIN.charAt(index), `position ${String(index)}`).toBe(expected[letter]);
    }
  });
});
