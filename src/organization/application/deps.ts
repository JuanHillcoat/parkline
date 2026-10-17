import type { AccessPolicy } from "../../shared/domain/ports/access-policy";
import type { Clock } from "../../shared/domain/ports/clock";
import type { IdGenerator } from "../../shared/domain/ports/id-generator";
import type { UnitOfWork } from "../../shared/domain/ports/unit-of-work";
import type { OrganizationTx } from "./ports/organization-tx";

export type OrganizationDeps = {
  readonly unitOfWork: UnitOfWork<OrganizationTx>;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  /** Cross-module authorization (ADR-0005); implemented by identity, wired by the container. */
  readonly accessPolicy: AccessPolicy;
};
