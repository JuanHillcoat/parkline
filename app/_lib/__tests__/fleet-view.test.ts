import { describe, expect, it } from "vitest";
import type { AssignmentSummary, EquipmentListItem } from "../../../src/fleet/application/equipment-visibility";
import type { AssetType, Equipment, Supplier } from "../../../src/fleet/domain/entities";
import { copy } from "../copy";
import {
  assetTypeOptions,
  buildAssetTypeRows,
  buildEquipmentRows,
  buildSupplierRows,
  equipmentImageUrl,
  canCreateEquipment,
  equipmentPrerequisites,
  missingPrerequisites,
  countActiveEquipment,
  equipmentFormValues,
  filterEquipment,
  listOrEmpty,
  fleetHeading,
  fleetHref,
  fleetToggleHref,
  assetTypeNamesOf,
  intervalText,
  knownId,
  operationOptions,
  parseEquipmentState,
  supplierNamesOf,
  paginate,
  parseFleetTab,
  pageWindow,
  parsePage,
  supplierOptions,
} from "../fleet-view";

const GONE = new Date("2026-01-01T00:00:00Z");
const supplier = (id: string, name: string, archivedAt: Date | null = null): Supplier => ({ id, tenantId: "t", name, archivedAt });
const assetType = (
  id: string,
  name: string,
  meterKind: AssetType["meterKind"] = "hours",
  preventiveIntervalHours: number | null = 250,
  archivedAt: Date | null = null,
): AssetType => ({ id, tenantId: "t", name, meterKind, preventiveIntervalHours, archivedAt });
const equipment = (id: string, code: string, supplierId: string, assetTypeId: string, extra: Partial<Equipment> = {}): Equipment => ({
  id,
  tenantId: "t",
  supplierId,
  assetTypeId,
  internalCode: code,
  brand: null,
  model: null,
  year: null,
  serialNumber: null,
  batteryKind: "combustion",
  batteryQuantity: null,
  observations: null,
  archivedAt: null,
  ...extra,
});

const suppliers = [supplier("s1", "SUPPLIER A"), supplier("s2", "SUPPLIER B")];
const types = [assetType("a1", "FORKLIFT"), assetType("a2", "PALLET JACK", "none", null)];
const units = [
  equipment("e1", "EQ-0001", "s1", "a1", { brand: "BRAND X", model: "M-1", year: 2020, serialNumber: "SN-1", batteryQuantity: 2, observations: "Left mast" }),
  equipment("e2", "C-043", "s1", "a2"),
  equipment("e3", "EQ-0003", "s2", "a1", { archivedAt: GONE }),
];

const here: AssignmentSummary = { operationId: "o1", siteId: "si1", businessUnitId: "b1", kind: "active", validFrom: "2026-01-10" };
const asItem = (e: Equipment, assignment: AssignmentSummary | null = null): EquipmentListItem => ({
  ...e,
  supplier: { id: e.supplierId, name: suppliers.find((s) => s.id === e.supplierId)?.name ?? "?" },
  assetType: {
    id: e.assetTypeId,
    name: types.find((t) => t.id === e.assetTypeId)?.name ?? "?",
    meterKind: types.find((t) => t.id === e.assetTypeId)?.meterKind ?? "none",
  },
  assignment,
  imageHash: null,
});
const items = units.map((unit) => asItem(unit));
const places = {
  operations: [{ id: "o1", name: "OPERATION ONE" }],
  sites: [{ id: "si1", name: "SITE ONE" }],
};

describe("intervalText", () => {
  it("shows the interval with the unit of the meter", () => {
    expect(intervalText("hours", 250)).toBe("250 h");
    expect(intervalText("km", 10000)).toBe("10000 km");
  });

  it("shows a dash without a meter or without an interval", () => {
    expect(intervalText("none", null)).toBe("—");
    expect(intervalText("hours", null)).toBe("—");
  });
});

describe("countActiveEquipment", () => {
  it("counts only the active equipment per supplier and per asset type", () => {
    expect(countActiveEquipment(units, "supplierId").get("s1")).toBe(2);
    expect(countActiveEquipment(units, "supplierId").get("s2")).toBeUndefined();
    expect(countActiveEquipment(units, "assetTypeId").get("a1")).toBe(1);
  });
});

describe("buildSupplierRows and buildAssetTypeRows", () => {
  it("carry the active equipment count and the archived flag", () => {
    const rows = buildSupplierRows([...suppliers, supplier("s3", "SUPPLIER C", GONE)], units);
    expect(rows.map((r) => [r.name, r.activeEquipment, r.archived])).toEqual([
      ["SUPPLIER A", 2, false],
      ["SUPPLIER B", 0, false],
      ["SUPPLIER C", 0, true],
    ]);
  });

  it("translate the meter, show the interval and prepare the edit values", () => {
    const [forklift, jack] = buildAssetTypeRows(types, units);
    expect(forklift).toMatchObject({ meterLabel: "Horas", intervalText: "250 h", activeEquipment: 1 });
    expect(forklift?.form).toEqual({ name: "FORKLIFT", meterKind: "hours", interval: "250" });
    expect(jack).toMatchObject({ meterLabel: "Ninguno", intervalText: "—" });
    expect(jack?.form).toEqual({ name: "PALLET JACK", meterKind: "none", interval: "" });
  });
});

describe("equipmentImageUrl", () => {
  it("points to the image endpoint with the hash as a cache buster", () => {
    expect(equipmentImageUrl("e1", "abc123")).toBe("/fleet/equipment/e1/image?v=abc123");
  });

  it("is null without an image", () => {
    expect(equipmentImageUrl("e1", null)).toBeNull();
  });
});

describe("buildEquipmentRows", () => {
  const rows = buildEquipmentRows(items, places);

  it("carries the image address only for an equipment with an image", () => {
    const unit = units[0] as Equipment;
    const [withImage] = buildEquipmentRows([{ ...asItem(unit), imageHash: "h1" }], places);
    expect(withImage?.imageUrl).toBe(`/fleet/equipment/${unit.id}/image?v=h1`);
    expect(rows[0]?.imageUrl).toBeNull();
  });

  it("takes the supplier and the asset type names from the item itself", () => {
    expect(rows[0]).toMatchObject({ internalCode: "EQ-0001", supplierName: "SUPPLIER A", assetTypeName: "FORKLIFT" });
  });

  it("joins brand and model, and leaves null when both are missing", () => {
    expect(rows[0]?.brandModel).toBe("BRAND X M-1");
    expect(rows[1]?.brandModel).toBeNull();
  });

  it("keeps the archived flag", () => {
    expect(rows[2]?.archived).toBe(true);
  });

  it("maps the open assignment to a state, an operation and a site", () => {
    const [active, spare, idle] = buildEquipmentRows(
      [
        asItem(units[0] as Equipment, here),
        asItem(units[1] as Equipment, { ...here, kind: "spare" }),
        asItem(units[2] as Equipment),
      ],
      places,
    );
    expect(active).toMatchObject({ state: "active", operationId: "o1", operationName: "OPERATION ONE", siteName: "SITE ONE" });
    expect(spare).toMatchObject({ state: "spare", operationId: "o1" });
    expect(idle).toMatchObject({ state: "unassigned", operationId: null, operationName: null, siteName: null });
  });

  it("shows a spare of a site as Muleto with its site and no operation", () => {
    const spare = { ...here, kind: "spare" as const, operationId: null, businessUnitId: null };
    const [row] = buildEquipmentRows([asItem(units[0] as Equipment, spare)], places);
    expect(row).toMatchObject({ state: "spare", operationId: null, operationName: null, siteName: "SITE ONE" });
  });

  it("leaves a name null when the organization list does not carry it", () => {
    const [row] = buildEquipmentRows([asItem(units[0] as Equipment, { ...here, operationId: "gone", siteId: "gone" })], places);
    expect(row).toMatchObject({ state: "active", operationId: "gone", operationName: null, siteName: null });
  });
});

describe("names carried by the items", () => {
  it("build the supplier and asset type filter options without the catalogs, unique and sorted", () => {
    const more = [...items, asItem(equipment("e4", "EQ-4", "s2", "a2"))];
    expect(supplierNamesOf(more)).toEqual([{ id: "s1", name: "SUPPLIER A" }, { id: "s2", name: "SUPPLIER B" }]);
    expect(assetTypeNamesOf(more)).toEqual([{ id: "a1", name: "FORKLIFT" }, { id: "a2", name: "PALLET JACK" }]);
    expect(supplierNamesOf([])).toEqual([]);
  });
});

describe("operationOptions", () => {
  it("offers the operations that are not archived", () => {
    const rows = [
      { id: "o1", name: "OPERATION ONE", archivedAt: null },
      { id: "o2", name: "OLD", archivedAt: GONE },
    ];
    expect(operationOptions(rows)).toEqual([{ id: "o1", name: "OPERATION ONE" }]);
  });
});

describe("parseEquipmentState", () => {
  it("accepts the three states and ignores anything else", () => {
    expect(parseEquipmentState("active")).toBe("active");
    expect(parseEquipmentState("spare")).toBe("spare");
    expect(parseEquipmentState("unassigned")).toBe("unassigned");
    expect(parseEquipmentState("nope")).toBeNull();
    expect(parseEquipmentState(undefined)).toBeNull();
    expect(parseEquipmentState(["active"])).toBeNull();
  });
});

describe("equipmentFormValues", () => {
  it("turns every field into the text a form shows, blank for missing values", () => {
    expect(equipmentFormValues(units[0] as Equipment)).toEqual({
      internalCode: "EQ-0001",
      supplierId: "s1",
      assetTypeId: "a1",
      brand: "BRAND X",
      model: "M-1",
      year: "2020",
      serialNumber: "SN-1",
      batteryKind: "combustion",
      batteryQuantity: "2",
      observations: "Left mast",
    });
    expect(equipmentFormValues(units[1] as Equipment)).toMatchObject({ brand: "", year: "", batteryQuantity: "" });
  });

  it("keeps a battery quantity of zero", () => {
    expect(equipmentFormValues(equipment("e", "X", "s", "a", { batteryQuantity: 0 })).batteryQuantity).toBe("0");
  });
});

describe("select options", () => {
  it("offer only active suppliers and asset types", () => {
    const all = [...suppliers, supplier("s3", "SUPPLIER C", GONE)];
    expect(supplierOptions(all)).toEqual([{ id: "s1", name: "SUPPLIER A" }, { id: "s2", name: "SUPPLIER B" }]);
    expect(assetTypeOptions([...types, assetType("a3", "OLD", "none", null, GONE)]).map((o) => o.id)).toEqual(["a1", "a2"]);
  });

  it("carry the meter kind of each active asset type, so the registration knows when a first reading applies", () => {
    expect(assetTypeOptions(types)).toEqual([
      { id: "a1", name: "FORKLIFT", meterKind: "hours" },
      { id: "a2", name: "PALLET JACK", meterKind: "none" },
    ]);
  });

  it("allow a new equipment only with at least one of each", () => {
    expect(canCreateEquipment(supplierOptions(suppliers), assetTypeOptions(types))).toBe(true);
    expect(canCreateEquipment([], assetTypeOptions(types))).toBe(false);
    expect(canCreateEquipment(supplierOptions(suppliers), [])).toBe(false);
  });
});

describe("equipment prerequisites", () => {
  const supplier = supplierOptions(suppliers);
  const type = assetTypeOptions(types);
  const kinds = (items: readonly { kind: string }[]) => items.map((item) => item.kind);

  it("lists both prerequisites, supplier first, each with the tab that creates it", () => {
    expect(equipmentPrerequisites([], [])).toEqual([
      { kind: "supplier", done: false, tab: "suppliers" },
      { kind: "assetType", done: false, tab: "asset-types" },
    ]);
  });

  it("misses both with neither, one with only the other, and none with both", () => {
    expect(kinds(missingPrerequisites([], []))).toEqual(["supplier", "assetType"]);
    expect(kinds(missingPrerequisites(supplier, []))).toEqual(["assetType"]);
    expect(kinds(missingPrerequisites([], type))).toEqual(["supplier"]);
    expect(missingPrerequisites(supplier, type)).toEqual([]);
  });

  it("agrees with canCreateEquipment", () => {
    for (const [s, t] of [[[], []], [supplier, []], [[], type], [supplier, type]] as const) {
      expect(missingPrerequisites(s, t).length === 0).toBe(canCreateEquipment(s, t));
    }
  });
});

describe("fleetToggleHref", () => {
  it("leads to the other view", () => {
    expect(fleetToggleHref(false)).toBe("/fleet?archived=1");
    expect(fleetToggleHref(true)).toBe("/fleet");
  });
});

describe("parseFleetTab", () => {
  it("accepts the three tabs and falls back to equipment", () => {
    expect(parseFleetTab("suppliers")).toBe("suppliers");
    expect(parseFleetTab("asset-types")).toBe("asset-types");
    expect(parseFleetTab("equipment")).toBe("equipment");
    expect(parseFleetTab("nope")).toBe("equipment");
    expect(parseFleetTab(undefined)).toBe("equipment");
    expect(parseFleetTab(["suppliers"])).toBe("equipment");
  });
});

describe("filterEquipment", () => {
  const named = (item: EquipmentListItem): EquipmentListItem => ({
    ...item,
    supplier: { id: item.supplierId, name: item.supplierId === "s1" ? "Proveedor Uno" : "Proveedor Dos" },
    assetType: { id: item.assetTypeId, name: item.assetTypeId === "a1" ? "Grúa" : "Camión", meterKind: "hours" },
  });
  const rows = buildEquipmentRows(
    [
      named(asItem(equipment("e1", "GRÚA-01", "s1", "a1", { brand: "Marca", model: "Ñandú 2", serialNumber: "SN-77" }), here)),
      named(asItem(equipment("e2", "CAM-02", "s2", "a2", { brand: "Otra", model: "X" }), { ...here, operationId: "o2", kind: "spare" })),
      named(asItem(equipment("e3", "VAC-03", "s2", "a1"))),
    ],
    { operations: [], sites: [] },
  );
  const none = { q: "", supplierId: null, typeId: null, operationId: null, state: null };

  it("returns everything without filters", () => {
    expect(filterEquipment(rows, none)).toHaveLength(3);
  });

  it("searches code, brand, model, serial, supplier and type ignoring case and accents", () => {
    for (const q of ["grua-01", "marca", "ñandú", "sn-77", "proveedor dos", "camion"]) {
      expect(filterEquipment(rows, { ...none, q }).length).toBeGreaterThan(0);
    }
    expect(filterEquipment(rows, { ...none, q: "camion" }).map((r) => r.id)).toEqual(["e2"]);
    expect(filterEquipment(rows, { ...none, q: "zzz" })).toEqual([]);
  });

  it("filters by supplier and by type", () => {
    expect(filterEquipment(rows, { ...none, supplierId: "s2" }).map((r) => r.id)).toEqual(["e2", "e3"]);
    expect(filterEquipment(rows, { ...none, typeId: "a1" }).map((r) => r.id)).toEqual(["e1", "e3"]);
    expect(filterEquipment(rows, { ...none, supplierId: "s1", typeId: "a2" })).toEqual([]);
  });

  it("filters by operation: equipment without an assignment never matches", () => {
    expect(filterEquipment(rows, { ...none, operationId: "o1" }).map((r) => r.id)).toEqual(["e1"]);
    expect(filterEquipment(rows, { ...none, operationId: "o2" }).map((r) => r.id)).toEqual(["e2"]);
  });

  it("filters by state", () => {
    expect(filterEquipment(rows, { ...none, state: "active" }).map((r) => r.id)).toEqual(["e1"]);
    expect(filterEquipment(rows, { ...none, state: "spare" }).map((r) => r.id)).toEqual(["e2"]);
    expect(filterEquipment(rows, { ...none, state: "unassigned" }).map((r) => r.id)).toEqual(["e3"]);
  });

  it("never matches an archived row against a state: its pill is De baja, not a state", () => {
    const archived = buildEquipmentRows(
      [named(asItem(equipment("e4", "OLD-04", "s1", "a1", { archivedAt: new Date("2026-01-01T00:00:00Z") })))],
      { operations: [], sites: [] },
    );
    const all = [...rows, ...archived];
    expect(filterEquipment(all, none).map((r) => r.id)).toContain("e4");
    expect(filterEquipment(all, { ...none, state: "unassigned" }).map((r) => r.id)).toEqual(["e3"]);
    expect(filterEquipment(archived, { ...none, state: "unassigned" })).toEqual([]);
  });

  it("combines every filter with the search", () => {
    expect(filterEquipment(rows, { ...none, state: "spare", operationId: "o2", q: "cam" }).map((r) => r.id)).toEqual(["e2"]);
    expect(filterEquipment(rows, { ...none, state: "spare", operationId: "o1" })).toEqual([]);
  });
});

describe("knownId", () => {
  const options = [{ id: "s1", name: "A" }];
  it("keeps a known id and ignores anything else", () => {
    expect(knownId("s1", options)).toBe("s1");
    expect(knownId("other", options)).toBeNull();
    expect(knownId(undefined, options)).toBeNull();
    expect(knownId(["s1"], options)).toBeNull();
  });
});

describe("parsePage and paginate", () => {
  const items = Array.from({ length: 45 }, (_, index) => index);
  it("parses a page number, defaulting to 1", () => {
    expect(parsePage("3")).toBe(3);
    expect(parsePage("0")).toBe(1);
    expect(parsePage("x")).toBe(1);
    expect(parsePage(undefined)).toBe(1);
  });
  it("slices 20 rows per page and reports the range", () => {
    const page = paginate(items, 2);
    expect(page.items).toHaveLength(20);
    expect(page).toMatchObject({ page: 2, pages: 3, total: 45, from: 21, to: 40 });
  });
  it("clamps out-of-range pages", () => {
    expect(paginate(items, 99)).toMatchObject({ page: 3, from: 41, to: 45 });
    expect(paginate([], 5)).toMatchObject({ page: 1, pages: 1, total: 0, from: 0, to: 0 });
  });
});

describe("pageWindow", () => {
  it("shows at most five numbers around the current page", () => {
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
    expect(pageWindow(1, 10)).toEqual([1, 2, 3, 4, 5]);
    expect(pageWindow(5, 10)).toEqual([3, 4, 5, 6, 7]);
    expect(pageWindow(10, 10)).toEqual([6, 7, 8, 9, 10]);
  });
});

describe("fleetHref", () => {
  it("omits defaults and keeps the other params", () => {
    expect(fleetHref({})).toBe("/fleet");
    expect(fleetHref({ tab: "suppliers", archived: true })).toBe("/fleet?tab=suppliers&archived=1");
    expect(fleetHref({ tab: "equipment", q: "a b", supplierId: "s1", typeId: "t1", page: 2 })).toBe(
      "/fleet?q=a+b&supplier=s1&type=t1&page=2",
    );
    expect(fleetHref({ page: 1 })).toBe("/fleet");
  });

  it("keeps the operation and state filters, and drops them when empty", () => {
    expect(fleetHref({ operationId: "o1", state: "spare", page: 3 })).toBe("/fleet?operation=o1&state=spare&page=3");
    expect(fleetHref({ operationId: null, state: null })).toBe("/fleet");
  });
});

describe("listOrEmpty", () => {
  it("gives the rows of a successful list", () => {
    expect(listOrEmpty({ ok: true, value: ["a", "b"] })).toEqual(["a", "b"]);
  });

  it("gives an empty list for a failed one, so the board shows blank names instead of failing", () => {
    expect(listOrEmpty({ ok: false, error: new Error("organization unavailable") })).toEqual([]);
  });
});

describe("fleetHeading", () => {
  it("names the equipment section like the sidebar entry", () => {
    expect(fleetHeading("equipment", true)).toEqual({ title: copy.fleet.title, subtitle: copy.fleet.subtitleEquipment });
  });

  it("names the suppliers and asset types sections like their sidebar entries", () => {
    expect(fleetHeading("suppliers", true)).toEqual({ title: "Proveedores", subtitle: copy.fleet.subtitleSuppliers });
    expect(fleetHeading("asset-types", true)).toEqual({ title: "Tipos de equipo", subtitle: copy.fleet.subtitleAssetTypes });
  });

  it("keeps the scoped subtitle for a reader limited to their scope", () => {
    expect(fleetHeading("equipment", false)).toEqual({ title: copy.fleet.title, subtitle: copy.fleet.subtitleScoped });
  });
});
