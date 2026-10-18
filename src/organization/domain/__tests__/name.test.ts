import { describe, expect, it } from "vitest";
import { InvalidNameError } from "../errors";
import { ACCENTED, MAX_NAME_LENGTH, PLAIN, nameKey, normalizeName, parseName } from "../name";

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

describe("parseName", () => {
  it("stores the normalized (uppercase) name", () => {
    expect(parseName("  Zona   Norte  ")).toEqual({ ok: true, value: "ZONA NORTE" });
    expect(parseName("bahía blanca")).toEqual({ ok: true, value: "BAHÍA BLANCA" });
    expect(parseName("MiXeD cAsE")).toEqual({ ok: true, value: "MIXED CASE" });
  });

  it("rejects an empty or blank name with a typed error", () => {
    for (const raw of ["", "   ", "\t\n"]) {
      const result = parseName(raw);
      expect(!result.ok && result.error).toBeInstanceOf(InvalidNameError);
      expect(!result.ok && result.error.code).toBe("invalid_name");
    }
  });

  it("rejects a name longer than the maximum and accepts one of exactly the maximum", () => {
    expect(parseName("a".repeat(MAX_NAME_LENGTH)).ok).toBe(true);
    expect(parseName("a".repeat(MAX_NAME_LENGTH + 1)).ok).toBe(false);
  });

  it("measures the length after normalization", () => {
    expect(parseName(`${"a".repeat(MAX_NAME_LENGTH)}   `).ok).toBe(true);
    expect(parseName(`${"a".repeat(MAX_NAME_LENGTH - 2)}   \t   b`).ok).toBe(true);
    expect(parseName(`${"a".repeat(MAX_NAME_LENGTH - 1)} b`).ok).toBe(false);
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

  it("does not crash on characters without a special rule", () => {
    expect(() => nameKey("Straße")).not.toThrow();
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
