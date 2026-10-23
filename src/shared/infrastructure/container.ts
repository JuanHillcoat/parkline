/**
 * Composition root: the only place that wires adapters to use cases and the
 * only file allowed to import across modules' infrastructure.
 */
import type { Sql } from "postgres";
import { openDatabase } from "./connection-options";
import type { FleetDeps } from "../../fleet/application/deps";
import { ArchiveAssetType } from "../../fleet/application/use-cases/archive-asset-type";
import { ArchiveEquipment } from "../../fleet/application/use-cases/archive-equipment";
import { ArchiveSupplier } from "../../fleet/application/use-cases/archive-supplier";
import { AssignEquipment } from "../../fleet/application/use-cases/assign-equipment";
import { CorrectAssignment } from "../../fleet/application/use-cases/correct-assignment";
import { CreateAssetType } from "../../fleet/application/use-cases/create-asset-type";
import { CreateEquipment } from "../../fleet/application/use-cases/create-equipment";
import { CreateSupplier } from "../../fleet/application/use-cases/create-supplier";
import { EndAssignment } from "../../fleet/application/use-cases/end-assignment";
import { ListAssetTypes } from "../../fleet/application/use-cases/list-asset-types";
import { ListEquipment } from "../../fleet/application/use-cases/list-equipment";
import { ListEquipmentAssignments } from "../../fleet/application/use-cases/list-equipment-assignments";
import { ListSuppliers } from "../../fleet/application/use-cases/list-suppliers";
import { MoveEquipment } from "../../fleet/application/use-cases/move-equipment";
import { RenameSupplier } from "../../fleet/application/use-cases/rename-supplier";
import { ReplaceEquipment } from "../../fleet/application/use-cases/replace-equipment";
import { RestoreAssetType } from "../../fleet/application/use-cases/restore-asset-type";
import { RestoreEquipment } from "../../fleet/application/use-cases/restore-equipment";
import { RestoreSupplier } from "../../fleet/application/use-cases/restore-supplier";
import { UpdateAssetType } from "../../fleet/application/use-cases/update-asset-type";
import { UpdateEquipment } from "../../fleet/application/use-cases/update-equipment";
import { PostgresAssignmentDirectory } from "../../fleet/infrastructure/postgres-assignment-directory";
import { createPostgresFleetTx } from "../../fleet/infrastructure/postgres-fleet-tx";
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
import type { OrganizationDeps } from "../../organization/application/deps";
import { ArchiveBusinessUnit } from "../../organization/application/use-cases/archive-business-unit";
import { ArchiveOperation } from "../../organization/application/use-cases/archive-operation";
import { ArchiveSite } from "../../organization/application/use-cases/archive-site";
import { CreateBusinessUnit } from "../../organization/application/use-cases/create-business-unit";
import { CreateOperation } from "../../organization/application/use-cases/create-operation";
import { CreateSite } from "../../organization/application/use-cases/create-site";
import { ListBusinessUnits } from "../../organization/application/use-cases/list-business-units";
import { ListOperations } from "../../organization/application/use-cases/list-operations";
import { ListSites } from "../../organization/application/use-cases/list-sites";
import { RenameBusinessUnit } from "../../organization/application/use-cases/rename-business-unit";
import { RenameOperation } from "../../organization/application/use-cases/rename-operation";
import { RenameSite } from "../../organization/application/use-cases/rename-site";
import { RestoreBusinessUnit } from "../../organization/application/use-cases/restore-business-unit";
import { RestoreOperation } from "../../organization/application/use-cases/restore-operation";
import { RestoreSite } from "../../organization/application/use-cases/restore-site";
import { UpdateOperation } from "../../organization/application/use-cases/update-operation";
import { createPostgresOrganizationTx } from "../../organization/infrastructure/postgres-organization-tx";
import { PostgresOperationDirectory } from "../../organization/infrastructure/postgres-operation-directory";
import { PostgresScopeDirectory } from "../../organization/infrastructure/postgres-scope-directory";
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
  // Implemented by organization, handed to identity as the shared port only (ADR-0005).
  scopes: new PostgresScopeDirectory(sql),
});

const organizationDeps = (sql: Sql, options: ContainerOptions, accessPolicy: AccessPolicy): OrganizationDeps => ({
  unitOfWork: new PostgresUnitOfWork(sql, (handle) => {
    const audit = new PostgresAuditLog(handle);
    // Implemented by fleet, handed to organization as the shared port only (ADR-0005).
    const assignments = (tx: typeof handle) => new PostgresAssignmentDirectory(tx);
    return createPostgresOrganizationTx(handle, assignments, options.wrapAudit?.(audit) ?? audit);
  }),
  clock: new SystemClock(),
  ids: new UuidIdGenerator(),
  accessPolicy,
});

const organizationUseCases = (deps: OrganizationDeps) => ({
  createBusinessUnit: new CreateBusinessUnit(deps),
  createOperation: new CreateOperation(deps),
  createSite: new CreateSite(deps),
  renameBusinessUnit: new RenameBusinessUnit(deps),
  renameOperation: new RenameOperation(deps),
  renameSite: new RenameSite(deps),
  updateOperation: new UpdateOperation(deps),
  archiveBusinessUnit: new ArchiveBusinessUnit(deps),
  restoreBusinessUnit: new RestoreBusinessUnit(deps),
  archiveSite: new ArchiveSite(deps),
  restoreSite: new RestoreSite(deps),
  archiveOperation: new ArchiveOperation(deps),
  restoreOperation: new RestoreOperation(deps),
  listBusinessUnits: new ListBusinessUnits(deps),
  listOperations: new ListOperations(deps),
  listSites: new ListSites(deps),
});

const fleetDeps = (sql: Sql, options: ContainerOptions, accessPolicy: AccessPolicy): FleetDeps => ({
  unitOfWork: new PostgresUnitOfWork(sql, (handle) => {
    const audit = new PostgresAuditLog(handle);
    // Implemented by organization, handed to fleet as the shared port only (ADR-0005).
    const operations = (tx: typeof handle) => new PostgresOperationDirectory(tx);
    return createPostgresFleetTx(handle, operations, options.wrapAudit?.(audit) ?? audit);
  }),
  clock: new SystemClock(),
  ids: new UuidIdGenerator(),
  accessPolicy,
});

const assignmentUseCases = (deps: FleetDeps) => ({
  assignEquipment: new AssignEquipment(deps),
  correctAssignment: new CorrectAssignment(deps),
  endAssignment: new EndAssignment(deps),
  listEquipmentAssignments: new ListEquipmentAssignments(deps),
  moveEquipment: new MoveEquipment(deps),
  replaceEquipment: new ReplaceEquipment(deps),
});

const catalogUseCases = (deps: FleetDeps) => ({
  archiveAssetType: new ArchiveAssetType(deps),
  archiveEquipment: new ArchiveEquipment(deps),
  archiveSupplier: new ArchiveSupplier(deps),
  createAssetType: new CreateAssetType(deps),
  createEquipment: new CreateEquipment(deps),
  createSupplier: new CreateSupplier(deps),
  listAssetTypes: new ListAssetTypes(deps),
  listEquipment: new ListEquipment(deps),
  listSuppliers: new ListSuppliers(deps),
  renameSupplier: new RenameSupplier(deps),
  restoreAssetType: new RestoreAssetType(deps),
  restoreEquipment: new RestoreEquipment(deps),
  restoreSupplier: new RestoreSupplier(deps),
  updateAssetType: new UpdateAssetType(deps),
  updateEquipment: new UpdateEquipment(deps),
});

const fleetUseCases = (deps: FleetDeps) => ({ ...catalogUseCases(deps), ...assignmentUseCases(deps) });

const identityUseCases = (deps: IdentityDeps) => ({
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
});

export const createContainer = (sql: Sql, options: ContainerOptions = {}) => {
  const accessPolicy: AccessPolicy = new IdentityAccessPolicy();
  return {
    /** Cross-module authorization (ADR-0005); modules receive it instead of importing identity. */
    accessPolicy,
    organization: organizationUseCases(organizationDeps(sql, options, accessPolicy)),
    fleet: fleetUseCases(fleetDeps(sql, options, accessPolicy)),
    identity: identityUseCases(identityDeps(sql, options)),
  };
};

export type Container = ReturnType<typeof createContainer>;

type ContainerGlobal = { parklineContainer?: Container };
const containerGlobal = globalThis as ContainerGlobal;

/**
 * Process-wide container for the web app. It is memoized on `globalThis` so
 * that dev hot reloads reuse one connection pool. Import it only from `app/`.
 */
export const getContainer = (): Container => {
  containerGlobal.parklineContainer ??= createContainer(openDatabase(process.env));
  return containerGlobal.parklineContainer;
};
