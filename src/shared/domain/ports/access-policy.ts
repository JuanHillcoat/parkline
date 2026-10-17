import type { DomainError } from "../domain-error";
import type { Result } from "../result";

/**
 * One role granted to the actor over a node of the hierarchy. All fields are
 * opaque strings here: the shared kernel does not know the roles or scope types,
 * only the module that implements `AccessPolicy` (identity) interprets them.
 */
export type Grant = {
  readonly role: string;
  readonly scopeType: string;
  readonly scopeId: string;
};

/**
 * The authenticated caller as other modules see it. The grants travel with the
 * actor (loaded once at authentication) so a check needs no extra query.
 */
export type Actor = {
  readonly userId: string;
  readonly tenantId: string;
  readonly active: boolean;
  readonly grants: readonly Grant[];
};

/** Where a resource sits in the hierarchy. Levels it does not belong to are omitted. */
export type ResourcePosition = {
  readonly tenantId: string;
  readonly businessUnitId?: string;
  readonly operationId?: string;
  readonly siteId?: string;
};

/**
 * Cross-module authorization. Returns the role that granted `permission` (the
 * audit entry's `actorRole`) or a typed denial.
 */
export interface AccessPolicy {
  check(actor: Actor, permission: string, resource: ResourcePosition): Result<string, DomainError>;
}
