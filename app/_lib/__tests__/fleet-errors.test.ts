import { describe, expect, it } from "vitest";
import { ForbiddenError } from "../../../src/identity/domain/authorizer";
import {
  AlreadyArchivedError,
  AssignmentOverlapError,
  BatteryQuantityNotAllowedError,
  ArchivedError,
  HasActiveEquipmentError,
  HasOpenAssignmentError,
  InternalCodeTakenError,
  InvalidAssignmentKindError,
  InvalidAssignmentTargetError,
  InvalidBatteryKindError,
  InvalidBatteryQuantityError,
  InvalidDayError,
  InvalidInternalCodeError,
  InvalidMeterKindError,
  InvalidNameError,
  InvalidPeriodError,
  InvalidPreventiveIntervalError,
  InvalidTextError,
  InvalidYearError,
  NameTakenError,
  NoChangesError,
  NoOpenAssignmentError,
  NotArchivedError,
  OpenAssignmentError,
  OperationArchivedError,
  OutgoingChoiceRequiredError,
  ParentArchivedError,
  PreventiveIntervalNotAllowedError,
  ReasonRequiredError,
  ReasonTooLongError,
  SameEquipmentError,
  SameOperationError,
  SameSiteError,
  SiteArchivedError,
} from "../../../src/fleet/domain/errors";
import { NotFoundError } from "../../../src/shared/domain/domain-error";
import { copy } from "../copy";
import { GENERIC_ERROR, errorMessage } from "../messages";

const cases = [
  ["name_taken", new NameTakenError("suppliers_name_key")],
  ["internal_code_taken", new InternalCodeTakenError("equipments_code_key")],
  ["has_active_equipment", new HasActiveEquipmentError("Supplier still has 2 active equipment")],
  ["parent_archived", new ParentArchivedError("parent")],
  ["archived", new ArchivedError("Equipment e1 is archived")],
  ["already_archived", new AlreadyArchivedError("Equipment e1 is already archived")],
  ["not_archived", new NotArchivedError("Equipment e1 is not archived")],
  ["no_changes", new NoChangesError()],
  ["reason_required", new ReasonRequiredError()],
  ["reason_too_long", new ReasonTooLongError()],
  ["invalid_name", new InvalidNameError("bad name")],
  ["invalid_internal_code", new InvalidInternalCodeError("bad code")],
  ["invalid_meter_kind", new InvalidMeterKindError()],
  ["invalid_preventive_interval", new InvalidPreventiveIntervalError("bad interval")],
  ["preventive_interval_not_allowed", new PreventiveIntervalNotAllowedError()],
  ["invalid_year", new InvalidYearError("bad year")],
  ["invalid_battery_quantity", new InvalidBatteryQuantityError("bad batteries")],
  ["invalid_battery_kind", new InvalidBatteryKindError()],
  ["battery_quantity_not_allowed", new BatteryQuantityNotAllowedError()],
  ["invalid_text", new InvalidTextError("The brand has at most 120 characters", "brand")],
  ["invalid_day", new InvalidDayError("bad day")],
  ["invalid_period", new InvalidPeriodError("bad period")],
  ["invalid_assignment_kind", new InvalidAssignmentKindError()],
  ["outgoing_required", new OutgoingChoiceRequiredError()],
  ["same_equipment", new SameEquipmentError()],
  ["same_operation", new SameOperationError()],
  ["same_site", new SameSiteError()],
  ["invalid_assignment_target", new InvalidAssignmentTargetError()],
  ["assignment_overlap", new AssignmentOverlapError("period overlaps a1")],
  ["open_assignment_exists", new OpenAssignmentError("Equipment e1 already has an open assignment")],
  ["no_open_assignment", new NoOpenAssignmentError("Equipment e1 has no open assignment")],
  ["has_open_assignment", new HasOpenAssignmentError("Equipment e1 still has an open assignment")],
  ["operation_archived", new OperationArchivedError("Operation op1 is archived")],
  ["site_archived", new SiteArchivedError("Site s1 is archived")],
  ["not_found", new NotFoundError("Equipment", "e1")],
  ["forbidden", new ForbiddenError("catalog.write")],
] as const;

describe("errorMessage for the fleet codes", () => {
  it.each(cases)("maps %s to a Spanish message without internals", (code, error) => {
    expect(error.code).toBe(code);
    const message = errorMessage(error);
    expect(message).not.toBe(GENERIC_ERROR);
    expect(message).not.toBe(copy.errors.checkForm);
    expect(message).not.toMatch(/_key|bad |The brand|Equipment e1|Supplier still|period overlaps|Operation op1/);
  });

  it("uses a distinct message for each code", () => {
    const messages = cases.map(([, error]) => errorMessage(error));
    expect(new Set(messages).size).toBe(messages.length);
  });

  it("tells the user what to do first when a block applies", () => {
    expect(errorMessage(new HasActiveEquipmentError("x"))).toContain("Da de baja primero sus equipos");
    expect(errorMessage(new ParentArchivedError("x"))).toContain("proveedor");
  });

  it("tells the user what to do first when an assignment blocks", () => {
    expect(errorMessage(new HasOpenAssignmentError("x"))).toContain("Ciérrala primero");
    expect(errorMessage(new OpenAssignmentError("x"))).toContain("vigente");
  });

  it("names the offending field for invalid text", () => {
    expect(errorMessage(new InvalidTextError("x", "serialNumber"))).toContain("serie");
    expect(errorMessage(new InvalidTextError("x", "observations"))).toContain("observaciones");
  });
});

describe("parent_archived for the fleet module", () => {
  it("names the supplier and the asset type, not the organization rows", () => {
    const message = errorMessage(new ParentArchivedError("parent"));
    expect(message).toMatch(/proveedor/);
    expect(message).toMatch(/tipo de equipo/);
    expect(message).not.toMatch(/división|sitio/);
  });
});
