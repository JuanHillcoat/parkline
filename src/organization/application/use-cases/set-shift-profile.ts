import { NotFoundError, type DomainError } from "../../../shared/domain/domain-error";
import type { Actor } from "../../../shared/domain/ports/access-policy";
import { err, ok, type Result } from "../../../shared/domain/result";
import type { Operation } from "../../domain/entities";
import { parseShifts, setShiftProfile, type ShiftProfile } from "../../domain/shift-profile";
import { recordAudit } from "../audit";
import type { OrganizationDeps } from "../deps";
import { auditActor, whenActive } from "../guards";
import type { OrganizationTx } from "../ports/organization-tx";

export type SetShiftProfileInput = {
  readonly actor: Actor;
  readonly operationId: string;
  readonly shifts: string;
  readonly validFrom: string;
};

/** D5/D6: needs `catalog.write` over the operation. Returns the operation's whole history. */
export class SetShiftProfile {
  constructor(private readonly deps: OrganizationDeps) {}

  execute(input: SetShiftProfileInput): Promise<Result<readonly ShiftProfile[], DomainError>> {
    return whenActive(input.actor, () => this.deps.unitOfWork.run((tx) => this.set(tx, input)));
  }

  private async set(tx: OrganizationTx, input: SetShiftProfileInput): Promise<Result<readonly ShiftProfile[], DomainError>> {
    const { actor, operationId } = input;
    const operation = await tx.operations.findById(actor.tenantId, operationId);
    if (operation === null) return err(new NotFoundError("Operation", operationId));
    const position = { tenantId: actor.tenantId, businessUnitId: operation.businessUnitId, operationId };
    const role = this.deps.accessPolicy.check(actor, "catalog.write", position);
    if (!role.ok) return role;
    const shifts = parseShifts(input.shifts);
    if (!shifts.ok) return shifts;
    const before = await tx.shiftProfiles.listByOperation(actor.tenantId, operationId);
    const after = setShiftProfile(before, { operationId, shifts: shifts.value, validFrom: input.validFrom });
    if (!after.ok) return after;
    await tx.shiftProfiles.replaceForOperation(actor.tenantId, operationId, after.value);
    await this.audit(tx, actor, role.value, operation, { before, after: after.value });
    return ok(after.value);
  }

  private audit(
    tx: OrganizationTx,
    actor: Actor,
    role: string,
    operation: Operation,
    history: { readonly before: readonly ShiftProfile[]; readonly after: readonly ShiftProfile[] },
  ): Promise<void> {
    return recordAudit(tx, this.deps, {
      ...auditActor(actor, role),
      action: "organization.shift_profile.set",
      entityType: "operation",
      entityId: operation.id,
      businessUnitId: operation.businessUnitId,
      operationId: operation.id,
      ...history,
    });
  }
}
