/**
 * Composition root: the only place that wires adapters to use cases and the
 * only file allowed to import across modules' infrastructure.
 */
import postgres, { type Sql } from "postgres";
import type { IdentityDeps } from "../../identity/application/deps";
import { IdentityAccessPolicy } from "../../identity/application/identity-access-policy";
import type { PasswordHasher } from "../../identity/application/ports/password-hasher";
import { AssignRole } from "../../identity/application/use-cases/assign-role";
import { AuthenticateSession } from "../../identity/application/use-cases/authenticate-session";
import { ChangeUserRole } from "../../identity/application/use-cases/change-user-role";
import { CreateUser } from "../../identity/application/use-cases/create-user";
import { DeactivateUser } from "../../identity/application/use-cases/deactivate-user";
import { InstallTenantAdmin } from "../../identity/application/use-cases/install-tenant-admin";
import { ListUsers } from "../../identity/application/use-cases/list-users";
import { RevokeRole } from "../../identity/application/use-cases/revoke-role";
import { SignIn } from "../../identity/application/use-cases/sign-in";
import { SignOut } from "../../identity/application/use-cases/sign-out";
import { DEFAULT_SESSION_POLICY, type SessionPolicy } from "../../identity/domain/session";
import { CryptoSessionTokenService } from "../../identity/infrastructure/crypto-session-token-service";
import { createPostgresIdentityTx } from "../../identity/infrastructure/postgres-identity-tx";
import { ScryptPasswordHasher } from "../../identity/infrastructure/scrypt-password-hasher";
import type { AccessPolicy } from "../domain/ports/access-policy";
import type { AuditLog } from "../domain/ports/audit-log";
import { PostgresAuditLog } from "./postgres-audit-log";
import { PostgresUnitOfWork } from "./postgres-unit-of-work";
import { SystemClock } from "./system-clock";
import { UuidIdGenerator } from "./uuid-id-generator";

export type ContainerOptions = {
  readonly policy?: SessionPolicy;
  /** Tests use a low-cost hasher. */
  readonly hasher?: PasswordHasher;
  /** Tests use it to decorate the audit log, for example to inject failures. */
  readonly wrapAudit?: (inner: AuditLog) => AuditLog;
};

const identityDeps = (sql: Sql, options: ContainerOptions): IdentityDeps => ({
  unitOfWork: new PostgresUnitOfWork(sql, (handle) => {
    const audit = new PostgresAuditLog(handle);
    return createPostgresIdentityTx(handle, options.wrapAudit?.(audit) ?? audit);
  }),
  clock: new SystemClock(),
  ids: new UuidIdGenerator(),
  hasher: options.hasher ?? new ScryptPasswordHasher(),
  tokens: new CryptoSessionTokenService(),
  policy: options.policy ?? DEFAULT_SESSION_POLICY,
});

export const createContainer = (sql: Sql, options: ContainerOptions = {}) => {
  const deps = identityDeps(sql, options);
  return {
    /** Cross-module authorization (ADR-0005); modules receive it instead of importing identity. */
    accessPolicy: new IdentityAccessPolicy() satisfies AccessPolicy,
    identity: {
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
    },
  };
};

export type Container = ReturnType<typeof createContainer>;

type ContainerGlobal = { parklineContainer?: Container };
const containerGlobal = globalThis as ContainerGlobal;

const databaseUrl = (): string => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");
  return url;
};

/**
 * Process-wide container for the web app. It is memoized on `globalThis` so
 * that dev hot reloads reuse one connection pool. Import it only from `app/`.
 */
export const getContainer = (): Container => {
  containerGlobal.parklineContainer ??= createContainer(postgres(databaseUrl()));
  return containerGlobal.parklineContainer;
};
