import { err, ok, type Result } from "../../shared/domain/result";
import { InvalidNameError } from "./errors";

export const MAX_NAME_LENGTH = 120;

/** Trims the name; it must be non-empty and at most `MAX_NAME_LENGTH` characters. */
export const parseName = (raw: string): Result<string, InvalidNameError> => {
  const name = raw.trim();
  if (name === "") return err(new InvalidNameError("The name is required"));
  if (name.length > MAX_NAME_LENGTH) {
    return err(new InvalidNameError(`The name has at most ${String(MAX_NAME_LENGTH)} characters`));
  }
  return ok(name);
};

/** The comparison key of a name (D7): trimmed, inner whitespace collapsed, case-insensitive. */
export const nameKey = (name: string): string => name.trim().replace(/\s+/gu, " ").toLowerCase();
