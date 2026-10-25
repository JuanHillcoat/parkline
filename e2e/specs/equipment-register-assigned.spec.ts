import { expect, test, type Page } from "@playwright/test";
import { copy } from "../../app/_lib/copy";
import { resetCatalogs } from "../support/data";
import {
  archiveOperationAsOwner, assignmentAudit, gotoDetail, historyRows, locationCard, pillOf, storedAssignments, today, valueOf,
} from "../support/assignment-flows";
import { expectDialogClosed, gotoFleet, rowOf } from "../support/fleet-flows";
import { boxOf, expectNoHorizontalScroll, VIEWPORT_HEIGHT, VIEWPORT_WIDTH } from "../support/mobile-flows";
import {
  actionsFor, d, expectNothingRegistered, fillAndSubmit, fillAssignment, groupOf, openNewEquipment, operationOptions,
  OP_ONE, OP_TWO, registeredId, registerWith, seedRegisterFixture, type Seeded,
} from "../support/register-assigned-flows";
import { storageStatePath, WORLD_ORG } from "../support/world";

const messages = copy.errors.byCode;
const t = copy.fleet.detail;
const ddmmyyyy = (iso: string): string => iso.split("-").reverse().join("/");

let fixture: Seeded;

const freshFixture = async (): Promise<void> => {
  await resetCatalogs();
  fixture = await seedRegisterFixture();
};

async function expectOnBoard(page: Page, code: string, operation: string, state: string): Promise<void> {
  await gotoFleet(page, "equipment");
  const row = rowOf(page, code);
  await expect(row).toContainText(operation);
  await expect(row).toContainText(state);
}

for (const role of ["admin", "fleet_analyst"] as const) {
  test.describe(`registering an assigned equipment as ${role}`, () => {
    test.use({ storageState: storageStatePath(role) });
    test.beforeEach(freshFixture);

    test("born active in an operation from today: the board and the detail show it assigned", async ({ page }) => {
      const code = `REG-A-${role.toUpperCase()}`;
      await registerWith(page, code, { operation: OP_ONE });
      await expectDialogClosed(page);
      await expectOnBoard(page, code, OP_ONE, copy.fleet.state.active);
      await expect(rowOf(page, code)).toContainText(WORLD_ORG.site);
      const id = await registeredId(code);
      await gotoDetail(page, id, code, "history");
      const row = historyRows(page);
      await expect(row).toHaveCount(1);
      await expect(row.first()).toContainText(OP_ONE);
      await expect(row.first()).toContainText(t.history.open);
      await expect(row.first()).toContainText(ddmmyyyy(today()));
      expect(await storedAssignments(id)).toEqual([
        { valid_from: today(), valid_to: null, kind: "active", operation_id: fixture.opOne, reason: null },
      ]);
      expect(await actionsFor(id)).toEqual(["fleet.equipment.create"]);
      expect((await assignmentAudit(id)).map((entry) => entry.action)).toEqual(["fleet.assignment.create"]);
    });
  });
}

test.describe("registering an assigned equipment", () => {
  test.use({ storageState: storageStatePath("fleet_analyst") });
  test.beforeEach(freshFixture);

  test("born as a muleto: the board and the detail say Muleto", async ({ page }) => {
    await registerWith(page, "REG-SPARE", { operation: OP_TWO, kind: "spare" });
    await expectDialogClosed(page);
    await expectOnBoard(page, "REG-SPARE", OP_TWO, copy.fleet.state.spare);
    const id = await registeredId("REG-SPARE");
    await gotoDetail(page, id, "REG-SPARE");
    await expect(pillOf(page)).toHaveText(copy.fleet.state.spare);
    await expect(valueOf(locationCard(page), t.location.operation)).toHaveText(OP_TWO);
    await expect(valueOf(locationCard(page), t.location.kind)).toHaveText(t.kinds.spare);
    expect((await storedAssignments(id))[0]).toMatchObject({ kind: "spare", operation_id: fixture.opTwo });
  });

  test("a past day with a reason is stored with the reason in the row and the audit entry", async ({ page }) => {
    await registerWith(page, "REG-PAST", { operation: OP_ONE, day: "2025-03-01", reason: "Cargado tarde" });
    await expectDialogClosed(page);
    const id = await registeredId("REG-PAST");
    expect(await storedAssignments(id)).toMatchObject([{ valid_from: "2025-03-01", reason: "Cargado tarde" }]);
    expect(await assignmentAudit(id)).toMatchObject([{ action: "fleet.assignment.create", reason: "Cargado tarde" }]);
  });

  test("a past day without a reason shows the message and creates nothing", async ({ page }) => {
    const dialog = await registerWith(page, "REG-NOREASON", { operation: OP_ONE, day: "2025-03-01" });
    await expect(dialog.getByRole("alert")).toContainText(messages.reason_required);
    await expectNothingRegistered("REG-NOREASON");
  });

  test("an archived operation is not offered, and the active ones are", async ({ page }) => {
    await archiveOperationAsOwner(fixture.opTwo);
    const dialog = await openNewEquipment(page);
    await expect(operationOptions(dialog).filter({ hasText: OP_ONE })).toHaveCount(1);
    await expect(operationOptions(dialog).filter({ hasText: OP_TWO })).toHaveCount(0);
  });

  test("registering without an operation still works and leaves the equipment unassigned", async ({ page }) => {
    const dialog = await openNewEquipment(page);
    await expect(groupOf(dialog)).toBeVisible();
    await fillAndSubmit(dialog, "REG-PLAIN", { kind: "spare", reason: "Ignored without an operation" });
    await expectDialogClosed(page);
    await expectOnBoard(page, "REG-PLAIN", copy.fleet.noValue, copy.fleet.state.unassigned);
    const id = await registeredId("REG-PLAIN");
    expect(await storedAssignments(id)).toEqual([]);
    expect(await assignmentAudit(id)).toEqual([]);
  });

  test("a stale form whose operation was archived meanwhile shows the typed message and creates nothing", async ({ page }) => {
    const dialog = await openNewEquipment(page);
    await fillAssignment(dialog, { operation: OP_ONE });
    await archiveOperationAsOwner(fixture.opOne);
    await fillAndSubmit(dialog, "REG-STALE", {});
    await expect(dialog.getByRole("alert")).toContainText(messages.operation_archived);
    await expectNothingRegistered("REG-STALE");
  });

  test("the group is labeled, the operation is empty and the kind and day have defaults", async ({ page }) => {
    const dialog = await openNewEquipment(page);
    const labels = d.assignEquipment;
    await expect(groupOf(dialog)).toBeVisible();
    await expect(dialog.getByLabel(labels.operationLabel, { exact: true })).toHaveValue("");
    await expect(dialog.getByLabel(labels.kindLabel, { exact: true })).toHaveValue("active");
    await expect(dialog.getByLabel(labels.dayLabel, { exact: true })).toHaveValue(today());
  });
});

for (const role of ["viewer", "manager", "supervisor"] as const) {
  test.describe(`${role} cannot register equipment`, () => {
    test.use({ storageState: storageStatePath(role) });
    test.beforeEach(freshFixture);

    test("has no Nuevo equipo button", async ({ page }) => {
      await page.goto("/fleet");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("button", { name: d.newEquipment.trigger })).toHaveCount(0);
    });
  });
}

test.describe("registering an assigned equipment on a phone", () => {
  test.use({ storageState: storageStatePath("fleet_analyst") });
  test.beforeEach(freshFixture);

  test("@mobile the dialog with the new group fits the viewport and reaches its submit button", async ({ page }) => {
    await page.goto("/fleet");
    await page.getByRole("button", { name: d.newEquipment.trigger }).tap();
    const dialog = page.getByRole("dialog", { name: d.newEquipment.title });
    await expect(dialog).toBeVisible();
    const box = await boxOf(dialog);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(VIEWPORT_WIDTH);
    expect(box.y + box.height).toBeLessThanOrEqual(VIEWPORT_HEIGHT);
    await groupOf(dialog).scrollIntoViewIfNeeded();
    const group = await boxOf(groupOf(dialog));
    expect(group.x).toBeGreaterThanOrEqual(0);
    expect(group.x + group.width).toBeLessThanOrEqual(VIEWPORT_WIDTH);
    await expectNoHorizontalScroll(page);
    const submit = dialog.getByRole("button", { name: d.newEquipment.submit });
    await submit.scrollIntoViewIfNeeded();
    await expect(submit).toBeInViewport();
  });
});

