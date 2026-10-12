import { createHash, randomBytes } from "node:crypto";
import type { SessionTokenService } from "../application/ports/session-token-service";

const TOKEN_BYTES = 32;

export class CryptoSessionTokenService implements SessionTokenService {
  issue(): { token: string; tokenHash: string } {
    const token = randomBytes(TOKEN_BYTES).toString("base64url");
    return { token, tokenHash: this.hash(token) };
  }

  hash(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }
}
