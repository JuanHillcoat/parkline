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
  hasMenuActions,
  incomingCandidates,
  OUTGOING_DEFAULT,
  outgoingChoices,
  positionOfPlacement,
  parseDetailTab,
  correctionSites,
  moveOperations,
  moveSites,
  writableOperations,
  writableSites,
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
  batteryKind: null,
  batteryQuantity: null,
  observations: null,
  archivedAt: null,
  supplier: { id: "s1", name: "SUPPLIER A" },
  assetType: { id: "a1", name: "FORKLIFT", meterKind: "hours", preventiveIntervalHours: 250 },
  assignment: null,
  imageHash: null,
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
  it("accepts history and readings and falls back to history for anything else, the old info tab included", () => {
    expect(parseDetailTab("history")).toBe("history");
    expect(parseDetailTab("readings")).toBe("readings");
    expect(parseDetailTab("info")).toBe("history");
    expect(parseDetailTab("nope")).toBe("history");
    expect(parseDetailTab(undefined)).toBe("history");
    expect(parseDetailTab(["readings", "history"])).toBe("history");
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
      [d.info.brandModel, NONE],
      [d.info.year, NONE],
      [d.info.supplier, "SUPPLIER A"],
      [d.info.batteryKind, NONE],
    ]);
  });

  it("joins brand and model, shows a lone one as is, and the quantity of a lead acid battery", () => {
    const leadAcid = { brand: "BRAND X", model: "M-1", year: 2020, serialNumber: "SN-1", batteryKind: "lead_acid", batteryQuantity: 0 } as const;
    const rows = buildInfoRows(item(leadAcid));
    expect(rows.map((row) => row.value)).toEqual(["EQ-0001", "FORKLIFT", "BRAND X M-1", "2020", "SUPPLIER A", "Plomo ácido", "0"]);
    expect(rows.map((row) => row.label)).toContain(d.info.batteries);
    expect(buildInfoRows(item({ brand: "BRAND X" }))[2]?.value).toBe("BRAND X");
    expect(buildInfoRows(item({ model: "M-1" }))[2]?.value).toBe("M-1");
  });

  it("names lithium and combustion without a quantity row", () => {
    for (const [kind, name] of [["lithium", "Litio"], ["combustion", "Combustión"]] as const) {
      const rows = buildInfoRows(item({ batteryKind: kind }));
      expect(rows).toContainEqual({ label: d.info.batteryKind, value: name });
      expect(rows.map((row) => row.label)).not.toContain(d.info.batteries);
    }
  });
});

describe("buildLocation", () => {
  it("names the operation, site, division and the day it started", () => {
    const view = buildLocation(item({ assignment: placed }), places);
    expect(view.assigned).toBe(true);
    expect(view.rows.map((row) => [row.label, row.value])).toEqual([
      [d.location.operation, "OPERATION ONE"],
      [d.location.site, "SITE ONE"],
      [d.location.division, "DIVISION ONE"],
      [d.location.since, "10/01/2026"],
    ]);
    expect(view.hint).toBeNull();
  });

  it("uses a dash for a name the organization lists do not carry", () => {
    const view = buildLocation(item({ assignment: { ...placed, kind: "spare" } }), { operations: [], sites: [], divisions: [] });
    expect(view.rows.map((row) => row.value)).toEqual([NONE, NONE, NONE, "10/01/2026"]);
  });

  it("shows a spare of a site without operation and division rows", () => {
    const spare = { siteId: "si1", businessUnitId: null, operationId: null, kind: "spare" as const, validFrom: "2026-01-10" };
    const view = buildLocation(item({ assignment: spare }), places);
    expect(view.rows.map((row) => [row.label, row.value])).toEqual([
      [d.location.site, "SITE ONE"],
      [d.location.since, "10/01/2026"],
    ]);
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
    expect(open?.form).toEqual({ validFrom: "2026-01-10", validTo: "", operationId: "o1", siteId: "", kind: "active" });
    expect(closed?.form).toEqual({ validFrom: "2026-01-10", validTo: "2026-02-28", operationId: "o1", siteId: "", kind: "spare" });
  });

  it("shows a spare of a site with an empty operation and the site as the place to correct", () => {
    const [row] = buildHistoryRows([assignment("a3", { businessUnitId: null, operationId: null, kind: "spare" })], places);
    expect(row).toMatchObject({ operationName: NONE, siteName: "SITE ONE", kindLabel: d.kinds.spare });
    expect(row?.form).toMatchObject({ operationId: "", siteId: "si1", kind: "spare" });
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

describe("hasMenuActions", () => {
  const ctx = { canWrite: true, canArchive: false, archived: false, assigned: false };

  it("does not count assign and move, which live in the location card", () => {
    const none = { assign: false, move: false, replace: false, end: false, edit: false, archive: false, restore: false, correct: true };
    expect(hasMenuActions({ ...none, assign: true, move: true })).toBe(false);
    expect(hasMenuActions({ ...none, end: true })).toBe(true);
  });

  it("is true when any menu item shows and false when only corrections remain or nothing does", () => {
    expect(hasMenuActions(detailActions(ctx))).toBe(true);
    expect(hasMenuActions(detailActions({ ...ctx, archived: true }))).toBe(false);
    expect(hasMenuActions(detailActions({ ...ctx, canArchive: true, archived: true }))).toBe(true);
    expect(hasMenuActions(detailActions({ canWrite: false, canArchive: false, archived: false, assigned: true }))).toBe(false);
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
        item({ id: "e3", internalCode: "A-1", assetType: { id: "a2", name: "PALLET JACK", meterKind: "none", preventiveIntervalHours: null } }),
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

describe("sites for a spare", () => {
  const sites = [
    { id: "si1", name: "SITE ONE", archivedAt: null },
    { id: "si2", name: "SITE TWO", archivedAt: null },
    { id: "si3", name: "SITE THREE", archivedAt: new Date() },
  ];

  it("offers only active sites where the actor may write", () => {
    expect(writableSites(sites, () => true)).toEqual([{ id: "si1", name: "SITE ONE" }, { id: "si2", name: "SITE TWO" }]);
    expect(writableSites(sites, (site) => site.id === "si2")).toEqual([{ id: "si2", name: "SITE TWO" }]);
    expect(writableSites(sites, () => false)).toEqual([]);
  });

  it("keeps the site of the row in the correction choices, and adds nothing for a row in an operation", () => {
    const choices = [{ id: "si2", name: "SITE TWO" }];
    expect(correctionSites(choices, "si1", sites)).toEqual([...choices, { id: "si1", name: "SITE ONE" }]);
    expect(correctionSites(choices, "si2", sites)).toEqual(choices);
    expect(correctionSites(choices, "", sites)).toEqual(choices);
  });

  it("leaves out of the move choices the site where the equipment is already a spare", () => {
    const choices = [{ id: "si1", name: "SITE ONE" }, { id: "si2", name: "SITE TWO" }];
    const spare = { ...placed, operationId: null, businessUnitId: null, kind: "spare" as const };
    expect(moveSites(choices, spare)).toEqual([{ id: "si2", name: "SITE TWO" }]);
    expect(moveSites(choices, placed)).toEqual(choices);
    expect(moveSites(choices, null)).toEqual(choices);
  });

  it("leaves out of the move choices the operation where the equipment already is", () => {
    const choices = [{ id: "o1", name: "OPERATION ONE" }, { id: "o2", name: "OPERATION TWO" }];
    expect(moveOperations(choices, placed)).toEqual([{ id: "o2", name: "OPERATION TWO" }]);
    expect(moveOperations(choices, { ...placed, operationId: null, businessUnitId: null, kind: "spare" })).toEqual(choices);
    expect(moveOperations(choices, null)).toEqual(choices);
  });

  it("keeps the correction operations free of a blank option for a spare of a site", () => {
    const choices = [{ id: "o2", name: "OPERATION TWO" }];
    expect(correctionOperations(choices, "", places.operations)).toEqual(choices);
  });
});

describe("positionOfPlacement", () => {
  it("is the whole company without an open assignment", () => {
    expect(positionOfPlacement("t1", null)).toEqual({ tenantId: "t1" });
  });

  it("carries the division, the site and the operation of an active assignment", () => {
    expect(positionOfPlacement("t1", { siteId: "s1", businessUnitId: "b1", operationId: "o1" })).toEqual({
      tenantId: "t1", siteId: "s1", businessUnitId: "b1", operationId: "o1",
    });
  });

  it("carries only the site of a spare parked at a site, so a division or operation grant never matches it", () => {
    expect(positionOfPlacement("t1", { siteId: "s1", businessUnitId: null, operationId: null })).toEqual({ tenantId: "t1", siteId: "s1" });
  });
});
