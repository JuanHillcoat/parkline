import { DomainError } from "./domain-error";
import { err, ok, type Result } from "./result";

export const DEFAULT_CURRENCY = "ARS";

export type RoundingMode = "floor" | "ceil" | "down" | "half-up" | "half-even";

export class InvalidAmountError extends DomainError {
  readonly code: string = "invalid_amount";
}

export class CurrencyMismatchError extends DomainError {
  readonly code: string = "currency_mismatch";

  constructor(left: string, right: string) {
    super(`Cannot combine ${left} with ${right}`);
  }
}

export class InvalidAllocationError extends DomainError {
  readonly code: string = "invalid_allocation";
}

const AMOUNT_PATTERN = /^(-?)(\d+)(?:\.(\d{1,2}))?$/;
const FACTOR_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

const abs = (n: bigint): bigint => (n < 0n ? -n : n);

/** Divides `n` by a positive `d`, rounding the quotient with an explicit mode. */
const divideRounded = (n: bigint, d: bigint, mode: RoundingMode): bigint => {
  const quotient = n / d;
  const remainder = n % d;
  if (remainder === 0n) return quotient;
  const away = n < 0n ? quotient - 1n : quotient + 1n;
  const twice = abs(remainder) * 2n;
  switch (mode) {
    case "down":
      return quotient;
    case "floor":
      return n < 0n ? away : quotient;
    case "ceil":
      return n < 0n ? quotient : away;
    case "half-up":
      return twice >= d ? away : quotient;
    case "half-even":
      return twice > d || (twice === d && quotient % 2n !== 0n) ? away : quotient;
  }
};

const parseFactor = (factor: string | number): Result<[bigint, bigint], InvalidAmountError> => {
  if (typeof factor === "number") {
    return Number.isSafeInteger(factor)
      ? ok([BigInt(factor), 1n])
      : err(new InvalidAmountError("Numeric factors must be integers; pass decimals as strings"));
  }
  const match = FACTOR_PATTERN.exec(factor);
  if (!match) return err(new InvalidAmountError(`Invalid factor "${factor}"`));
  const [, sign = "", whole = "", fraction = ""] = match;
  const numerator = BigInt(`${sign}${whole}${fraction}`);
  return ok([numerator, 10n ** BigInt(fraction.length)]);
};

const validateWeights = (weights: readonly number[]): InvalidAllocationError | null => {
  const valid = weights.length > 0 && weights.every((w) => Number.isSafeInteger(w) && w >= 0);
  if (!valid) return new InvalidAllocationError("Weights must be non-negative integers");
  return weights.some((w) => w > 0) ? null : new InvalidAllocationError("Weights sum to zero");
};

/** Largest-remainder split of a non-negative total; ties go to the earliest part. */
const splitProportionally = (total: bigint, weights: readonly number[]): bigint[] => {
  const sum = weights.reduce((acc, w) => acc + BigInt(w), 0n);
  const shares = weights.map((w) => (total * BigInt(w)) / sum);
  const remainders = weights.map((w, index) => ({ index, rest: (total * BigInt(w)) % sum }));
  remainders.sort((a, b) => (a.rest === b.rest ? a.index - b.index : a.rest > b.rest ? -1 : 1));
  const leftover = Number(total - shares.reduce((acc, s) => acc + s, 0n));
  for (const { index } of remainders.slice(0, leftover)) shares[index] = (shares[index] ?? 0n) + 1n;
  return shares;
};

/** Immutable monetary amount stored as integer minor units (two decimals). */
export class Money {
  private constructor(
    readonly minorUnits: bigint,
    readonly currency: string,
  ) {}

  static zero(currency: string = DEFAULT_CURRENCY): Money {
    return new Money(0n, currency);
  }

  static fromMinorUnits(
    minorUnits: bigint,
    currency: string = DEFAULT_CURRENCY,
  ): Result<Money, InvalidAmountError> {
    if (!CURRENCY_PATTERN.test(currency)) {
      return err(new InvalidAmountError(`Invalid currency code "${currency}"`));
    }
    return ok(new Money(minorUnits, currency));
  }

  /** Parses a plain decimal string with at most two decimals, e.g. "1234.50". */
  static parse(amount: string, currency: string = DEFAULT_CURRENCY): Result<Money, InvalidAmountError> {
    const match = AMOUNT_PATTERN.exec(amount);
    if (!match) return err(new InvalidAmountError(`Invalid amount "${amount}"`));
    const [, sign = "", whole = "", fraction = ""] = match;
    const minor = BigInt(`${sign}${whole}${fraction.padEnd(2, "0")}`);
    return Money.fromMinorUnits(minor, currency);
  }

  add(other: Money): Result<Money, CurrencyMismatchError> {
    return this.combine(other, other.minorUnits);
  }

  subtract(other: Money): Result<Money, CurrencyMismatchError> {
    return this.combine(other, -other.minorUnits);
  }

  /** Multiplies by an integer or a decimal string factor, rounding with `mode`. */
  multiply(factor: string | number, mode: RoundingMode): Result<Money, InvalidAmountError> {
    const parsed = parseFactor(factor);
    if (!parsed.ok) return parsed;
    const [numerator, denominator] = parsed.value;
    const minor = divideRounded(this.minorUnits * numerator, denominator, mode);
    return ok(new Money(minor, this.currency));
  }

  /** Splits the amount proportionally to `weights` (e.g. days); the parts sum exactly to the total. */
  allocateByDays(weights: readonly number[]): Result<Money[], InvalidAllocationError> {
    const problem = validateWeights(weights);
    if (problem) return err(problem);
    const sign = this.minorUnits < 0n ? -1n : 1n;
    const shares = splitProportionally(abs(this.minorUnits), weights);
    return ok(shares.map((share) => new Money(share * sign, this.currency)));
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.minorUnits === other.minorUnits;
  }

  toDecimalString(): string {
    const sign = this.minorUnits < 0n ? "-" : "";
    const digits = abs(this.minorUnits).toString().padStart(3, "0");
    return `${sign}${digits.slice(0, -2)}.${digits.slice(-2)}`;
  }

  format(): string {
    return `${this.currency} ${this.toDecimalString()}`;
  }

  private combine(other: Money, delta: bigint): Result<Money, CurrencyMismatchError> {
    if (other.currency !== this.currency) {
      return err(new CurrencyMismatchError(this.currency, other.currency));
    }
    return ok(new Money(this.minorUnits + delta, this.currency));
  }
}
