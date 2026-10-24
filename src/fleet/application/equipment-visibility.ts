import type { FleetTx } from "./ports/fleet-tx";
import type { AccessPolicy, Actor } from "../../shared/domain/ports/access-policy";
import type { Assignment, AssignmentKind } from "../domain/assignment";
import type { Day } from "../domain/day";
import type { Equipment } from "../domain/entities";
import type { MeterKind } from "../domain/values";
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

/** The supplier and asset type of an equipment by name: a scoped reader cannot read those lists. */
export type EquipmentNames = {
  readonly supplier: { readonly id: string; readonly name: string };
  readonly assetType: { readonly id: string; readonly name: string; readonly meterKind: MeterKind };
};

/**
 * An equipment as the list shows it: its own fields, the names of its supplier and asset type and its open
 * assignment, or null when it has none.
 */
export type EquipmentListItem = Equipment &
  EquipmentNames & {
    readonly assignment: AssignmentSummary | null;
    /** The sha256 of its image, or null without one. The bytes are never loaded with a list. */
    readonly imageHash: string | null;
  };

/** The equipment the actor may see, before the names and the assignment summary are attached. */
export type VisibleEquipment = Equipment & { readonly assignment: AssignmentSummary | null };

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
): readonly VisibleEquipment[] => {
  const wide = canReadFleet(policy, actor);
  const openOf = new Map(open.map((assignment) => [assignment.equipmentId, assignment]));
  return rows.flatMap((row) => {
    const placed = openOf.get(row.id);
    const covered = placed !== undefined && policy.check(actor, "catalog.read", positionOfAssignment(placed)).ok;
    return wide || covered ? [{ ...row, assignment: summaryOf(placed) }] : [];
  });
};

/**
 * The one equipment the actor may see, or null when it is missing or out of the actor's reach (the two are
 * indistinguishable). Used by every by-id read so they all apply the same D6 rule.
 */
export const findVisibleEquipment = async (
  tx: FleetTx,
  policy: AccessPolicy,
  actor: Actor,
  id: string,
): Promise<VisibleEquipment | null> => {
  const row = await tx.equipment.findById(actor.tenantId, id);
  const open = row === null ? null : await tx.assignments.findOpen(actor.tenantId, id);
  const [visible] = row === null ? [] : visibleEquipment(policy, actor, [row], open === null ? [] : [open]);
  return visible ?? null;
};
