import type { AccessPolicy, Actor } from "../../shared/domain/ports/access-policy";
import type { Assignment, AssignmentKind } from "../domain/assignment";
import type { Day } from "../domain/day";
import type { Equipment } from "../domain/entities";
import { positionOfAssignment } from "./assignment-support";
import { canReadFleet } from "./guards";

/** Where an equipment is now: names are mapped by the page from the organization lists. */
export type AssignmentSummary = {
  readonly operationId: string;
  readonly siteId: string;
  readonly businessUnitId: string;
  readonly kind: AssignmentKind;
  readonly validFrom: Day;
};

/** An equipment as the list shows it: its own fields plus its open assignment, or null when it has none. */
export type EquipmentListItem = Equipment & { readonly assignment: AssignmentSummary | null };

const summaryOf = (open: Assignment | undefined): AssignmentSummary | null =>
  open === undefined
    ? null
    : {
        operationId: open.operationId,
        siteId: open.siteId,
        businessUnitId: open.businessUnitId,
        kind: open.kind,
        validFrom: open.validFrom,
      };

/**
 * D6: an actor whose `catalog.read` is tenant-wide sees every equipment; any other actor sees only the
 * equipment whose OPEN assignment sits at a position its `catalog.read` covers (tenant, division,
 * operation or site). Equipment with no open assignment, and archived equipment (which never has one),
 * stay out of a scoped actor's list, so it cannot tell they exist.
 */
export const visibleEquipment = (
  policy: AccessPolicy,
  actor: Actor,
  rows: readonly Equipment[],
  open: readonly Assignment[],
): readonly EquipmentListItem[] => {
  const wide = canReadFleet(policy, actor);
  const openOf = new Map(open.map((assignment) => [assignment.equipmentId, assignment]));
  return rows.flatMap((row) => {
    const placed = openOf.get(row.id);
    const covered = placed !== undefined && policy.check(actor, "catalog.read", positionOfAssignment(placed)).ok;
    return wide || covered ? [{ ...row, assignment: summaryOf(placed) }] : [];
  });
};
