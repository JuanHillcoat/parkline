import { InMemoryAuditLog } from "../../../../shared/infrastructure/in-memory-audit-log";
import { FixedClock } from "../../../../shared/infrastructure/fixed-clock";
import { SequentialIdGenerator } from "../../../../shared/infrastructure/sequential-id-generator";
import { ok } from "../../../../shared/domain/result";
import type { Role } from "../../../domain/role";
import { DEFAULT_SESSION_POLICY, type SessionPolicy } from "../../../domain/session";
import type { Tenant } from "../../../domain/tenant";
import type { User } from "../../../domain/user";
import { CryptoSessionTokenService } from "../../../infrastructure/crypto-session-token-service";
import { FakePasswordHasher } from "../../../infrastructure/fake-password-hasher";
import { InMemoryIdentityStore } from "../../../infrastructure/in-memory-identity-store";
import type { ActorContext } from "../../actor-context";
import type { IdentityDeps } from "../../deps";
import { AssignRole } from "../../use-cases/assign-role";
import { AuthenticateSession } from "../../use-cases/authenticate-session";
import { ChangeUserRole } from "../../use-cases/change-user-role";
import { CreateUser } from "../../use-cases/create-user";
import { DeactivateUser } from "../../use-cases/deactivate-user";
import { InstallTenantAdmin } from "../../use-cases/install-tenant-admin";
import { ListUsers } from "../../use-cases/list-users";
import { RevokeRole } from "../../use-cases/revoke-role";
import { SignIn } from "../../use-cases/sign-in";
import { SignOut } from "../../use-cases/sign-out";

export const PASSWORD = "correct-horse-battery";
export const START = new Date("2026-01-01T09:00:00Z");

export const createHarness = (policy: SessionPolicy = DEFAULT_SESSION_POLICY) => {
  const audit = new InMemoryAuditLog();
  const store = new InMemoryIdentityStore(audit);
  const clock = new FixedClock(START);
  const hasher = new FakePasswordHasher();
  const deps: IdentityDeps = {
    unitOfWork: store.unitOfWork(),
    clock,
    ids: new SequentialIdGenerator("id"),
    hasher,
    tokens: new CryptoSessionTokenService(),
    policy,
  };

  const actorOf = async (user: User): Promise<ActorContext> => {
    const assignments = await store.read((tx) => tx.assignments.listActiveByUser(user.tenantId, user.id));
    return { user, assignments };
  };

  const installTenantA = async (): Promise<{ tenant: Tenant; admin: ActorContext }> => {
    const result = await new InstallTenantAdmin(deps).execute({
      tenantName: "Tenant A",
      email: "admin@example.test",
      displayName: "Admin A",
      password: PASSWORD,
    });
    if (!result.ok) throw result.error;
    return { tenant: result.value.tenant, admin: await actorOf(result.value.user) };
  };

  const addUser = async (admin: ActorContext, email: string, role?: Role): Promise<User> => {
    const created = await new CreateUser(deps).execute({
      actor: admin,
      email,
      displayName: email,
      password: PASSWORD,
      role,
    });
    if (!created.ok) throw created.error;
    return created.value;
  };

  const seedTenantB = async (): Promise<User> => {
    const user: User = {
      id: "user-b",
      tenantId: "tenant-b",
      email: "bia@example.test",
      displayName: "Bia B",
      active: true,
    };
    await deps.unitOfWork.run(async (tx) => {
      await tx.tenants.add({ id: "tenant-b", name: "Tenant B" });
      await tx.users.add(user, await hasher.hash(PASSWORD));
      const scope = { type: "tenant", id: "tenant-b" } as const;
      await tx.assignments.add("tenant-b", { userId: user.id, role: "viewer", scope, active: true });
      return ok(undefined);
    });
    return user;
  };

  const forceInactive = async (user: User): Promise<void> => {
    await deps.unitOfWork.run(async (tx) => {
      await tx.users.setActive(user.tenantId, user.id, false);
      return ok(undefined);
    });
  };

  const auditOf = (action: string) => audit.entries.filter((entry) => entry.action === action);

  return {
    audit,
    store,
    clock,
    hasher,
    deps,
    actorOf,
    auditOf,
    installTenantA,
    addUser,
    seedTenantB,
    forceInactive,
    install: new InstallTenantAdmin(deps),
    signIn: new SignIn(deps),
    signOut: new SignOut(deps),
    authenticate: new AuthenticateSession(deps),
    createUser: new CreateUser(deps),
    assignRole: new AssignRole(deps),
    revokeRole: new RevokeRole(deps),
    deactivateUser: new DeactivateUser(deps),
    listUsers: new ListUsers(deps),
    changeUserRole: new ChangeUserRole(deps),
  };
};

export type Harness = ReturnType<typeof createHarness>;
