import type { PasswordHasher } from "../application/ports/password-hasher";

/** In-memory fake of `ScryptPasswordHasher`: fast and deterministic, never for production. */
const encode = (plain: string): string => `fake$${Buffer.from(plain).toString("base64")}`;

export class FakePasswordHasher implements PasswordHasher {
  verifyCalls = 0;

  hash(plain: string): Promise<string> {
    return Promise.resolve(encode(plain));
  }

  verify(plain: string, stored: string): Promise<boolean> {
    this.verifyCalls += 1;
    return Promise.resolve(stored === encode(plain));
  }
}
