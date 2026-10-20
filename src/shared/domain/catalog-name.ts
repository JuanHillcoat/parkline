import { err, ok, type Result } from "./result";

/** The longest stored name of any catalog row (organization and fleet). */
export const MAX_NAME_LENGTH = 120;

/**
 * Accent fold used by the comparison key. ONE explicit map, shared with SQL
 * (`organization_name_key`, migration 0006, and `fleet_name_key`, migration 0009),
 * applied to the UPPERCASED text:
 *   A with acute, grave, circumflex or diaeresis -> A   (likewise E, I, O, U)
 *   N with tilde and C with cedilla are different letters and are NOT folded.
 * Only these twenty uppercase letters are folded; anything else is left as is.
 */
/** The two parallel strings are exported only so a test can prove they stay aligned. */
export const ACCENTED = "ÁÀÂÄÉÈÊËÍÌÎÏÓÒÔÖÚÙÛÜ";
export const PLAIN = "AAAAEEEEIIIIOOOOUUUU";
const ACCENTED_LETTER = new RegExp(`[${ACCENTED}]`, "gu");

/** Trims, collapses inner whitespace runs to one space and uppercases (locale independent). Accents are kept. */
export const normalizeName = (raw: string): string => raw.trim().replace(/\s+/gu, " ").toUpperCase();

/**
 * The stored form of a catalog text (a name, an internal code): normalized, non-empty and at most
 * `maxLength` characters. The error is a plain message; each module maps it to its own typed error.
 */
export const parseNormalizedText = (raw: string, maxLength: number, label: string): Result<string, string> => {
  const text = normalizeName(raw);
  if (text === "") return err(`The ${label} is required`);
  if (text.length > maxLength) return err(`The ${label} has at most ${String(maxLength)} characters`);
  return ok(text);
};

/** The comparison key of a name: normalized, then accents folded with the map above. */
export const nameKey = (name: string): string =>
  normalizeName(name).replace(ACCENTED_LETTER, (letter) => PLAIN.charAt(ACCENTED.indexOf(letter)));
