import { MAX_NAME_LENGTH, parseNormalizedText } from "../../shared/domain/catalog-name";
import { mapErr, type Result } from "../../shared/domain/result";
import { InvalidNameError } from "./errors";

// The normalization and the comparison key are shared with the fleet module (shared kernel).
export { ACCENTED, MAX_NAME_LENGTH, PLAIN, nameKey, normalizeName } from "../../shared/domain/catalog-name";

/** The stored form of a name: normalized, non-empty and at most `MAX_NAME_LENGTH` characters. */
export const parseName = (raw: string): Result<string, InvalidNameError> =>
  mapErr(parseNormalizedText(raw, MAX_NAME_LENGTH, "name"), (message) => new InvalidNameError(message));
