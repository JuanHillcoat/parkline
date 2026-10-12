export interface SessionTokenService {
  /** `token` goes to the client; only `tokenHash` is stored. */
  issue(): { token: string; tokenHash: string };
  hash(token: string): string;
}
