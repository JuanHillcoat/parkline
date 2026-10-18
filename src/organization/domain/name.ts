import { err, ok, type Result } from "../../shared/domain/result";
import { InvalidNameError } from "./errors";

export const MAX_NAME_LENGTH = 120;

/**
 * Accent fold used by the comparison key (D7). ONE explicit map, shared with
 * SQL (`organization_name_key`, migration 0006), applied to the UPPERCASED name:
 *   A with acute, grave, circumflex or diaeresis -> A   (likewise E, I, O, U)
 *   N with tilde and C with cedilla are different letters and are NOT folded.
 * Only these twenty uppercase letters are folded; anything else is left as is.
 */
const ACCENTED = "ÁÀÂÄÉÈÊËÍÌÎÏÓÒÔÖÚÙÛÜ";
const PLAIN = "AAAAEEEEIIIIOOOOUUUU";
const ACCENTED_LETTER = new RegExp(`[${ACCENTED}]`, "gu");

/** Trims, collapses inner whitespace runs to one space and uppercases (locale independent). Accents are kept. */
export const normalizeName = (raw: string): string => raw.trim().replace(/\s+/gu, " ").toUpperCase();

/** The stored form of a name: normalized, non-empty and at most `MAX_NAME_LENGTH` characters. */
export const parseName = (raw: string): Result<string, InvalidNameError> => {
  const name = normalizeName(raw);
  if (name === "") return err(new InvalidNameError("The name is required"));
  if (name.length > MAX_NAME_LENGTH) {
    return err(new InvalidNameError(`The name has at most ${String(MAX_NAME_LENGTH)} characters`));
  }
  return ok(name);
};

/** The comparison key of a name (D7): normalized, then accents folded with the map above. */
export const nameKey = (name: string): string =>
  normalizeName(name).replace(ACCENTED_LETTER, (letter) => PLAIN.charAt(ACCENTED.indexOf(letter)));
