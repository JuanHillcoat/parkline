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
import { resolveScope, scopeNames, type RawScope, type ResolvedScope } from "../scope-rules";

export type CreateUserInput = {
  readonly actor: ActorContext;
  readonly email: string;
  readonly displayName: string;
  readonly password: string;
  readonly role?: Role;
  /** Where the role applies; defaults to the whole tenant. Ignored when there is no role. */
  readonly scope?: RawScope;
};

type Plan = {
  readonly actor: ActorContext;
  readonly actorRole: Role;
  readonly user: User;
  readonly passwordHash: string;
  readonly assignment: RoleAssignment | null;
  readonly scopeNames: ReadonlyMap<string, string>;
};

/** The admin sets the initial password; there is no email delivery in this slice. */
export class CreateUser {
  constructor(private readonly deps: IdentityDeps) {}

  async execute(input: CreateUserInput): Promise<Result<User, DomainError>> {
    const actorRole = requirePermission(input.actor, "user.create");
    if (!actorRole.ok) return actorRole;
    const password = validatePassword(input.password);
    if (!password.ok) return password;
    const scope = await this.scopeOf(input);
    if (!scope.ok) return scope;
    const prepared = this.prepare(input, scope.value);
    if (!prepared.ok) return prepared;
    const passwordHash = await this.deps.hasher.hash(input.password);
    const plan: Plan = { ...prepared.value, actor: input.actor, actorRole: actorRole.value, passwordHash };
    return this.deps.unitOfWork.run((tx) => this.persist(tx, plan));
  }

  private async scopeOf(input: CreateUserInput): Promise<Result<ResolvedScope | null, DomainError>> {
    if (input.role === undefined) return ok(null);
    return resolveScope(this.deps, input.actor.user.tenantId, input.role, input.scope);
  }

  private prepare(
    input: CreateUserInput,
    resolved: ResolvedScope | null,
  ): Result<Pick<Plan, "user" | "assignment" | "scopeNames">, DomainError> {
    const { tenantId } = input.actor.user;
    const { email, displayName } = input;
    const user = createUser({ id: this.deps.ids.next(), tenantId, email, displayName });
    if (!user.ok) return user;
    if (input.role === undefined || resolved === null) {
      return ok({ user: user.value, assignment: null, scopeNames: new Map() });
    }
    const assignment = createRoleAssignment({ userId: user.value.id, role: input.role, scope: resolved.scope });
    if (!assignment.ok) return assignment;
    return ok({ user: user.value, assignment: assignment.value, scopeNames: scopeNames(resolved) });
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
      after: { email: user.email, displayName: user.displayName, ...rolesSnapshot(assignment ? [assignment] : [], plan.scopeNames) },
    });
    return ok(user);
  }
}
