/**
 * Locators and flows for the Organization page (`/organization`), shared by its specs.
 * Dialogs are native `<dialog>` elements: a closed one is hidden, so `getByRole("dialog")`
 * only ever finds the open one.
 */
import { expect, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { copy } from "../../app/_lib/copy";
import { readWorld } from "./world";

export const dialogs = copy.dialogs;
export const messages = copy.errors.byCode;

/** The header of a division card (name, tag, count and its row actions). */
export const divisionHeader = (page: Page, name: string): Locator =>
  page.locator("header.group-head").filter({ has: page.getByRole("heading", { level: 3, name, exact: true }) });

/** The row of an operation or of a site, found by its row header (the name). */
export const rowOf = (page: Page, name: string): Locator =>
  page.getByRole("row").filter({ has: page.getByRole("rowheader", { name, exact: true }) });

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Same, restricted to archived rows, whose name may be reused by an active row. The row header of
 * an archived row reads "<NAME> <tag>", so the name matches alone or followed by the tag, and a
 * longer name that merely starts with it ("OP", "OP BIS") does not.
 */
export const archivedRowOf = (page: Page, name: string): Locator => {
  const named = new RegExp(`^${escapeRegExp(name)}(\\s+${escapeRegExp(copy.common.archivedTag)})?$`);
  return page.locator('tr[data-archived="true"]').filter({ has: page.getByRole("rowheader", { name: named }) });
};

/**
 * Clicks the trigger and waits for the dialog. The click is repeated until the dialog shows,
 * because a click that lands before React has hydrated the page does nothing.
 */
export const openDialog = async (page: Page, trigger: Locator): Promise<Locator> => {
  const dialog = page.getByRole("dialog");
  await expect(async () => {
    if (!(await dialog.isVisible())) await trigger.click();
    await expect(dialog).toBeVisible({ timeout: 1_000 });
  }).toPass();
  return dialog;
};

export const submitDialog = (dialog: Locator, label: string): Promise<void> =>
  dialog.getByRole("button", { name: label, exact: true }).click();

export type OperationFields = { name?: string; division?: string; site?: string; costCenter?: string; reason?: string };

/** Fills only the given fields; selects are chosen by the visible (uppercase) name. */
export async function fillOperation(dialog: Locator, fields: OperationFields): Promise<void> {
  const t = dialogs.newOperation;
  if (fields.name !== undefined) await dialog.getByLabel(t.nameLabel, { exact: true }).fill(fields.name);
  if (fields.division !== undefined) await dialog.getByLabel(t.divisionLabel, { exact: true }).selectOption({ label: fields.division });
  if (fields.site !== undefined) await dialog.getByLabel(t.siteLabel, { exact: true }).selectOption({ label: fields.site });
  if (fields.costCenter !== undefined) await dialog.getByLabel(t.costCenterLabel, { exact: true }).fill(fields.costCenter);
  if (fields.reason !== undefined) await dialog.getByLabel(copy.common.reason, { exact: true }).fill(fields.reason);
}

/** Submits the dialog's form with the browser's own validation switched off, to reach the server rules. */
export const skipBrowserValidation = (dialog: Locator): Promise<void> =>
  dialog.locator("form").evaluate((form: HTMLFormElement) => {
    form.noValidate = true;
  });

async function createByName(page: Page, t: { trigger: string; nameLabel: string; submit: string }, name: string): Promise<void> {
  const dialog = await openDialog(page, page.getByRole("button", { name: t.trigger, exact: true }));
  await dialog.getByLabel(t.nameLabel, { exact: true }).fill(name);
  await submitDialog(dialog, t.submit);
  await expect(dialog).toBeHidden();
}

export const createDivisionInUi = (page: Page, name: string): Promise<void> => createByName(page, dialogs.newDivision, name);
export const createSiteInUi = (page: Page, name: string): Promise<void> => createByName(page, dialogs.newSite, name);

export async function createOperationInUi(page: Page, fields: Required<Omit<OperationFields, "reason">>): Promise<void> {
  const dialog = await openDialog(page, page.getByRole("button", { name: dialogs.newOperation.trigger, exact: true }));
  await fillOperation(dialog, fields);
  await submitDialog(dialog, dialogs.newOperation.submit);
  await expect(dialog).toBeHidden();
}

/** Opens the archive or restore dialog of a row, fills the reason and submits it. */
export async function archiveOrRestore(page: Page, trigger: Locator, verb: "archive" | "restore", reason: string): Promise<Locator> {
  const t = dialogs[verb];
  const dialog = await openDialog(page, trigger);
  await dialog.getByLabel(copy.common.reason, { exact: true }).fill(reason);
  await submitDialog(dialog, t.submit);
  return dialog;
}

/** Same as `archiveOrRestore`, for a change that must succeed: waits until the dialog closes. */
export async function confirmArchiveOrRestore(page: Page, trigger: Locator, verb: "archive" | "restore", reason: string): Promise<void> {
  const dialog = await archiveOrRestore(page, trigger, verb, reason);
  await expect(dialog).toBeHidden();
}

export const archiveButton = (scope: Locator): Locator =>
  scope.getByRole("button", { name: dialogs.archive.trigger, exact: true });

export const restoreButton = (scope: Locator): Locator =>
  scope.getByRole("button", { name: dialogs.restore.trigger, exact: true });

export const buttonNamed = (scope: Locator, name: string): Locator => scope.getByRole("button", { name, exact: true });

/**
 * Marks a row as archived straight in the database. The seeder acts as the administrator, who has
 * no `catalog.archive`, so suites that need an archived row for another role use this instead.
 */
export async function archiveAsOwner(table: "business_units" | "sites" | "operations", id: string): Promise<void> {
  const sql = postgres(readWorld().ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await sql`update ${sql(table)} set archived_at = now() where id = ${id}`;
  } finally {
    await sql.end();
  }
}
