import type { Session } from "../../domain/session";

export interface SessionRepository {
  add(session: Session): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<Session | null>;
  touch(tenantId: string, id: string, lastSeenAt: Date): Promise<void>;
  revoke(tenantId: string, id: string, at: Date): Promise<void>;
  revokeAllForUser(tenantId: string, userId: string, at: Date): Promise<void>;
}
