import { ok, type Result } from "../../../shared/domain/result";
import { recordAudit } from "../audit";
import type { IdentityDeps } from "../deps";
import type { IdentityTx } from "../ports/identity-tx";

export type SignOutInput = { readonly token: string };

/** Idempotent: an unknown, already revoked or expired token is a no-op and is not audited. */
export class SignOut {
  constructor(private readonly deps: IdentityDeps) {}

  execute(input: SignOutInput): Promise<Result<void, never>> {
    const tokenHash = this.deps.tokens.hash(input.token);
    return this.deps.unitOfWork.run((tx) => this.revoke(tx, tokenHash));
  }

  private async revoke(tx: IdentityTx, tokenHash: string): Promise<Result<void, never>> {
    const session = await tx.sessions.findByTokenHash(tokenHash);
    const now = this.deps.clock.now();
    if (session === null || session.revokedAt !== null || session.expiresAt <= now) {
      return ok(undefined);
    }
    const { tenantId, userId, id } = session;
    await tx.sessions.revoke(tenantId, id, now);
    const assignments = await tx.assignments.listActiveByUser(tenantId, userId);
    await recordAudit(tx, this.deps, {
      actorId: userId,
      actorKind: "user",
      actorRole: assignments.map((a) => a.role).join(",") || "none",
      action: "auth.sign_out",
      entityType: "session",
      entityId: id,
      tenantId,
    });
    return ok(undefined);
  }
}
