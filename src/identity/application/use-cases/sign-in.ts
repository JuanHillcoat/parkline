import { err, ok, type Result } from "../../../shared/domain/result";
import type { RoleAssignment } from "../../domain/role-assignment";
import type { Session } from "../../domain/session";
import { normalizeEmail, type User } from "../../domain/user";
import { recordAudit } from "../audit";
import type { IdentityDeps } from "../deps";
import { InvalidCredentialsError } from "../errors";
import type { IdentityTx } from "../ports/identity-tx";
import type { StoredUser } from "../ports/user-repository";

export type SignInInput = { readonly email: string; readonly password: string };

export type SignInResult = {
  readonly token: string;
  readonly expiresAt: Date;
  readonly user: User;
  readonly assignments: readonly RoleAssignment[];
};

const TIMING_PASSWORD = "parkline-timing-equalizer";

/**
 * A failed sign-in must still persist its audit entry. The unit of work rolls
 * back on an err result, so the rejection is modelled as a committed `ok(null)`
 * inside the transaction and mapped to the generic error only after commit.
 * Only a thrown infrastructure failure rolls the audit back.
 */
export class SignIn {
  private dummyHash: Promise<string> | null = null;

  constructor(private readonly deps: IdentityDeps) {}

  async execute(input: SignInInput): Promise<Result<SignInResult, InvalidCredentialsError>> {
    const outcome = await this.deps.unitOfWork.run((tx) => this.attempt(tx, input));
    return outcome.ok && outcome.value !== null ? ok(outcome.value) : err(new InvalidCredentialsError());
  }

  private async attempt(tx: IdentityTx, input: SignInInput): Promise<Result<SignInResult | null, never>> {
    const tenant = await tx.tenants.findSingle();
    const stored = tenant ? await tx.users.findByEmail(tenant.id, normalizeEmail(input.email)) : null;
    const user = await this.checkCredentials(stored, input.password);
    if (tenant === null) return ok(null);
    if (user === null) {
      await this.auditFailure(tx, tenant.id, stored?.user.id ?? null);
      return ok(null);
    }
    return ok(await this.open(tx, tenant.id, user));
  }

  /** Always runs one verify, against a dummy hash when the user is unknown, to equalize timing. */
  private async checkCredentials(stored: StoredUser | null, password: string): Promise<User | null> {
    const hash = stored?.passwordHash ?? (await this.dummy());
    const matches = await this.deps.hasher.verify(password, hash);
    return stored !== null && matches && stored.user.active ? stored.user : null;
  }

  private dummy(): Promise<string> {
    this.dummyHash ??= this.deps.hasher.hash(TIMING_PASSWORD);
    return this.dummyHash;
  }

  private async open(tx: IdentityTx, tenantId: string, user: User): Promise<SignInResult> {
    const assignments = await tx.assignments.listActiveByUser(tenantId, user.id);
    const { token, session } = this.newSession(tenantId, user.id);
    await tx.sessions.add(session);
    await recordAudit(tx, this.deps, {
      actorId: user.id,
      actorKind: "user",
      actorRole: assignments.map((a) => a.role).join(",") || "none",
      action: "auth.sign_in",
      entityType: "session",
      entityId: session.id,
      tenantId,
    });
    return { token, expiresAt: session.expiresAt, user, assignments };
  }

  /** Only the token hash is stored; the token goes back to the caller once. */
  private newSession(tenantId: string, userId: string): { token: string; session: Session } {
    const { clock, ids, tokens, policy } = this.deps;
    const issued = tokens.issue();
    const now = clock.now();
    const expiresAt = new Date(now.getTime() + policy.absoluteSeconds * 1000);
    const session = {
      id: ids.next(),
      tenantId,
      userId,
      tokenHash: issued.tokenHash,
      createdAt: now,
      lastSeenAt: now,
      expiresAt,
      revokedAt: null,
    };
    return { token: issued.token, session };
  }

  /** Never stores the attempted email or password. */
  private auditFailure(tx: IdentityTx, tenantId: string, userId: string | null): Promise<void> {
    return recordAudit(tx, this.deps, {
      actorId: userId ?? "anonymous",
      actorKind: userId === null ? "system" : "user",
      actorRole: "anonymous",
      action: "auth.sign_in_failed",
      entityType: "user",
      entityId: userId ?? "anonymous",
      tenantId,
    });
  }
}
