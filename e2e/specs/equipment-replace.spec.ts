import { expect, test, type Page } from "@playwright/test";
import { copy } from "../../app/_lib/copy";
import { openSeeder, resetCatalogs } from "../support/data";
import { expectDialogClosed, openDialog } from "../support/fleet-flows";
import { boxOf, expectNoHorizontalScroll, VIEWPORT_HEIGHT, VIEWPORT_WIDTH } from "../support/mobile-flows";
import {
  DAYS,
  SHOWN,
  buttonsOf,
  catalogEntries,
  expectButtons,
  fillReplace,
  gotoDetail,
  historyRows,
  isStoredArchived,
  locationCard,
  outgoingGroup,
  pillOf,
  replaceEntries,
  replaceVia,
  seedReplaceWorld,
  storedAssignments,
  submitReplace,
  valueOf,
  type ReplaceWorld,
} from "../support/replace-flows";
import { readWorld, storageStatePath, WORLD_ORG } from "../support/world";

const t = copy.fleet.detail;
const r = copy.dialogs.replaceEquipment;
const byCode = copy.errors.byCode;
const REASON = "New unit arrived from the supplier";
const siteId = (): string => readWorld().ids.site;

/** Opens the Historial tab of an equipment. */
async function historyOf(page: Page, id: string, code: string): Promise<void> {
  await gotoDetail(page, id, code, "history");
}

test.describe("replacing an equipment as a fleet analyst", () => {
  test.use({ storageState: storageStatePath("fleet_analyst") });
  test.beforeEach(resetCatalogs);

  test("offers only free active equipment: not the assigned, the archived nor the equipment itself", async ({ page }) => {
    const w = await seedReplaceWorld("A1");
    await gotoDetail(page, w.outgoing, w.codes.outgoing);
    const dialog = await openDialog(page, r.trigger, buttonsOf(page));
    const options = dialog.getByLabel(r.incomingLabel, { exact: true }).locator("option");
    await expect(options).toHaveText([r.selectIncoming, `${w.codes.incoming} - FORKLIFT`]);
    await expect(dialog.getByText(r.incomingHint)).toBeVisible();
  });

  test("with the outgoing equipment as muleto: the incoming is Activo and the outgoing becomes a Muleto of the site, with no operation", async ({ page }) => {
    const w = await seedReplaceWorld("A2");
    const operation = readWorld().ids.operation;
    await gotoDetail(page, w.outgoing, w.codes.outgoing);
    await replaceVia(page, { incoming: w.codes.incoming, day: DAYS.replace, reason: REASON });
    await expectDialogClosed(page);

    // The page of the outgoing equipment refreshed: Muleto from the replacement day.
    await expect(pillOf(page)).toHaveText(copy.fleet.state.spare);
    await expect(valueOf(locationCard(page), t.location.kind)).toHaveText(t.kinds.spare);
    await expect(valueOf(locationCard(page), t.location.site)).toHaveText(WORLD_ORG.site);
    await expect(locationCard(page).getByText(t.location.operation, { exact: true })).toHaveCount(0);
    await expect(valueOf(locationCard(page), t.location.since)).toHaveText(SHOWN.replace);
    await expectButtons(page, ["move", "replace", "end", "edit"]);

    // Stored rows: the old one closed the day before, a spare one open; the incoming one is active and open.
    expect(await storedAssignments(w.outgoing)).toEqual([
      { kind: "active", from: DAYS.start, to: DAYS.before, operationId: operation, siteId: siteId(), reason: REASON },
      { kind: "spare", from: DAYS.replace, to: null, operationId: null, siteId: siteId(), reason: REASON },
    ]);
    expect(await storedAssignments(w.incoming)).toEqual([
      { kind: "active", from: DAYS.replace, to: null, operationId: operation, siteId: siteId(), reason: REASON },
    ]);
    expect(await isStoredArchived(w.outgoing)).toBe(false);
  });

  test("with muleto, both Historial tabs tell the story", async ({ page }) => {
    const w = await seedReplaceWorld("A3");
    await gotoDetail(page, w.outgoing, w.codes.outgoing);
    await replaceVia(page, { incoming: w.codes.incoming, day: DAYS.replace, reason: REASON });
    await expectDialogClosed(page);

    await historyOf(page, w.outgoing, w.codes.outgoing);
    await expect(historyRows(page)).toHaveCount(2);
    const [spare, old] = [historyRows(page).nth(0), historyRows(page).nth(1)];
    await expect(spare).toContainText(SHOWN.replace);
    await expect(spare).toContainText(t.history.open);
    await expect(spare).toContainText(t.kinds.spare);
    await expect(spare).toContainText(REASON);
    await expect(old).toContainText(SHOWN.start);
    await expect(old).toContainText(SHOWN.before);
    await expect(old).toContainText(t.kinds.active);

    await historyOf(page, w.incoming, w.codes.incoming);
    await expect(pillOf(page)).toHaveText(copy.fleet.state.active);
    await expect(historyRows(page)).toHaveCount(1);
    await expect(historyRows(page).first()).toContainText(SHOWN.replace);
    await expect(historyRows(page).first()).toContainText(t.history.open);
    await expect(historyRows(page).first()).toContainText("OPERATION E2E");
    await expect(historyRows(page).first()).toContainText(t.kinds.active);
    await expect(historyRows(page).first()).toContainText(REASON);
  });

  test("with muleto, writes one fleet.assignment.replace audit entry with the reason and the choice", async ({ page }) => {
    const w = await seedReplaceWorld("A4");
    await gotoDetail(page, w.outgoing, w.codes.outgoing);
    await replaceVia(page, { incoming: w.codes.incoming, day: DAYS.replace, reason: REASON });
    await expectDialogClosed(page);
    const entries = await replaceEntries(w.outgoing);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: "fleet.assignment.replace", role: "fleet_analyst", reason: REASON });
    expect(entries[0]?.after).toMatchObject({ choice: "spare" });
    expect(await catalogEntries("fleet.archive", w.outgoing)).toHaveLength(0);
  });

  test("with baja: the outgoing is archived, its assignment ends the day before, and both audit entries exist", async ({ page }) => {
    const w = await seedReplaceWorld("B1");
    const operation = readWorld().ids.operation;
    await gotoDetail(page, w.outgoing, w.codes.outgoing);
    await replaceVia(page, { incoming: w.codes.incoming, day: DAYS.replace, outgoing: "retire", reason: REASON });
    await expectDialogClosed(page);

    await expect(pillOf(page)).toHaveText(copy.common.archivedTag);
    await expect(locationCard(page).getByText(t.location.noneHintArchived)).toBeVisible();
    await expectButtons(page, ["restore"]);
    expect(await isStoredArchived(w.outgoing)).toBe(true);
    expect(await storedAssignments(w.outgoing)).toEqual([
      { kind: "active", from: DAYS.start, to: DAYS.before, operationId: operation, siteId: siteId(), reason: REASON },
    ]);
    const replace = await replaceEntries(w.outgoing);
    expect(replace).toHaveLength(1);
    expect(replace[0]).toMatchObject({ reason: REASON, role: "fleet_analyst" });
    expect(replace[0]?.after).toMatchObject({ choice: "retire" });
    const archive = await catalogEntries("fleet.archive", w.outgoing);
    expect(archive).toHaveLength(1);
    expect(archive[0]).toMatchObject({ reason: REASON, role: "fleet_analyst" });
  });

  test("with baja: the outgoing's Historial ends the day before and the incoming is Activo in the same operation", async ({ page }) => {
    const w = await seedReplaceWorld("B2");
    await gotoDetail(page, w.outgoing, w.codes.outgoing);
    await replaceVia(page, { incoming: w.codes.incoming, day: DAYS.replace, outgoing: "retire", reason: REASON });
    await expectDialogClosed(page);

    await historyOf(page, w.outgoing, w.codes.outgoing);
    await expect(historyRows(page)).toHaveCount(1);
    await expect(historyRows(page).first()).toContainText(SHOWN.start);
    await expect(historyRows(page).first()).toContainText(SHOWN.before);
    await expect(historyRows(page).first().getByText(t.history.open, { exact: true })).toHaveCount(0);

    await gotoDetail(page, w.incoming, w.codes.incoming);
    await expect(pillOf(page)).toHaveText(copy.fleet.state.active);
    await expect(valueOf(locationCard(page), t.location.operation)).toHaveText("OPERATION E2E");
    await expect(valueOf(locationCard(page), t.location.since)).toHaveText(SHOWN.replace);
  });
});

test.describe("replacing an equipment as an administrator", () => {
  test.use({ storageState: storageStatePath("admin") });
  test.beforeEach(resetCatalogs);

  test("the baja is not offered, muleto is the only and preselected choice, and the replace works", async ({ page }) => {
    const w = await seedReplaceWorld("C1");
    await gotoDetail(page, w.outgoing, w.codes.outgoing);
    const dialog = await openDialog(page, r.trigger, buttonsOf(page));
    const group = outgoingGroup(dialog);
    await expect(group.getByRole("radio")).toHaveCount(1);
    await expect(group.getByRole("radio", { name: r.outgoingSpare })).toBeChecked();
    await expect(group.getByRole("radio", { name: r.outgoingRetire })).toHaveCount(0);
    await fillReplace(dialog, { incoming: w.codes.incoming, day: DAYS.replace, reason: REASON });
    await submitReplace(dialog);
    await expectDialogClosed(page);
    await expect(pillOf(page)).toHaveText(copy.fleet.state.spare);
    const entries = await replaceEntries(w.outgoing);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ role: "admin", reason: REASON });
    expect(entries[0]?.after).toMatchObject({ choice: "spare" });
    expect(await isStoredArchived(w.outgoing)).toBe(false);
  });
});

test.describe("replace validations and atomicity", () => {
  test.use({ storageState: storageStatePath("fleet_analyst") });
  test.beforeEach(resetCatalogs);

  test("asks for the incoming equipment", async ({ page }) => {
    const w = await seedReplaceWorld("D1");
    await gotoDetail(page, w.outgoing, w.codes.outgoing);
    const dialog = await replaceVia(page, { day: DAYS.replace, reason: REASON }, { serverOnly: true });
    await expect(dialog.getByRole("alert")).toHaveText(byCode.not_found);
    expect(await replaceEntries(w.outgoing)).toHaveLength(0);
    expect(await storedAssignments(w.outgoing)).toHaveLength(1);
  });

  test("asks for a reason and rejects a blank one", async ({ page }) => {
    const w = await seedReplaceWorld("D2");
    await gotoDetail(page, w.outgoing, w.codes.outgoing);
    const dialog = await replaceVia(page, { incoming: w.codes.incoming, day: DAYS.replace, reason: "   " }, { serverOnly: true });
    await expect(dialog.getByRole("alert")).toHaveText(byCode.reason_required);
    expect(await replaceEntries(w.outgoing)).toHaveLength(0);
    expect(await storedAssignments(w.incoming)).toHaveLength(0);
  });

  test("rejects a reason longer than 500 characters", async ({ page }) => {
    const w = await seedReplaceWorld("D3");
    await gotoDetail(page, w.outgoing, w.codes.outgoing);
    const dialog = await replaceVia(page, { incoming: w.codes.incoming, day: DAYS.replace, reason: "r".repeat(501) }, { serverOnly: true });
    await expect(dialog.getByRole("alert")).toHaveText(byCode.reason_too_long);
  });

  test("rejects a missing day", async ({ page }) => {
    const w = await seedReplaceWorld("D4");
    await gotoDetail(page, w.outgoing, w.codes.outgoing);
    const dialog = await replaceVia(page, { incoming: w.codes.incoming, day: "", reason: REASON }, { serverOnly: true });
    await expect(dialog.getByRole("alert")).toHaveText(byCode.invalid_day);
    expect(await replaceEntries(w.outgoing)).toHaveLength(0);
  });

  test("rejects a day on or before the start of the current assignment", async ({ page }) => {
    const w = await seedReplaceWorld("D5");
    await gotoDetail(page, w.outgoing, w.codes.outgoing);
    const dialog = await replaceVia(page, { incoming: w.codes.incoming, day: "2025-12-01", reason: REASON });
    await expect(dialog.getByRole("alert")).toHaveText(byCode.invalid_period);
    expect(await storedAssignments(w.outgoing)).toHaveLength(1);
    expect(await storedAssignments(w.incoming)).toHaveLength(0);
  });

  test("keeps what was typed after an error and succeeds once corrected", async ({ page }) => {
    const w = await seedReplaceWorld("D6");
    await gotoDetail(page, w.outgoing, w.codes.outgoing);
    const dialog = await replaceVia(page, { incoming: w.codes.incoming, day: DAYS.replace, outgoing: "retire", reason: "   " }, { serverOnly: true });
    await expect(dialog.getByRole("alert")).toHaveText(byCode.reason_required);
    await expect(dialog.getByLabel(r.incomingLabel, { exact: true }).locator("option:checked")).toHaveText(`${w.codes.incoming} - FORKLIFT`);
    await expect(dialog.getByLabel(r.dayLabel, { exact: true })).toHaveValue(DAYS.replace);
    await expect(outgoingGroup(dialog).getByRole("radio", { name: r.outgoingRetire })).toBeChecked();
    await fillReplace(dialog, { reason: REASON });
    await submitReplace(dialog);
    await expectDialogClosed(page);
    await expect(pillOf(page)).toHaveText(copy.common.archivedTag);
    expect(await replaceEntries(w.outgoing)).toHaveLength(1);
  });

  for (const choice of ["spare", "retire"] as const) {
    test(`a stale form: the incoming equipment was assigned elsewhere, so the replace with ${choice} is refused and nothing changes`, async ({ page }) => {
      const w = await seedReplaceWorld(`E-${choice}`);
      await gotoDetail(page, w.outgoing, w.codes.outgoing);
      const dialog = await openDialog(page, r.trigger, buttonsOf(page));
      await fillReplace(dialog, { incoming: w.codes.incoming, day: DAYS.replace, outgoing: choice, reason: REASON });
      // Meanwhile somebody else assigns the incoming equipment (the dialog was already rendered).
      const seeder = await openSeeder();
      try {
        await seeder.assign({ equipmentId: w.incoming, operationId: w.otherOperation, day: DAYS.start, reason: "Assigned meanwhile" });
      } finally {
        await seeder.close();
      }
      await submitReplace(dialog);
      await expect(dialog.getByRole("alert")).toHaveText(byCode.open_assignment_exists);
      await expect(dialog).toBeVisible();

      expect(await storedAssignments(w.outgoing)).toEqual([
        { kind: "active", from: DAYS.start, to: null, operationId: readWorld().ids.operation, siteId: siteId(), reason: "Loaded late" },
      ]);
      expect(await storedAssignments(w.incoming)).toEqual([
        { kind: "active", from: DAYS.start, to: null, operationId: w.otherOperation, siteId: w.otherSite, reason: "Assigned meanwhile" },
      ]);
      expect(await isStoredArchived(w.outgoing)).toBe(false);
      expect(await replaceEntries(w.outgoing)).toHaveLength(0);
      expect(await catalogEntries("fleet.archive", w.outgoing)).toHaveLength(0);
    });
  }
});

test.describe("replacing an equipment on a phone", () => {
  test.use({ storageState: storageStatePath("fleet_analyst") });
  test.beforeEach(resetCatalogs);

  async function openReplace(page: Page, w: ReplaceWorld) {
    await gotoDetail(page, w.outgoing, w.codes.outgoing);
    return openDialog(page, r.trigger, buttonsOf(page));
  }

  test("@mobile the replace dialog fits the viewport, the footer is reachable and muleto is preselected", async ({ page }) => {
    const w = await seedReplaceWorld("M1");
    const dialog = await openReplace(page, w);
    const box = await boxOf(dialog);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(VIEWPORT_WIDTH);
    expect(box.width, "the dialog takes the width of the phone").toBeGreaterThan(VIEWPORT_WIDTH - 60);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(VIEWPORT_HEIGHT);
    await expect(outgoingGroup(dialog).getByRole("radio", { name: r.outgoingSpare })).toBeChecked();
    const submit = dialog.getByRole("button", { name: r.submit, exact: true });
    const cancel = dialog.getByRole("button", { name: copy.common.cancel, exact: true });
    await submit.scrollIntoViewIfNeeded();
    const [s, c] = [await boxOf(submit), await boxOf(cancel)];
    expect(s.width).toBeGreaterThan(VIEWPORT_WIDTH - 100);
    expect(s.y + s.height).toBeLessThanOrEqual(VIEWPORT_HEIGHT);
    expect(c.y, "the primary action comes first on a phone").toBeGreaterThan(s.y);
    await cancel.scrollIntoViewIfNeeded();
    await cancel.tap();
    await expect(dialog).toBeHidden();
  });

  test("@mobile the radios are tappable and a replace with baja can be submitted", async ({ page }) => {
    const w = await seedReplaceWorld("M2");
    const dialog = await openReplace(page, w);
    for (const radio of await outgoingGroup(dialog).getByRole("radio").all()) {
      await radio.scrollIntoViewIfNeeded();
      const box = await boxOf(radio.locator("xpath=ancestor::label[1]"));
      expect(box.height, "the whole choice is a tap target").toBeGreaterThanOrEqual(24);
    }
    await dialog.getByLabel(r.incomingLabel, { exact: true }).selectOption({ label: `${w.codes.incoming} - FORKLIFT` });
    await dialog.getByLabel(r.dayLabel, { exact: true }).fill(DAYS.replace);
    await dialog.getByLabel(copy.common.reason, { exact: true }).fill(REASON);
    const retire = outgoingGroup(dialog).getByRole("radio", { name: r.outgoingRetire });
    await retire.scrollIntoViewIfNeeded();
    await retire.locator("xpath=ancestor::label[1]").tap();
    await expect(retire).toBeChecked();
    const submit = dialog.getByRole("button", { name: r.submit, exact: true });
    await submit.scrollIntoViewIfNeeded();
    await submit.tap();
    await expect(dialog).toBeHidden();
    await expect(pillOf(page)).toHaveText(copy.common.archivedTag);
    await expectNoHorizontalScroll(page);
    expect(await replaceEntries(w.outgoing)).toHaveLength(1);
  });

  test("@mobile a replace with muleto can be submitted", async ({ page }) => {
    const w = await seedReplaceWorld("M3");
    const dialog = await openReplace(page, w);
    await fillReplace(dialog, { incoming: w.codes.incoming, day: DAYS.replace, reason: REASON });
    const submit = dialog.getByRole("button", { name: r.submit, exact: true });
    await submit.scrollIntoViewIfNeeded();
    await submit.tap();
    await expect(dialog).toBeHidden();
    await expect(pillOf(page)).toHaveText(copy.fleet.state.spare);
    await expectButtons(page, ["move", "replace", "end", "edit"]);
  });
});
