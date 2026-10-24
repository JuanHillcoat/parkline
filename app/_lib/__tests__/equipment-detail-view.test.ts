import { describe, expect, it } from "vitest";
import type { EquipmentListItem } from "../../../src/fleet/application/equipment-visibility";
import type { Assignment } from "../../../src/fleet/domain/assignment";
import { copy } from "../copy";
import {
  buildHistoryRows,
  buildInfoRows,
  buildLocation,
  correctionOperations,
  detailActions,
  detailState,
  formatDay,
  hasHeaderButtons,
  incomingCandidates,
  OUTGOING_DEFAULT,
  outgoingChoices,
  parseDetailTab,
  writableOperations,
} from "../equipment-detail-view";

const d = copy.fleet.detail;
const NONE = copy.fleet.noValue;

const item = (extra: Partial<EquipmentListItem> = {}): EquipmentListItem => ({
  id: "e1",
  tenantId: "t",
  supplierId: "s1",
  assetTypeId: "a1",
  internalCode: "EQ-0001",
  brand: null,
  model: null,
  year: null,
  serialNumber: null,
  batteryQuantity: null,
  observations: null,
  archivedAt: null,
  supplier: { id: "s1", name: "SUPPLIER A" },
  assetType: { id: "a1", name: "FORKLIFT", meterKind: "hours" },
  assignment: null,
  ...extra,
});

const placed = { operationId: "o1", siteId: "si1", businessUnitId: "b1", kind: "active" as const, validFrom: "2026-01-10" };
const places = {
  operations: [{ id: "o1", name: "OPERATION ONE" }],
  sites: [{ id: "si1", name: "SITE ONE" }],
  divisions: [{ id: "b1", name: "DIVISION ONE" }],
};

const assignment = (id: string, extra: Partial<Assignment> = {}): Assignment => ({
  id,
  tenantId: "t",
  equipmentId: "e1",
  businessUnitId: "b1",
  operationId: "o1",
  siteId: "si1",
  kind: "active",
  validFrom: "2026-01-10",
  validTo: null,
  reason: null,
  createdBy: "u",
  createdAt: new Date("2026-01-10T00:00:00Z"),
  ...extra,
});

describe("parseDetailTab", () => {
  it("accepts history and falls back to info for anything else", () => {
    expect(parseDetailTab("history")).toBe("history");
    expect(parseDetailTab("info")).toBe("info");
    expect(parseDetailTab("nope")).toBe("info");
    expect(parseDetailTab(undefined)).toBe("info");
    expect(parseDetailTab(["history", "info"])).toBe("info");
  });
});

describe("formatDay", () => {
  it("writes a day as DD/MM/YYYY without going through Date", () => {
    expect(formatDay("2026-01-05")).toBe("05/01/2026");
    expect(formatDay("2026-12-31")).toBe("31/12/2026");
  });

  it("returns an unexpected text unchanged", () => {
    expect(formatDay("soon")).toBe("soon");
  });
});

describe("buildInfoRows", () => {
  it("shows a dash for every blank optional field", () => {
    const rows = buildInfoRows(item());
    expect(rows.map((row) => [row.label, row.value])).toEqual([
      [d.info.internalCode, "EQ-0001"],
      [d.info.assetType, "FORKLIFT"],
      [d.info.supplier, "SUPPLIER A"],
      [d.info.brand, NONE],
      [d.info.model, NONE],
      [d.info.year, NONE],
      [d.info.serialNumber, NONE],
      [d.info.batteries, NONE],
      [d.info.observations, NONE],
    ]);
  });

  it("shows the values that are set, including a zero battery count", () => {
    const rows = buildInfoRows(item({ brand: "BRAND X", model: "M-1", year: 2020, serialNumber: "SN-1", batteryQuantity: 0, observations: "Left mast" }));
    expect(rows.map((row) => row.value)).toEqual(["EQ-0001", "FORKLIFT", "SUPPLIER A", "BRAND X", "M-1", "2020", "SN-1", "0", "Left mast"]);
  });
});

describe("buildLocation", () => {
  it("names the operation, site, division, kind and the day it started", () => {
    const view = buildLocation(item({ assignment: placed }), places);
    expect(view.assigned).toBe(true);
    expect(view.rows.map((row) => [row.label, row.value])).toEqual([
      [d.location.operation, "OPERATION ONE"],
      [d.location.site, "SITE ONE"],
      [d.location.division, "DIVISION ONE"],
      [d.location.kind, d.kinds.active],
      [d.location.since, "10/01/2026"],
    ]);
    expect(view.hint).toBeNull();
  });

  it("uses a dash for a name the organization lists do not carry", () => {
    const view = buildLocation(item({ assignment: { ...placed, kind: "spare" } }), { operations: [], sites: [], divisions: [] });
    expect(view.rows.map((row) => row.value)).toEqual([NONE, NONE, NONE, d.kinds.spare, "10/01/2026"]);
  });

  it("says Sin asignar with a hint when there is no assignment", () => {
    const view = buildLocation(item(), places);
    expect(view.assigned).toBe(false);
    expect(view.rows).toEqual([]);
    expect(view.hint).toBe(d.location.noneHint);
  });

  it("tells an archived equipment it cannot be assigned", () => {
    expect(buildLocation(item({ archivedAt: new Date() }), places).hint).toBe(d.location.noneHintArchived);
  });
});

describe("detailState", () => {
  it("is De baja for an archived equipment whatever else it has", () => {
    expect(detailState(item({ archivedAt: new Date() }))).toEqual({ label: copy.common.archivedTag, tone: "neutral" });
  });

  it("follows the kind of the open assignment, else Sin asignar", () => {
    expect(detailState(item({ assignment: placed }))).toEqual({ label: copy.fleet.state.active, tone: "ok" });
    expect(detailState(item({ assignment: { ...placed, kind: "spare" } }))).toEqual({ label: copy.fleet.state.spare, tone: "warn" });
    expect(detailState(item())).toEqual({ label: copy.fleet.state.unassigned, tone: "neutral" });
  });
});

describe("buildHistoryRows", () => {
  it("lists the newest first as given, with Vigente for the open one and dashes for unknown names", () => {
    const rows = buildHistoryRows(
      [
        assignment("a2", { validFrom: "2026-03-01", kind: "spare", reason: "Back in use" }),
        assignment("a1", { operationId: "gone", siteId: "gone", validTo: "2026-02-28" }),
      ],
      places,
    );
    expect(rows[0]).toMatchObject({ id: "a2", from: "01/03/2026", to: d.history.open, open: true, operationName: "OPERATION ONE", siteName: "SITE ONE", kindLabel: d.kinds.spare, reason: "Back in use" });
    expect(rows[1]).toMatchObject({ id: "a1", to: "28/02/2026", open: false, operationName: NONE, siteName: NONE, reason: NONE });
  });

  it("prefills the correction form with the current values, an empty end for an open row", () => {
    const [open, closed] = buildHistoryRows([assignment("a2"), assignment("a1", { validTo: "2026-02-28", kind: "spare" })], places);
    expect(open?.form).toEqual({ validFrom: "2026-01-10", validTo: "", operationId: "o1", kind: "active" });
    expect(closed?.form).toEqual({ validFrom: "2026-01-10", validTo: "2026-02-28", operationId: "o1", kind: "spare" });
  });
});

describe("detailActions", () => {
  const base = { canWrite: true, canArchive: true, archived: false, assigned: false };

  it("offers Asignar, Editar and Dar de baja to an analyst on an unassigned equipment", () => {
    expect(detailActions(base)).toEqual({ assign: true, move: false, replace: false, end: false, edit: true, archive: true, restore: false, correct: true });
  });

  it("offers Mover, Reemplazar, Cerrar and Editar on an assigned one, and no archive", () => {
    expect(detailActions({ ...base, assigned: true })).toEqual({ assign: false, move: true, replace: true, end: true, edit: true, archive: false, restore: false, correct: true });
  });

  it("offers only Reactivar (and corrections) on an archived equipment", () => {
    expect(detailActions({ ...base, archived: true })).toEqual({ assign: false, move: false, replace: false, end: false, edit: false, archive: false, restore: true, correct: true });
  });

  it("gives an admin everything but archive and restore", () => {
    const admin = detailActions({ ...base, canArchive: false });
    expect(admin).toMatchObject({ assign: true, edit: true, archive: false, restore: false });
    expect(detailActions({ ...base, canArchive: false, archived: true }).restore).toBe(false);
  });

  it("gives a reader without write permission nothing", () => {
    const none = detailActions({ canWrite: false, canArchive: false, archived: false, assigned: true });
    expect(Object.values(none).every((allowed) => !allowed)).toBe(true);
  });
});

describe("hasHeaderButtons", () => {
  const ctx = { canWrite: true, canArchive: false, archived: false, assigned: false };

  it("is true when any header button shows and false when only corrections remain or nothing does", () => {
    expect(hasHeaderButtons(detailActions(ctx))).toBe(true);
    expect(hasHeaderButtons(detailActions({ ...ctx, archived: true }))).toBe(false);
    expect(hasHeaderButtons(detailActions({ ...ctx, canArchive: true, archived: true }))).toBe(true);
    expect(hasHeaderButtons(detailActions({ canWrite: false, canArchive: false, archived: false, assigned: true }))).toBe(false);
  });
});

describe("outgoingChoices", () => {
  it("preselects the muleto and offers the baja only to an actor who may archive", () => {
    expect(OUTGOING_DEFAULT).toBe("spare");
    expect(outgoingChoices(true)).toEqual(["spare", "retire"]);
    expect(outgoingChoices(false)).toEqual(["spare"]);
  });
});

describe("incomingCandidates", () => {
  it("offers only active equipment without an open assignment, other than the outgoing one, by code and type", () => {
    const options = incomingCandidates(
      [
        item({ id: "e1", internalCode: "OUT" }),
        item({ id: "e2", internalCode: "B-2" }),
        item({ id: "e3", internalCode: "A-1", assetType: { id: "a2", name: "PALLET JACK", meterKind: "none" } }),
        item({ id: "e4", internalCode: "BUSY", assignment: placed }),
        item({ id: "e5", internalCode: "OLD", archivedAt: new Date() }),
      ],
      "e1",
    );
    expect(options).toEqual([
      { id: "e3", name: "A-1 - PALLET JACK" },
      { id: "e2", name: "B-2 - FORKLIFT" },
    ]);
  });
});

describe("writableOperations", () => {
  const ops = [
    { id: "o1", name: "ONE", businessUnitId: "b1", siteId: "s1", archivedAt: null },
    { id: "o2", name: "TWO", businessUnitId: "b2", siteId: "s2", archivedAt: null },
    { id: "o3", name: "THREE", businessUnitId: "b1", siteId: "s1", archivedAt: new Date() },
  ];

  it("keeps the active operations the actor may write", () => {
    expect(writableOperations(ops, (op) => op.businessUnitId === "b1")).toEqual([{ id: "o1", name: "ONE" }]);
    expect(writableOperations(ops, () => true).map((o) => o.id)).toEqual(["o1", "o2"]);
  });
});

describe("correctionOperations", () => {
  it("adds the operation the row is in when it is not among the choices, named or with a dash", () => {
    const choices = [{ id: "o2", name: "TWO" }];
    expect(correctionOperations(choices, "o1", [{ id: "o1", name: "ONE" }])).toEqual([{ id: "o2", name: "TWO" }, { id: "o1", name: "ONE" }]);
    expect(correctionOperations(choices, "x", [])).toEqual([{ id: "o2", name: "TWO" }, { id: "x", name: NONE }]);
    expect(correctionOperations(choices, "o2", [])).toEqual(choices);
  });
});
