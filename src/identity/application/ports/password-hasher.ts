export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  /** Returns false, never throws, for a wrong password or a malformed stored value. */
  verify(plain: string, stored: string): Promise<boolean>;
}
