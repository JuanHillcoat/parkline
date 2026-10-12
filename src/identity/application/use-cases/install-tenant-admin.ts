import type { DomainError } from "../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../shared/domain/result";
import { validatePassword } from "../../domain/password-policy";
import { createRoleAssignment } from "../../domain/role-assignment";
import { createTenant, type Tenant } from "../../domain/tenant";
import { createUser, type User } from "../../domain/user";
import { recordAudit } from "../audit";
import type { IdentityDeps } from "../deps";
import { TenantAlreadyInstalledError } from "../errors";
import type { IdentityTx } from "../ports/identity-tx";

export type InstallInput = {
  readonly tenantName: string;
  readonly email: string;
  readonly displayName: string;
  readonly password: string;
};

export type InstalledAdmin = { readonly tenant: Tenant; readonly user: User };

/** Bootstrap command: creates the single tenant and its first administrator. No authorization. */
export class InstallTenantAdmin {
  constructor(private readonly deps: IdentityDeps) {}

  async execute(input: InstallInput): Promise<Result<InstalledAdmin, DomainError>> {
    const built = this.build(input);
    if (!built.ok) return built;
    const passwordHash = await this.deps.hasher.hash(input.password);
    return this.deps.unitOfWork.run((tx) => this.persist(tx, built.value, passwordHash));
  }

  private build(input: InstallInput): Result<InstalledAdmin, DomainError> {
    const password = validatePassword(input.password);
    if (!password.ok) return password;
    const tenant = createTenant({ id: this.deps.ids.next(), name: input.tenantName });
    if (!tenant.ok) return tenant;
    const { email, displayName } = input;
    const user = createUser({ id: this.deps.ids.next(), tenantId: tenant.value.id, email, displayName });
    if (!user.ok) return user;
    return ok({ tenant: tenant.value, user: user.value });
  }

  private async persist(
    tx: IdentityTx,
    { tenant, user }: InstalledAdmin,
    passwordHash: string,
  ): Promise<Result<InstalledAdmin, DomainError>> {
    if ((await tx.tenants.findSingle()) !== null) return err(new TenantAlreadyInstalledError());
    const scope = { type: "tenant", id: tenant.id } as const;
    const assignment = createRoleAssignment({ userId: user.id, role: "admin", scope });
    if (!assignment.ok) return assignment;
    await tx.tenants.add(tenant);
    await tx.users.add(user, passwordHash);
    await tx.assignments.add(tenant.id, assignment.value);
    await this.audit(tx, tenant, user);
    return ok({ tenant, user });
  }

  private audit(tx: IdentityTx, tenant: Tenant, user: User): Promise<void> {
    return recordAudit(tx, this.deps, {
      actorId: "install",
      actorKind: "system",
      actorRole: "system",
      action: "identity.install",
      entityType: "tenant",
      entityId: tenant.id,
      tenantId: tenant.id,
      after: { tenantName: tenant.name, adminUserId: user.id },
      origin: "job",
    });
  }
}
