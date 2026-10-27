import { expect, test, type Locator } from "@playwright/test";
import { copy } from "../../app/_lib/copy";
import {
  OP_A,
  OP_B,
  alertOf,
  archiveOperationAsOwner,
  assignmentAudit,
  buttonNamed,
  buttonsOf,
  d,
  fillCorrection,
  gotoDetail,
  historyRows,
  idOf,
  locationCard,
  messages,
  openCorrection,
  pillOf,
  seedFixture,
  storedAssignments,
  submitAssign,
  submitCorrection,
  submitEnd,
  submitMove,
  t,
  today,
  valueOf,
  withSeeder,
  type Fixture,
} from "../support/assignment-flows";
import { resetCatalogs } from "../support/data";
import { expectDialogClosed, fill, openDialog, openDialogOf, submitDialog } from "../support/fleet-flows";
import { archiveButton, archiveOrRestore, rowOf } from "../support/organization-flows";
import { readWorld, storageStatePath, WORLD_ORG } from "../support/world";

const PAST = "2026-01-05";
const WORLD_OP = WORLD_ORG.operation;
const siteId = (): string => readWorld().ids.site;
const ddmmyyyy = (iso: string): string => iso.split("-").reverse().join("/");

/** An equipment that has been in OP_A since PAST (a backdated assignment seeded with a reason). */
async function seedAssigned(code: string): Promise<{ fixture: Fixture; id: string }> {
  const fixture = await seedFixture([code]);
  const id = idOf(fixture, code);
  await withSeeder((seeder) => seeder.assign({ equipmentId: id, operationId: fixture.opA, day: PAST, reason: "Loaded late" }));
  return { fixture, id };
}

/** OP_A from 2026-01-05 to 2026-02-09, then OP_B from 2026-02-10 to 2026-03-01 (both closed). */
async function seedTwoClosed(code: string): Promise<{ fixture: Fixture; id: string }> {
  const { fixture, id } = await seedAssigned(code);
  await withSeeder(async (seeder) => {
    await seeder.move({ equipmentId: id, operationId: fixture.opB, day: "2026-02-10", reason: "Contract started" });
    await seeder.end({ equipmentId: id, day: "2026-03-01", reason: "Parked" });
  });
  return { fixture, id };
}

const operationsOf = (dialog: Locator, label: string) => dialog.getByLabel(label, { exact: true }).locator("option");

test.describe("assign an equipment from the detail page", () => {
  test.use({ storageState: storageStatePath("fleet_analyst") });
  test.beforeEach(resetCatalogs);

  test("assigns an active equipment from today and shows it everywhere", async ({ page }) => {
    const fixture = await seedFixture(["ASG-1"]);
    const id = idOf(fixture, "ASG-1");
    await gotoDetail(page, id, "ASG-1");
    await expect(pillOf(page)).toHaveText(copy.fleet.state.unassigned);
    await submitAssign(page, { operation: OP_A });
    await expectDialogClosed(page);
    await expect(pillOf(page)).toHaveText(copy.fleet.state.active);
    await expect(valueOf(locationCard(page), t.location.operation)).toHaveText(OP_A);
    await expect(valueOf(locationCard(page), t.location.site)).toHaveText(WORLD_ORG.site);
    await expect(valueOf(locationCard(page), t.location.kind)).toHaveText(t.kinds.active);
    await expect(valueOf(locationCard(page), t.location.since)).toHaveText(ddmmyyyy(today()));
    await expect(buttonNamed(page, d.assignEquipment.trigger)).toHaveCount(0);
    for (const name of [d.moveEquipment.trigger, d.replaceEquipment.trigger, d.endAssignment.trigger]) {
      await expect(buttonNamed(page, name), name).toHaveCount(1);
    }
    expect(await storedAssignments(id)).toEqual([
      { valid_from: today(), valid_to: null, kind: "active", operation_id: fixture.opA, site_id: siteId(), reason: null },
    ]);
    const [entry, ...others] = await assignmentAudit(id);
    expect(others).toHaveLength(0);
    expect(entry).toMatchObject({ action: "fleet.assignment.create", entity_type: "equipment_assignment", reason: null, before: null });
    expect(entry?.after).toMatchObject({ operationId: fixture.opA, kind: "active", validFrom: today(), validTo: null });
  });

  test("the new assignment shows as Vigente in the Historial", async ({ page }) => {
    const fixture = await seedFixture(["ASG-2"]);
    await gotoDetail(page, idOf(fixture, "ASG-2"), "ASG-2");
    await submitAssign(page, { operation: OP_B });
    await expectDialogClosed(page);
    await expect(pillOf(page)).toHaveText(copy.fleet.state.active);
    await gotoDetail(page, idOf(fixture, "ASG-2"), "ASG-2", "history");
    await expect(historyRows(page)).toHaveCount(1);
    const row = historyRows(page).first();
    await expect(row).toContainText(ddmmyyyy(today()));
    await expect(row).toContainText(t.history.open);
    await expect(row).toContainText(OP_B);
    await expect(row).toContainText(WORLD_ORG.site);
    await expect(row).toContainText(t.kinds.active);
  });

  test("assigns a muleto to a site and shows the Muleto state, with no operation", async ({ page }) => {
    const fixture = await seedFixture(["ASG-3"]);
    const id = idOf(fixture, "ASG-3");
    await gotoDetail(page, id, "ASG-3");
    await submitAssign(page, { site: WORLD_ORG.site });
    await expectDialogClosed(page);
    await expect(pillOf(page)).toHaveText(copy.fleet.state.spare);
    await expect(valueOf(locationCard(page), t.location.kind)).toHaveText(t.kinds.spare);
    await expect(valueOf(locationCard(page), t.location.site)).toHaveText(WORLD_ORG.site);
    await expect(locationCard(page).getByText(t.location.operation, { exact: true })).toHaveCount(0);
    expect((await storedAssignments(id)).map((row) => [row.kind, row.operation_id, row.site_id])).toEqual([["spare", null, siteId()]]);
  });

  test("a past day without a reason shows the reason error and stores nothing; with a reason it works and is audited", async ({ page }) => {
    const fixture = await seedFixture(["ASG-4"]);
    const id = idOf(fixture, "ASG-4");
    await gotoDetail(page, id, "ASG-4");
    const dialog = await submitAssign(page, { operation: OP_A, day: PAST });
    await expect(alertOf(dialog)).toHaveText(messages.reason_required);
    expect(await storedAssignments(id)).toEqual([]);
    expect(await assignmentAudit(id)).toEqual([]);
    await fill(dialog, d.assignEquipment.reasonLabel, "Loaded late");
    await submitDialog(dialog, d.assignEquipment.submit);
    await expectDialogClosed(page);
    await expect(valueOf(locationCard(page), t.location.since)).toHaveText(ddmmyyyy(PAST));
    expect(await storedAssignments(id)).toEqual([
      { valid_from: PAST, valid_to: null, kind: "active", operation_id: fixture.opA, site_id: siteId(), reason: "Loaded late" },
    ]);
    const audit = await assignmentAudit(id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "fleet.assignment.create", reason: "Loaded late" });
  });

  test("an empty day shows the invalid date message", async ({ page }) => {
    const fixture = await seedFixture(["ASG-5"]);
    await gotoDetail(page, idOf(fixture, "ASG-5"), "ASG-5");
    const dialog = await submitAssign(page, { operation: OP_A, day: "" });
    await expect(alertOf(dialog)).toHaveText(messages.invalid_day);
    expect(await storedAssignments(idOf(fixture, "ASG-5"))).toEqual([]);
  });

  test("a second page that submits after the first one succeeded gets the open-assignment conflict", async ({ page, context }) => {
    const fixture = await seedFixture(["ASG-6"]);
    const id = idOf(fixture, "ASG-6");
    const stale = await context.newPage();
    await gotoDetail(stale, id, "ASG-6");
    await gotoDetail(page, id, "ASG-6");
    await submitAssign(page, { operation: OP_A });
    await expectDialogClosed(page);
    await expect(pillOf(page)).toHaveText(copy.fleet.state.active);
    const dialog = await submitAssign(stale, { operation: OP_B });
    await expect(alertOf(dialog)).toHaveText(messages.open_assignment_exists);
    expect(await storedAssignments(id)).toEqual([
      { valid_from: today(), valid_to: null, kind: "active", operation_id: fixture.opA, site_id: siteId(), reason: null },
    ]);
    expect(await assignmentAudit(id)).toHaveLength(1);
  });

  test("a backdated assignment that overlaps a closed past assignment shows the overlap message", async ({ page }) => {
    const fixture = await seedFixture(["ASG-7"]);
    const id = idOf(fixture, "ASG-7");
    await withSeeder(async (seeder) => {
      await seeder.assign({ equipmentId: id, operationId: fixture.opA, day: PAST, reason: "Loaded late" });
      await seeder.end({ equipmentId: id, day: "2026-02-01", reason: "Parked" });
    });
    await gotoDetail(page, id, "ASG-7");
    const dialog = await submitAssign(page, { operation: OP_B, day: "2026-01-20", reason: "Backfill" });
    await expect(alertOf(dialog)).toHaveText(messages.assignment_overlap);
    expect(await storedAssignments(id)).toHaveLength(1);
    expect(await assignmentAudit(id)).toHaveLength(2);
  });

  test("an archived operation is not offered in the select", async ({ page }) => {
    const fixture = await seedFixture(["ASG-8"]);
    await archiveOperationAsOwner(fixture.opB);
    await gotoDetail(page, idOf(fixture, "ASG-8"), "ASG-8");
    const dialog = await openDialog(page, d.assignEquipment.trigger, buttonsOf(page));
    const options = operationsOf(dialog, d.assignEquipment.operationLabel);
    await expect(options.filter({ hasText: OP_A })).toHaveCount(1);
    await expect(options.filter({ hasText: WORLD_OP })).toHaveCount(1);
    await expect(options.filter({ hasText: OP_B })).toHaveCount(0);
  });
});

test.describe("move an equipment from the detail page", () => {
  test.use({ storageState: storageStatePath("fleet_analyst") });
  test.beforeEach(resetCatalogs);

  test("closes the old row the day before and opens a new one", async ({ page }) => {
    const { fixture, id } = await seedAssigned("MOV-1");
    await gotoDetail(page, id, "MOV-1");
    await submitMove(page, { operation: OP_B, day: "2026-02-10", reason: "Contract started" });
    await expectDialogClosed(page);
    await expect(valueOf(locationCard(page), t.location.operation)).toHaveText(OP_B);
    await expect(valueOf(locationCard(page), t.location.since)).toHaveText("10/02/2026");
    await expect(pillOf(page)).toHaveText(copy.fleet.state.active);
    await gotoDetail(page, id, "MOV-1", "history");
    await expect(historyRows(page)).toHaveCount(2);
    const [open, closed] = [historyRows(page).nth(0), historyRows(page).nth(1)];
    await expect(open).toContainText("10/02/2026");
    await expect(open).toContainText(t.history.open);
    await expect(open).toContainText(OP_B);
    await expect(open).toContainText(t.kinds.active);
    await expect(closed).toContainText("05/01/2026");
    await expect(closed).toContainText("09/02/2026");
    await expect(closed).toContainText(OP_A);
    await expect(closed).toContainText(t.kinds.active);
    expect(await storedAssignments(id)).toEqual([
      { valid_from: PAST, valid_to: "2026-02-09", kind: "active", operation_id: fixture.opA, site_id: siteId(), reason: "Contract started" },
      { valid_from: "2026-02-10", valid_to: null, kind: "active", operation_id: fixture.opB, site_id: siteId(), reason: "Contract started" },
    ]);
    const moves = (await assignmentAudit(id)).filter((entry) => entry.action === "fleet.assignment.move");
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ reason: "Contract started", entity_type: "equipment_assignment" });
    expect(moves[0]?.before).toMatchObject({ operationId: fixture.opA, validTo: null });
    expect(moves[0]?.after).toMatchObject({ operationId: fixture.opB, validFrom: "2026-02-10", validTo: null });
  });

  test("does not offer the current operation", async ({ page }) => {
    const { id } = await seedAssigned("MOV-2");
    await gotoDetail(page, id, "MOV-2");
    const dialog = await openDialog(page, d.moveEquipment.trigger, buttonsOf(page));
    const options = operationsOf(dialog, d.moveEquipment.operationLabel);
    await expect(options.filter({ hasText: OP_A })).toHaveCount(0);
    await expect(options.filter({ hasText: OP_B })).toHaveCount(1);
  });

  test("the reason is required and nothing changes without it", async ({ page }) => {
    const { id } = await seedAssigned("MOV-3");
    await gotoDetail(page, id, "MOV-3");
    const dialog = await submitMove(page, { operation: OP_B, day: "2026-02-10", reason: "   " });
    await expect(alertOf(dialog)).toHaveText(messages.reason_required);
    expect(await storedAssignments(id)).toHaveLength(1);
    expect((await assignmentAudit(id)).filter((entry) => entry.action === "fleet.assignment.move")).toHaveLength(0);
  });

  test("an empty day and a day on or before the start show their errors", async ({ page }) => {
    const { id } = await seedAssigned("MOV-4");
    await gotoDetail(page, id, "MOV-4");
    const dialog = await submitMove(page, { operation: OP_B, day: "", reason: "Contract" });
    await expect(alertOf(dialog)).toHaveText(messages.invalid_day);
    await fill(dialog, d.moveEquipment.dayLabel, PAST);
    await submitDialog(dialog, d.moveEquipment.submit);
    await expect(alertOf(dialog)).toHaveText(messages.invalid_period);
    expect(await storedAssignments(id)).toHaveLength(1);
  });

  test("a stale page whose assignment was ended elsewhere shows the no-open-assignment message", async ({ page, context }) => {
    const { id } = await seedAssigned("MOV-5");
    const stale = await context.newPage();
    await gotoDetail(stale, id, "MOV-5");
    await gotoDetail(page, id, "MOV-5");
    await submitEnd(page, { day: "2026-02-01", reason: "Parked" });
    await expectDialogClosed(page);
    await expect(pillOf(page)).toHaveText(copy.fleet.state.unassigned);
    const dialog = await submitMove(stale, { operation: OP_B, day: "2026-02-10", reason: "Contract" });
    await expect(alertOf(dialog)).toHaveText(messages.no_open_assignment);
    expect(await storedAssignments(id)).toHaveLength(1);
  });
});

test.describe("end an assignment from the detail page", () => {
  test.use({ storageState: storageStatePath("fleet_analyst") });
  test.beforeEach(resetCatalogs);

  test("leaves the equipment Sin asignar and keeps the row with its last day", async ({ page }) => {
    const { fixture, id } = await seedAssigned("END-1");
    await gotoDetail(page, id, "END-1");
    await submitEnd(page, { day: "2026-03-01", reason: "Parked" });
    await expectDialogClosed(page);
    await expect(pillOf(page)).toHaveText(copy.fleet.state.unassigned);
    await expect(locationCard(page).getByText(t.location.none, { exact: true })).toBeVisible();
    await expect(buttonNamed(page, d.assignEquipment.trigger)).toHaveCount(1);
    await expect(buttonNamed(page, d.endAssignment.trigger)).toHaveCount(0);
    await gotoDetail(page, id, "END-1", "history");
    await expect(historyRows(page)).toHaveCount(1);
    await expect(historyRows(page).first()).toContainText("05/01/2026");
    await expect(historyRows(page).first()).toContainText("01/03/2026");
    await expect(historyRows(page).first()).toContainText("Parked");
    await expect(historyRows(page).first()).not.toContainText(t.history.open);
    expect(await storedAssignments(id)).toEqual([
      { valid_from: PAST, valid_to: "2026-03-01", kind: "active", operation_id: fixture.opA, site_id: siteId(), reason: "Parked" },
    ]);
    const ends = (await assignmentAudit(id)).filter((entry) => entry.action === "fleet.assignment.end");
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({ reason: "Parked", entity_type: "equipment_assignment" });
    expect(ends[0]?.before).toMatchObject({ validTo: null });
    expect(ends[0]?.after).toMatchObject({ validTo: "2026-03-01" });
  });

  test("an end day before the start shows the period error", async ({ page }) => {
    const { id } = await seedAssigned("END-2");
    await gotoDetail(page, id, "END-2");
    const dialog = await submitEnd(page, { day: "2026-01-04", reason: "Typo" });
    await expect(alertOf(dialog)).toHaveText(messages.invalid_period);
    expect((await storedAssignments(id))[0]?.valid_to).toBeNull();
  });

  test("the reason is required and an empty day is rejected", async ({ page }) => {
    const { id } = await seedAssigned("END-3");
    await gotoDetail(page, id, "END-3");
    const dialog = await submitEnd(page, { day: "2026-03-01", reason: "" });
    await expect(alertOf(dialog)).toHaveText(messages.reason_required);
    await fill(dialog, d.endAssignment.dayLabel, "");
    await fill(dialog, copy.common.reason, "Parked");
    await submitDialog(dialog, d.endAssignment.submit);
    await expect(alertOf(dialog)).toHaveText(messages.invalid_day);
    expect((await storedAssignments(id))[0]?.valid_to).toBeNull();
    expect((await assignmentAudit(id)).filter((entry) => entry.action === "fleet.assignment.end")).toHaveLength(0);
  });
});

test.describe("correct an assignment from the Historial", () => {
  test.use({ storageState: storageStatePath("fleet_analyst") });
  test.beforeEach(resetCatalogs);

  test("opens prefilled and changing the start needs the reason, then shows the new day and audits before and after", async ({ page }) => {
    const { fixture, id } = await seedTwoClosed("COR-1");
    await gotoDetail(page, id, "COR-1", "history");
    const dialog = await openCorrection(page, 1);
    await expect(dialog.getByLabel(d.correctAssignment.fromLabel, { exact: true })).toHaveValue(PAST);
    await expect(dialog.getByLabel(d.correctAssignment.toLabel, { exact: true })).toHaveValue("2026-02-09");
    await expect(dialog.getByLabel(d.correctAssignment.operationLabel, { exact: true }).locator("option:checked")).toHaveText(OP_A);
    await fillCorrection(dialog, { from: "2026-01-03" });
    await submitDialog(dialog, d.correctAssignment.submit);
    await expect(alertOf(dialog)).toHaveText(messages.reason_required);
    expect((await storedAssignments(id))[0]?.valid_from).toBe(PAST);
    await fillCorrection(dialog, { reason: "Wrong start day" });
    await submitDialog(dialog, d.correctAssignment.submit);
    await expectDialogClosed(page);
    await expect(historyRows(page).nth(1)).toContainText("03/01/2026");
    await expect(historyRows(page).nth(1)).toContainText("Wrong start day");
    const stored = await storedAssignments(id);
    expect(stored[0]).toMatchObject({ valid_from: "2026-01-03", valid_to: "2026-02-09", operation_id: fixture.opA, site_id: siteId(), reason: "Wrong start day" });
    const [entry] = (await assignmentAudit(id)).filter((row) => row.action === "fleet.assignment.correct");
    expect(entry).toMatchObject({ reason: "Wrong start day", entity_type: "equipment_assignment" });
    expect(entry?.before).toMatchObject({ validFrom: PAST, validTo: "2026-02-09", reason: "Contract started" });
    expect(entry?.after).toMatchObject({ validFrom: "2026-01-03", validTo: "2026-02-09", reason: "Wrong start day" });
  });

  test("changes the end day of a closed row", async ({ page }) => {
    const { id } = await seedTwoClosed("COR-2");
    await gotoDetail(page, id, "COR-2", "history");
    await submitCorrection(page, 0, { to: "2026-03-10", reason: "Left later" });
    await expectDialogClosed(page);
    await expect(historyRows(page).nth(0)).toContainText("10/03/2026");
    expect((await storedAssignments(id))[1]).toMatchObject({ valid_to: "2026-03-10", reason: "Left later" });
  });

  test("changes the operation of a row and keeps it active", async ({ page }) => {
    const { fixture, id } = await seedTwoClosed("COR-3");
    await gotoDetail(page, id, "COR-3", "history");
    await submitCorrection(page, 1, { operation: WORLD_OP, reason: "Was at the base" });
    await expectDialogClosed(page);
    const row = historyRows(page).nth(1);
    await expect(row).toContainText(t.kinds.active);
    await expect(row).toContainText(WORLD_OP);
    const stored = await storedAssignments(id);
    expect(stored[0]).toMatchObject({ kind: "active", reason: "Was at the base" });
    expect(stored[0]?.operation_id).not.toBe(fixture.opA);
    const [entry] = (await assignmentAudit(id)).filter((audit) => audit.action === "fleet.assignment.correct");
    expect(entry?.before).toMatchObject({ kind: "active", operationId: fixture.opA });
    expect(entry?.after).toMatchObject({ kind: "active" });
  });

  test("changes the place of a row to Muleto at a site: it becomes a spare with no operation", async ({ page }) => {
    const { fixture, id } = await seedTwoClosed("COR-5");
    await gotoDetail(page, id, "COR-5", "history");
    await submitCorrection(page, 1, { site: WORLD_ORG.site, reason: "Was a spare at the base" });
    await expectDialogClosed(page);
    const row = historyRows(page).nth(1);
    await expect(row).toContainText(t.kinds.spare);
    await expect(row).toContainText(WORLD_ORG.site);
    await expect(row.locator(`td[data-label="${t.history.operation}"]`)).toHaveText(copy.fleet.noValue);
    expect((await storedAssignments(id))[0]).toMatchObject({ kind: "spare", operation_id: null, site_id: siteId(), reason: "Was a spare at the base" });
    const [entry] = (await assignmentAudit(id)).filter((audit) => audit.action === "fleet.assignment.correct");
    expect(entry?.before).toMatchObject({ kind: "active", operationId: fixture.opA });
    expect(entry?.after).toMatchObject({ kind: "spare" });
  });

  test("a correction with no change shows the no-changes message", async ({ page }) => {
    const { id } = await seedTwoClosed("COR-4");
    await gotoDetail(page, id, "COR-4", "history");
    const dialog = await submitCorrection(page, 1, { reason: "Looks wrong" });
    await expect(alertOf(dialog)).toHaveText(messages.no_changes);
    expect((await assignmentAudit(id)).filter((entry) => entry.action === "fleet.assignment.correct")).toHaveLength(0);
  });

  test("an end that overlaps another row of the equipment shows the overlap message", async ({ page }) => {
    const { id } = await seedTwoClosed("COR-5");
    await gotoDetail(page, id, "COR-5", "history");
    const dialog = await submitCorrection(page, 1, { to: "2026-02-15", reason: "Extend" });
    await expect(alertOf(dialog)).toHaveText(messages.assignment_overlap);
    expect((await storedAssignments(id))[0]?.valid_to).toBe("2026-02-09");
  });

  test("an end before the start shows the period error", async ({ page }) => {
    const { id } = await seedTwoClosed("COR-6");
    await gotoDetail(page, id, "COR-6", "history");
    const dialog = await submitCorrection(page, 0, { from: "2026-03-05", reason: "Typo" });
    await expect(alertOf(dialog)).toHaveText(messages.invalid_period);
    expect((await storedAssignments(id))[1]?.valid_from).toBe("2026-02-10");
  });

  test("reopening a closed row whose operation was archived afterwards is refused, but a date-only correction still works", async ({ page }) => {
    const fixture = await seedFixture(["COR-7"]);
    const id = idOf(fixture, "COR-7");
    await withSeeder(async (seeder) => {
      await seeder.assign({ equipmentId: id, operationId: fixture.opB, day: PAST, reason: "Loaded late" });
      await seeder.end({ equipmentId: id, day: "2026-02-01", reason: "Parked" });
    });
    await archiveOperationAsOwner(fixture.opB);
    await gotoDetail(page, id, "COR-7", "history");
    const dialog = await submitCorrection(page, 0, { to: "", reason: "Still there" });
    await expect(alertOf(dialog)).toHaveText(messages.operation_archived);
    expect((await storedAssignments(id))[0]?.valid_to).toBe("2026-02-01");
    await fillCorrection(dialog, { to: "2026-02-05", reason: "Left on the fifth" });
    await submitDialog(dialog, d.correctAssignment.submit);
    await expectDialogClosed(page);
    await expect(historyRows(page).nth(0)).toContainText("05/02/2026");
    expect((await storedAssignments(id))[0]).toMatchObject({ valid_to: "2026-02-05", operation_id: fixture.opB });
  });

  test("clearing the end of the latest closed row opens it again", async ({ page }) => {
    const fixture = await seedFixture(["COR-8"]);
    const id = idOf(fixture, "COR-8");
    await withSeeder(async (seeder) => {
      await seeder.assign({ equipmentId: id, operationId: fixture.opA, day: PAST, reason: "Loaded late" });
      await seeder.end({ equipmentId: id, day: "2026-02-01", reason: "Parked" });
    });
    await gotoDetail(page, id, "COR-8", "history");
    await submitCorrection(page, 0, { to: "", reason: "It never left" });
    await expectDialogClosed(page);
    await expect(historyRows(page).nth(0)).toContainText(t.history.open);
    await expect(pillOf(page)).toHaveText(copy.fleet.state.active);
    expect((await storedAssignments(id))[0]?.valid_to).toBeNull();
  });
});

test.describe("the Historial after a sequence of changes", () => {
  test.use({ storageState: storageStatePath("fleet_analyst") });
  test.beforeEach(resetCatalogs);

  test("assign, move, end and assign again read as one timeline, newest first, with contiguous periods", async ({ page }) => {
    const fixture = await seedFixture(["SEQ-1"]);
    const id = idOf(fixture, "SEQ-1");
    await gotoDetail(page, id, "SEQ-1");
    await submitAssign(page, { operation: OP_A, day: PAST, reason: "Loaded late" });
    await expectDialogClosed(page);
    await expect(pillOf(page)).toHaveText(copy.fleet.state.active);
    await submitMove(page, { operation: OP_B, day: "2026-02-10", reason: "Contract started" });
    await expectDialogClosed(page);
    await expect(valueOf(locationCard(page), t.location.operation)).toHaveText(OP_B);
    await submitEnd(page, { day: "2026-03-01", reason: "Parked" });
    await expectDialogClosed(page);
    await expect(pillOf(page)).toHaveText(copy.fleet.state.unassigned);
    await submitAssign(page, { site: WORLD_ORG.site, day: "2026-03-02", reason: "Back as spare" });
    await expectDialogClosed(page);
    await expect(pillOf(page)).toHaveText(copy.fleet.state.spare);
    await gotoDetail(page, id, "SEQ-1", "history");
    await expect(historyRows(page)).toHaveCount(3);
    const [latest, middle, first] = [historyRows(page).nth(0), historyRows(page).nth(1), historyRows(page).nth(2)];
    for (const text of ["02/03/2026", t.history.open, WORLD_ORG.site, t.kinds.spare, "Back as spare"]) await expect(latest).toContainText(text);
    await expect(latest.locator(`td[data-label="${t.history.operation}"]`)).toHaveText(copy.fleet.noValue);
    for (const text of ["10/02/2026", "01/03/2026", OP_B, t.kinds.active, "Parked"]) await expect(middle).toContainText(text);
    for (const text of ["05/01/2026", "09/02/2026", OP_A, t.kinds.active, "Contract started"]) await expect(first).toContainText(text);
    const days = (await storedAssignments(id)).map((row) => [row.valid_from, row.valid_to]);
    expect(days).toEqual([[PAST, "2026-02-09"], ["2026-02-10", "2026-03-01"], ["2026-03-02", null]]);
    const actions = (await assignmentAudit(id)).map((entry) => entry.action);
    expect(actions).toEqual(["fleet.assignment.create", "fleet.assignment.move", "fleet.assignment.end", "fleet.assignment.create"]);
  });
});

test.describe("blocks seen from the interface", () => {
  test.use({ storageState: storageStatePath("fleet_analyst") });
  test.beforeEach(resetCatalogs);

  test("an equipment with an open assignment has no Dar de baja button", async ({ page }) => {
    const { id } = await seedAssigned("BLK-1");
    await gotoDetail(page, id, "BLK-1");
    await expect(buttonNamed(page, d.archive.trigger)).toHaveCount(0);
    await submitEnd(page, { day: "2026-03-01", reason: "Parked" });
    await expectDialogClosed(page);
    await expect(buttonNamed(page, d.archive.trigger)).toHaveCount(1);
  });

  test("a stale page that still has Dar de baja shows the has-open-assignment message", async ({ page, context }) => {
    const fixture = await seedFixture(["BLK-2"]);
    const id = idOf(fixture, "BLK-2");
    const stale = await context.newPage();
    await gotoDetail(stale, id, "BLK-2");
    await expect(buttonNamed(stale, d.archive.trigger)).toHaveCount(1);
    await gotoDetail(page, id, "BLK-2");
    await submitAssign(page, { operation: OP_A });
    await expectDialogClosed(page);
    await expect(pillOf(page)).toHaveText(copy.fleet.state.active);
    const dialog = await openDialog(stale, d.archive.trigger, buttonsOf(stale));
    await fill(dialog, copy.common.reason, "Not needed");
    await submitDialog(dialog, d.archive.submit);
    await expect(alertOf(dialog)).toHaveText(messages.has_open_assignment);
    await expect(openDialogOf(stale)).toBeVisible();
    expect(await storedAssignments(id)).toHaveLength(1);
  });

  test("an operation with an open assignment cannot be archived from /organization until the assignment is ended", async ({ page }) => {
    const { id } = await seedAssigned("BLK-3");
    await page.goto("/organization");
    await expect(rowOf(page, OP_A)).toBeVisible();
    const refused = await archiveOrRestore(page, archiveButton(rowOf(page, OP_A)), "archive", "Closing the operation");
    await expect(alertOf(refused)).toHaveText(messages.has_open_assignments);
    await page.keyboard.press("Escape");
    await expect(rowOf(page, OP_A)).toBeVisible();
    await gotoDetail(page, id, "BLK-3");
    await submitEnd(page, { day: "2026-03-01", reason: "Parked" });
    await expectDialogClosed(page);
    await expect(pillOf(page)).toHaveText(copy.fleet.state.unassigned);
    await page.goto("/organization");
    const dialog = await archiveOrRestore(page, archiveButton(rowOf(page, OP_A)), "archive", "Closing the operation");
    await expect(dialog).toBeHidden();
    await expect(rowOf(page, OP_A)).toHaveCount(0);
  });
});

test.describe("who can submit the assignment dialogs", () => {
  test.beforeEach(resetCatalogs);

  test.describe("as an administrator", () => {
    test.use({ storageState: storageStatePath("admin") });

    test("assigns, moves, corrects and ends, and the data changes", async ({ page }) => {
      const fixture = await seedFixture(["ROL-1"]);
      const id = idOf(fixture, "ROL-1");
      await gotoDetail(page, id, "ROL-1");
      await submitAssign(page, { operation: OP_A, day: PAST, reason: "Loaded late" });
      await expectDialogClosed(page);
      await expect(pillOf(page)).toHaveText(copy.fleet.state.active);
      await submitMove(page, { operation: OP_B, day: "2026-02-10", reason: "Contract started" });
      await expectDialogClosed(page);
      await expect(valueOf(locationCard(page), t.location.operation)).toHaveText(OP_B);
      await submitEnd(page, { day: "2026-03-01", reason: "Parked" });
      await expectDialogClosed(page);
      await expect(pillOf(page)).toHaveText(copy.fleet.state.unassigned);
      await gotoDetail(page, id, "ROL-1", "history");
      await submitCorrection(page, 1, { to: "2026-02-08", reason: "Typo" });
      await expectDialogClosed(page);
      await expect(historyRows(page).nth(1)).toContainText("08/02/2026");
      expect((await storedAssignments(id)).map((row) => row.valid_to)).toEqual(["2026-02-08", "2026-03-01"]);
      expect((await assignmentAudit(id)).map((entry) => entry.action)).toEqual([
        "fleet.assignment.create",
        "fleet.assignment.move",
        "fleet.assignment.end",
        "fleet.assignment.correct",
      ]);
    });
  });

  test.describe("as a viewer", () => {
    test.use({ storageState: storageStatePath("viewer") });

    test("sees the data but has no dialog to submit", async ({ page }) => {
      const { id } = await seedAssigned("ROL-2");
      await gotoDetail(page, id, "ROL-2", "history");
      await expect(historyRows(page)).toHaveCount(1);
      await expect(page.locator("#content").getByRole("button")).toHaveCount(0);
    });
  });
});
