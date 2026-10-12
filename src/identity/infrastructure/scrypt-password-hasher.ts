import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { promisify } from "node:util";
import type { PasswordHasher } from "../application/ports/password-hasher";

export type ScryptParams = { readonly N: number; readonly r: number; readonly p: number };

const scryptAsync = promisify<string, Buffer, number, ScryptOptions, Buffer>(scrypt);

const PRODUCTION_PARAMS: ScryptParams = { N: 2 ** 15, r: 8, p: 1 };
const SALT_BYTES = 16;
const KEY_BYTES = 32;
const PREFIX = "scrypt";
// Upper bounds applied to stored parameters so a tampered value cannot exhaust memory.
const MAX_PARAMS: ScryptParams = { N: 2 ** 20, r: 32, p: 16 };

const derive = (plain: string, salt: Buffer, params: ScryptParams): Promise<Buffer> => {
  const options: ScryptOptions = { ...params, maxmem: 128 * params.N * params.r * 2 + 1024 * 1024 };
  return scryptAsync(plain.normalize("NFKC"), salt, KEY_BYTES, options);
};

const isPositiveInt = (value: number, max: number): boolean =>
  Number.isInteger(value) && value > 0 && value <= max;

const parse = (stored: string): { params: ScryptParams; salt: Buffer; hash: Buffer } | null => {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== PREFIX) return null;
  const [N, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  const valid =
    isPositiveInt(N, MAX_PARAMS.N) && isPositiveInt(r, MAX_PARAMS.r) && isPositiveInt(p, MAX_PARAMS.p);
  const salt = Buffer.from(parts[4] ?? "", "base64");
  const hash = Buffer.from(parts[5] ?? "", "base64");
  if (!valid || salt.length === 0 || hash.length === 0) return null;
  return { params: { N, r, p }, salt, hash };
};

export class ScryptPasswordHasher implements PasswordHasher {
  constructor(private readonly params: ScryptParams = PRODUCTION_PARAMS) {}

  async hash(plain: string): Promise<string> {
    const salt = randomBytes(SALT_BYTES);
    const key = await derive(plain, salt, this.params);
    const { N, r, p } = this.params;
    return [PREFIX, N, r, p, salt.toString("base64"), key.toString("base64")].join("$");
  }

  async verify(plain: string, stored: string): Promise<boolean> {
    const parsed = parse(stored);
    if (parsed === null) return false;
    try {
      const key = await derive(plain, parsed.salt, parsed.params);
      return key.length === parsed.hash.length && timingSafeEqual(key, parsed.hash);
    } catch {
      return false;
    }
  }
}
