/**
 * Helpers of the Users and dashboard suites: seeding users and archiving rows straight in the
 * ephemeral database, and small page objects for the users table and its dialogs.
 */
import { expect, type Browser, type Locator, type Page } from "@playwright/test";
import postgres, { type Sql } from "postgres";
import { copy } from "../../app/_lib/copy";
import { createContainer } from "../../src/shared/infrastructure/container";
import type { Role } from "../../src/identity/domain/role";
import { submitCredentials } from "./auth-flows";
import { WORLD_USERS, BASE_URL, passwordOf, readWorld } from "./world";

// A stalled database fails the helper in ten seconds instead of hanging until the test timeout.
const openOwner = (): Sql => postgres(readWorld().ownerUrl, { max: 2, connect_timeout: 10, onnotice: () => undefined });

export type ScopeSeed = { readonly type: "business_unit" | "operation"; readonly id: string };
export type UserSeed = {
  readonly email: string;
  readonly displayName: string;
  readonly password: string;
  readonly role?: Role;
  readonly scope?: ScopeSeed;
};

/** Creates a user through the `createUser` use case, acting as the world's administrator. */
export async function seedUser(input: UserSeed): Promise<string> {
  const sql = openOwner();
  try {
    const c = createContainer(sql);
    const session = await c.identity.signIn.execute({ email: WORLD_USERS.admin.email, password: passwordOf("admin") });
    if (!session.ok) throw new Error(`Seeding sign-in failed: ${session.error.code}`);
    const context = await c.identity.authenticate.execute({ token: session.value.token });
    if (!context.ok) throw new Error(`Seeding authentication failed: ${context.error.code}`);
    const created = await c.identity.createUser.execute({ actor: context.value, ...input });
    if (!created.ok) throw new Error(`Seeding failed: ${created.error.code}`);
    return created.value.id;
  } finally {
    await sql.end();
  }
}

type ArchivableTable = "equipments" | "suppliers" | "asset_types" | "business_units" | "sites" | "operations";

/** Archives (or restores) rows directly, as the owner; the dashboard only needs `archived_at`. */
export async function setArchived(table: ArchivableTable, ids: readonly string[], archived: boolean): Promise<void> {
  const sql = openOwner();
  try {
    const value = archived ? sql`now()` : sql`null`;
    await sql`update ${sql(table)} set archived_at = ${value} where id in ${sql(ids)}`;
  } finally {
    await sql.end();
  }
}

/** The world's own organization rows; used to show the dashboard of a company with nothing registered. */
export async function setWorldOrganizationArchived(archived: boolean): Promise<void> {
  const { ids } = readWorld();
  const sql = openOwner();
  try {
    // One transaction: other suites rely on the world's organization, so it is never left half archived.
    await sql.begin(async (tx) => {
      const value = archived ? tx`now()` : tx`null`;
      await tx`update operations set archived_at = ${value} where id = ${ids.operation}`;
      await tx`update sites set archived_at = ${value} where id = ${ids.site}`;
      await tx`update business_units set archived_at = ${value} where id = ${ids.division}`;
    });
  } finally {
    await sql.end();
  }
}

/** Signs in through the real form in a brand-new browser context, with no stored session. */
export async function signInInNewContext(browser: Browser, email: string, password: string): Promise<Page> {
  const context = await browser.newContext({ baseURL: BASE_URL, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await submitCredentials(page, email, password);
  return page;
}

export const userRow = (page: Page, email: string): Locator => page.getByRole("row").filter({ hasText: email });

export const openDialog = async (page: Page, trigger: string, title: string, within?: Locator): Promise<Locator> => {
  await (within ?? page).getByRole("button", { name: trigger, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: title });
  await expect(dialog).toBeVisible();
  return dialog;
};

export const openNewUserDialog = (page: Page): Promise<Locator> =>
  openDialog(page, copy.dialogs.newUser.trigger, copy.dialogs.newUser.title);

export const openChangeRoleDialog = (page: Page, email: string): Promise<Locator> =>
  openDialog(page, copy.dialogs.changeRole.trigger, copy.dialogs.changeRole.title, userRow(page, email));

export type NewUserForm = { name: string; email: string; password: string };

export async function fillNewUserBasics(dialog: Locator, form: NewUserForm): Promise<void> {
  const t = copy.dialogs.newUser;
  await dialog.getByLabel(t.nameLabel).fill(form.name);
  await dialog.getByLabel(t.emailLabel, { exact: true }).fill(form.email);
  await dialog.getByLabel(t.passwordLabel).fill(form.password);
}

export type ScopePick = { role: string; kind?: string; division?: string; operation?: string };

/** Picks the role and then the scope level and targets the same way a person does, top to bottom. */
export async function pickRoleAndScope(dialog: Locator, pick: ScopePick): Promise<void> {
  await dialog.getByLabel(copy.common.role, { exact: true }).selectOption({ label: pick.role });
  if (pick.kind !== undefined) await dialog.getByLabel(copy.scope.label, { exact: true }).selectOption({ label: pick.kind });
  if (pick.division !== undefined) await dialog.getByLabel(copy.scope.division, { exact: true }).selectOption({ label: pick.division });
  if (pick.operation !== undefined) await dialog.getByLabel(copy.scope.operation, { exact: true }).selectOption({ label: pick.operation });
}

/** Lets the server judge the form: the browser would otherwise stop an invalid email before submit. */
export const skipBrowserValidation = (dialog: Locator): Promise<void> =>
  dialog.locator("form").evaluate((form: HTMLFormElement) => {
    form.noValidate = true;
  });

export const submit = (dialog: Locator, label: string): Promise<void> =>
  dialog.getByRole("button", { name: label, exact: true }).click();

export const optionTexts = (select: Locator): Promise<string[]> =>
  select.locator("option").evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).text.trim()));
