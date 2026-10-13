import { err, ok, type Result } from "../../../shared/domain/result";
import { sessionRejection } from "../../domain/session";
import type { ActorContext } from "../actor-context";
import type { IdentityDeps } from "../deps";
import { UnauthenticatedError } from "../errors";
import type { IdentityTx } from "../ports/identity-tx";

export type AuthenticateInput = { readonly token: string };

/** Resolves a token to the actor. The only write is `touch`; nothing is audited. */
export class AuthenticateSession {
  constructor(private readonly deps: IdentityDeps) {}

  execute(input: AuthenticateInput): Promise<Result<ActorContext, UnauthenticatedError>> {
    const tokenHash = this.deps.tokens.hash(input.token);
    return this.deps.unitOfWork.run((tx) => this.resolve(tx, tokenHash));
  }

  private async resolve(
    tx: IdentityTx,
    tokenHash: string,
  ): Promise<Result<ActorContext, UnauthenticatedError>> {
    const { clock, policy } = this.deps;
    const session = await tx.sessions.findByTokenHash(tokenHash);
    if (session === null) return err(new UnauthenticatedError("unknown"));
    const now = clock.now();
    const rejection = sessionRejection(session, now, policy);
    if (rejection !== null) return err(new UnauthenticatedError(rejection));
    const user = await tx.users.findById(session.tenantId, session.userId);
    if (user === null || !user.active) return err(new UnauthenticatedError("inactive_user"));
    await tx.sessions.touch(session.tenantId, session.id, now);
    const assignments = await tx.assignments.listActiveByUser(user.tenantId, user.id);
    return ok({ user, assignments });
  }
}
