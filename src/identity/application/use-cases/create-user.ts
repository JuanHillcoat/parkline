import type { DomainError } from "../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../shared/domain/result";
import { validatePassword } from "../../domain/password-policy";
import type { Role } from "../../domain/role";
import { createRoleAssignment, type RoleAssignment } from "../../domain/role-assignment";
import { createUser, type User } from "../../domain/user";
import { requirePermission, type ActorContext } from "../actor-context";
import { recordAudit } from "../audit";
import type { IdentityDeps } from "../deps";
import { EmailTakenError } from "../errors";
import { rolesSnapshot } from "../guards";
import type { IdentityTx } from "../ports/identity-tx";

export type CreateUserInput = {
  readonly actor: ActorContext;
  readonly email: string;
  readonly displayName: string;
  readonly password: string;
  readonly role?: Role;
};

type Plan = {
  readonly actor: ActorContext;
  readonly actorRole: Role;
  readonly user: User;
  readonly passwordHash: string;
  readonly assignment: RoleAssignment | null;
};

/** The admin sets the initial password; there is no email delivery in this slice. */
export class CreateUser {
  constructor(private readonly deps: IdentityDeps) {}

  async execute(input: CreateUserInput): Promise<Result<User, DomainError>> {
    const actorRole = requirePermission(input.actor, "user.create");
    if (!actorRole.ok) return actorRole;
    const password = validatePassword(input.password);
    if (!password.ok) return password;
    const prepared = this.prepare(input);
    if (!prepared.ok) return prepared;
    const passwordHash = await this.deps.hasher.hash(input.password);
    const plan: Plan = { ...prepared.value, actor: input.actor, actorRole: actorRole.value, passwordHash };
    return this.deps.unitOfWork.run((tx) => this.persist(tx, plan));
  }

  private prepare(
    input: CreateUserInput,
  ): Result<{ user: User; assignment: RoleAssignment | null }, DomainError> {
    const { tenantId } = input.actor.user;
    const { email, displayName } = input;
    const user = createUser({ id: this.deps.ids.next(), tenantId, email, displayName });
    if (!user.ok) return user;
    if (input.role === undefined) return ok({ user: user.value, assignment: null });
    const scope = { type: "tenant", id: tenantId } as const;
    const assignment = createRoleAssignment({ userId: user.value.id, role: input.role, scope });
    return assignment.ok ? ok({ user: user.value, assignment: assignment.value }) : assignment;
  }

  private async persist(tx: IdentityTx, plan: Plan): Promise<Result<User, DomainError>> {
    const { user, assignment, passwordHash } = plan;
    if ((await tx.users.findByEmail(user.tenantId, user.email)) !== null) return err(new EmailTakenError());
    if (!(await tx.users.add(user, passwordHash))) return err(new EmailTakenError());
    if (assignment !== null) await tx.assignments.add(user.tenantId, assignment);
    await recordAudit(tx, this.deps, {
      actorId: plan.actor.user.id,
      actorKind: "user",
      actorRole: plan.actorRole,
      action: "user.create",
      entityType: "user",
      entityId: user.id,
      tenantId: user.tenantId,
      after: { email: user.email, displayName: user.displayName, ...rolesSnapshot(assignment ? [assignment] : []) },
    });
    return ok(user);
  }
}
