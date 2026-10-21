import { expect, test, type Locator, type Page } from "@playwright/test";
import { copy } from "../../app/_lib/copy";
import { openSeeder, resetCatalogs } from "../support/data";
import {
  fillNewUserBasics,
  openChangeRoleDialog,
  openDialog,
  openNewUserDialog,
  optionTexts,
  pickRoleAndScope,
  seedUser,
  setArchived,
  signInInNewContext,
  skipBrowserValidation,
  submit,
  userRow,
} from "../support/users-flows";
import { ROLE_KEYS, WORLD_ORG, WORLD_USERS, storageStatePath, type RoleKey } from "../support/world";

const PASSWORD = "Correct-Horse-9";
const errors = copy.errors.byCode;
const newUser = copy.dialogs.newUser;
const role = copy.roles;

let costCenter = 1000;

/** A division with one active operation, created through the use cases. */
async function seedStructure(suffix: string) {
  costCenter += 1;
  const seeder = await openSeeder();
  try {
    const divisionName = `Norte ${suffix}`;
    const division = await seeder.division(divisionName);
    const site = await seeder.site(`Sitio ${suffix}`);
    const operationName = `Planta ${suffix}`;
    const operation = await seeder.operation({ division: division, site, name: operationName, costCenter: String(costCenter) });
    return {
      division,
      operation,
      divisionName: divisionName.toUpperCase(),
      operationOption: `${String(costCenter)} ${operationName.toUpperCase()}`,
    };
  } finally {
    await seeder.close();
  }
}

const roleCell = (page: Page, email: string): Locator =>
  userRow(page, email).locator(`td[data-label="${copy.users.columns.role}"]`);

const gotoUsers = async (page: Page): Promise<void> => {
  await page.goto("/users");
  await expect(page.getByRole("heading", { level: 1, name: copy.users.title })).toBeVisible();
};

const expectFormError = (dialog: Locator, message: string): Promise<void> =>
  expect(dialog.getByRole("alert").filter({ hasText: message })).toBeVisible();

test.describe("users table", () => {
  test.use({ storageState: storageStatePath("admin") });
  test.beforeEach(resetCatalogs);

  test("lists the world users with role, scope and an active badge", async ({ page }) => {
    await gotoUsers(page);
    const expected: Record<RoleKey, string> = {
      admin: `${role.admin} · ${copy.scope.company}`,
      fleet_analyst: `${role.fleet_analyst} · ${copy.scope.company}`,
      viewer: `${role.viewer} · ${copy.scope.company}`,
      manager: `${role.manager} · ${WORLD_ORG.division}`,
      supervisor: `${role.supervisor} · ${WORLD_ORG.costCenter} ${WORLD_ORG.operation}`,
    };
    for (const key of ROLE_KEYS) {
      const row = userRow(page, WORLD_USERS[key].email);
      await expect(row).toContainText(WORLD_USERS[key].displayName);
      await expect(roleCell(page, WORLD_USERS[key].email)).toHaveText(expected[key]);
      await expect(row.locator(".badge")).toHaveText(copy.common.active);
    }
  });

  test("marks only the current user with (tú)", async ({ page }) => {
    await gotoUsers(page);
    await expect(userRow(page, WORLD_USERS.admin.email)).toContainText(copy.common.you);
    await expect(page.getByText(copy.common.you, { exact: false })).toHaveCount(1);
  });

  test("offers no deactivate button on the own row but does on the others", async ({ page }) => {
    await gotoUsers(page);
    const own = userRow(page, WORLD_USERS.admin.email);
    await expect(own.getByRole("button", { name: copy.dialogs.changeRole.trigger })).toBeVisible();
    await expect(own.getByRole("button", { name: copy.dialogs.deactivate.trigger })).toHaveCount(0);
    const other = userRow(page, WORLD_USERS.viewer.email);
    await expect(other.getByRole("button", { name: copy.dialogs.deactivate.trigger })).toBeVisible();
  });

  test("shows a user without a role as 'Sin rol'", async ({ page }) => {
    await seedUser({ email: "norole@users.test", displayName: "No Role", password: PASSWORD });
    await gotoUsers(page);
    await expect(roleCell(page, "norole@users.test")).toHaveText(copy.common.noRole);
  });

  test("tags an archived scope as 'de baja' in the role column", async ({ page }) => {
    const org = await seedStructure("tag");
    await seedUser({
      email: "tagged@users.test",
      displayName: "Tagged",
      password: PASSWORD,
      role: "manager",
      scope: { type: "business_unit", id: org.division },
    });
    await setArchived("business_units", [org.division], true);
    await gotoUsers(page);
    await expect(roleCell(page, "tagged@users.test")).toHaveText(`${role.manager} · ${org.divisionName} ${copy.scope.archived}`);
  });
});

test.describe("create a user", () => {
  test.use({ storageState: storageStatePath("admin") });
  test.beforeEach(resetCatalogs);

  const cases = [
    { key: "admin", label: role.admin, scopeText: copy.scope.company },
    { key: "fleet_analyst", label: role.fleet_analyst, scopeText: copy.scope.company },
    { key: "viewer", label: role.viewer, scopeText: copy.scope.company },
  ] as const;

  for (const item of cases) {
    test(`creates a ${item.key} over the whole company`, async ({ page }) => {
      await gotoUsers(page);
      const dialog = await openNewUserDialog(page);
      await fillNewUserBasics(dialog, { name: "Fresh Person", email: "fresh@users.test", password: PASSWORD });
      await pickRoleAndScope(dialog, { role: item.label });
      await submit(dialog, newUser.submit);
      await expect(dialog).toBeHidden();
      const row = userRow(page, "fresh@users.test");
      await expect(row).toContainText("Fresh Person");
      await expect(roleCell(page, "fresh@users.test")).toHaveText(`${item.label} · ${item.scopeText}`);
      await expect(row.locator(".badge")).toHaveText(copy.common.active);
    });
  }

  test("creates a manager over a division", async ({ page }) => {
    const org = await seedStructure("mgr");
    await gotoUsers(page);
    const dialog = await openNewUserDialog(page);
    await fillNewUserBasics(dialog, { name: "Division Boss", email: "boss@users.test", password: PASSWORD });
    await pickRoleAndScope(dialog, { role: role.manager, kind: copy.scope.division, division: org.divisionName });
    await submit(dialog, newUser.submit);
    await expect(roleCell(page, "boss@users.test")).toHaveText(`${role.manager} · ${org.divisionName}`);
  });

  test("creates a supervisor over an operation", async ({ page }) => {
    const org = await seedStructure("sup");
    await gotoUsers(page);
    const dialog = await openNewUserDialog(page);
    await fillNewUserBasics(dialog, { name: "Line Lead", email: "lead@users.test", password: PASSWORD });
    await pickRoleAndScope(dialog, {
      role: role.supervisor,
      kind: copy.scope.operation,
      division: org.divisionName,
      operation: org.operationOption,
    });
    await submit(dialog, newUser.submit);
    await expect(roleCell(page, "lead@users.test")).toHaveText(`${role.supervisor} · ${org.operationOption}`);
  });

  test("stores the email in lowercase", async ({ page }) => {
    await gotoUsers(page);
    const dialog = await openNewUserDialog(page);
    await fillNewUserBasics(dialog, { name: "Mixed Case", email: "Mixed.Case@Users.Test", password: PASSWORD });
    await submit(dialog, newUser.submit);
    await expect(userRow(page, "mixed.case@users.test")).toBeVisible();
  });

  test("cancel closes the dialog without creating anything", async ({ page }) => {
    await gotoUsers(page);
    const dialog = await openNewUserDialog(page);
    await fillNewUserBasics(dialog, { name: "Never Saved", email: "never@users.test", password: PASSWORD });
    await dialog.getByRole("button", { name: copy.common.cancel }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText("never@users.test")).toHaveCount(0);
  });
});

test.describe("scope selectors of the new-user dialog", () => {
  test.use({ storageState: storageStatePath("admin") });
  test.beforeEach(resetCatalogs);

  test("offer only company, division and operation levels (never a site)", async ({ page }) => {
    await gotoUsers(page);
    const dialog = await openNewUserDialog(page);
    const kinds = dialog.getByLabel(copy.scope.label, { exact: true });
    expect(await optionTexts(kinds)).toEqual([copy.scope.company, copy.scope.division, copy.scope.operation]);
  });

  test("lock the scope to the whole company for an administrator", async ({ page }) => {
    await gotoUsers(page);
    const dialog = await openNewUserDialog(page);
    await pickRoleAndScope(dialog, { role: role.manager, kind: copy.scope.division });
    await pickRoleAndScope(dialog, { role: role.admin });
    const kinds = dialog.getByLabel(copy.scope.label, { exact: true });
    await expect(kinds).toBeDisabled();
    await expect(kinds).toHaveValue("tenant");
    await expect(dialog.getByText(copy.scope.adminHint)).toBeVisible();
    await expect(dialog.getByLabel(copy.scope.division, { exact: true })).toHaveCount(0);
  });

  test("offer only active divisions", async ({ page }) => {
    const kept = await seedStructure("keep");
    const dropped = await seedStructure("drop");
    await setArchived("business_units", [dropped.division], true);
    await gotoUsers(page);
    const dialog = await openNewUserDialog(page);
    await pickRoleAndScope(dialog, { role: role.manager, kind: copy.scope.division });
    const options = await optionTexts(dialog.getByLabel(copy.scope.division, { exact: true }));
    expect(options).toContain(kept.divisionName);
    expect(options).not.toContain(dropped.divisionName);
  });

  test("cascade from the division to its active operations only", async ({ page }) => {
    const first = await seedStructure("one");
    const second = await seedStructure("two");
    await gotoUsers(page);
    const dialog = await openNewUserDialog(page);
    await pickRoleAndScope(dialog, { role: role.supervisor, kind: copy.scope.operation });
    const operations = dialog.getByLabel(copy.scope.operation, { exact: true });
    expect(await optionTexts(operations)).toEqual([copy.scope.selectOperation]);
    await dialog.getByLabel(copy.scope.division, { exact: true }).selectOption({ label: first.divisionName });
    expect(await optionTexts(operations)).toEqual([copy.scope.selectOperation, first.operationOption]);
    await dialog.getByLabel(copy.scope.division, { exact: true }).selectOption({ label: second.divisionName });
    expect(await optionTexts(operations)).toEqual([copy.scope.selectOperation, second.operationOption]);
  });

  test("do not offer an archived operation and say when a division has none", async ({ page }) => {
    const org = await seedStructure("arch");
    await setArchived("operations", [org.operation], true);
    await gotoUsers(page);
    const dialog = await openNewUserDialog(page);
    await pickRoleAndScope(dialog, { role: role.supervisor, kind: copy.scope.operation, division: org.divisionName });
    await expect(dialog.getByText(copy.scope.noOperations)).toBeVisible();
    expect(await optionTexts(dialog.getByLabel(copy.scope.operation, { exact: true }))).toEqual([
      copy.scope.selectOperation,
    ]);
  });
});

test.describe("create a user: validation", () => {
  test.use({ storageState: storageStatePath("admin") });
  test.beforeEach(resetCatalogs);

  const base = { name: "Some Person", email: "some@users.test", password: PASSWORD };

  test("rejects a password shorter than 12 characters", async ({ page }) => {
    await gotoUsers(page);
    const dialog = await openNewUserDialog(page);
    await fillNewUserBasics(dialog, { ...base, password: "short-pass" });
    await submit(dialog, newUser.submit);
    await expectFormError(dialog, errors.weak_password);
    await expect(page.getByText(base.email)).toHaveCount(0);
  });

  test("accepts a password of exactly 12 characters", async ({ page }) => {
    await gotoUsers(page);
    const dialog = await openNewUserDialog(page);
    await fillNewUserBasics(dialog, { ...base, password: "twelve-chars" });
    await submit(dialog, newUser.submit);
    await expect(userRow(page, base.email)).toBeVisible();
  });

  test("rejects an email already used, ignoring case", async ({ page }) => {
    await seedUser({ email: "taken@users.test", displayName: "Taken", password: PASSWORD });
    await gotoUsers(page);
    const dialog = await openNewUserDialog(page);
    await fillNewUserBasics(dialog, { ...base, email: "TAKEN@users.test" });
    await submit(dialog, newUser.submit);
    await expectFormError(dialog, errors.email_taken);
  });

  test("rejects the email of the administrator who is creating the user", async ({ page }) => {
    await gotoUsers(page);
    const dialog = await openNewUserDialog(page);
    await fillNewUserBasics(dialog, { ...base, email: WORLD_USERS.admin.email });
    await submit(dialog, newUser.submit);
    await expectFormError(dialog, errors.email_taken);
  });

  test("the browser stops a malformed email before it reaches the server", async ({ page }) => {
    await gotoUsers(page);
    const dialog = await openNewUserDialog(page);
    await fillNewUserBasics(dialog, { ...base, email: "not-an-email" });
    await submit(dialog, newUser.submit);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    const email = dialog.getByLabel(newUser.emailLabel, { exact: true });
    expect(await email.evaluate((input: HTMLInputElement) => input.validity.typeMismatch)).toBe(true);
  });

  test("the server rejects a malformed email when the browser check is skipped", async ({ page }) => {
    await gotoUsers(page);
    const dialog = await openNewUserDialog(page);
    await skipBrowserValidation(dialog);
    await fillNewUserBasics(dialog, { ...base, email: "not-an-email" });
    await submit(dialog, newUser.submit);
    await expectFormError(dialog, copy.errors.byField.email);
  });

  test("rejects a display name made only of spaces", async ({ page }) => {
    await gotoUsers(page);
    const dialog = await openNewUserDialog(page);
    await fillNewUserBasics(dialog, { ...base, name: "   " });
    await submit(dialog, newUser.submit);
    await expectFormError(dialog, copy.errors.byField.displayName);
  });

  test("the browser requires every field before submitting", async ({ page }) => {
    await gotoUsers(page);
    const dialog = await openNewUserDialog(page);
    await submit(dialog, newUser.submit);
    await expect(dialog).toBeVisible();
    const nameInput = dialog.getByLabel(newUser.nameLabel);
    expect(await nameInput.evaluate((input: HTMLInputElement) => input.validity.valueMissing)).toBe(true);
  });

  test("rejects a division scope that was left unselected", async ({ page }) => {
    await seedStructure("blank");
    await gotoUsers(page);
    const dialog = await openNewUserDialog(page);
    await skipBrowserValidation(dialog);
    await fillNewUserBasics(dialog, base);
    await pickRoleAndScope(dialog, { role: role.manager, kind: copy.scope.division });
    await submit(dialog, newUser.submit);
    await expectFormError(dialog, errors.scope_not_found);
  });

  test("keeps what was typed after a failed attempt so it can be corrected", async ({ page }) => {
    await gotoUsers(page);
    const dialog = await openNewUserDialog(page);
    await fillNewUserBasics(dialog, { ...base, password: "short" });
    await submit(dialog, newUser.submit);
    await expectFormError(dialog, errors.weak_password);
    await expect(dialog.getByLabel(newUser.emailLabel, { exact: true })).toHaveValue(base.email);
    await dialog.getByLabel(newUser.passwordLabel).fill(PASSWORD);
    await submit(dialog, newUser.submit);
    await expect(dialog).toBeHidden();
    await expect(userRow(page, base.email)).toBeVisible();
  });
});

test.describe("change a role", () => {
  test.use({ storageState: storageStatePath("admin") });
  test.beforeEach(resetCatalogs);
  const target = { email: "target@users.test", displayName: "Target Person", password: PASSWORD, role: "viewer" } as const;
  const change = copy.dialogs.changeRole;

  test("moves a user from viewer to fleet analyst with a reason", async ({ page }) => {
    await seedUser(target);
    await gotoUsers(page);
    const dialog = await openChangeRoleDialog(page, target.email);
    await pickRoleAndScope(dialog, { role: role.fleet_analyst });
    await dialog.getByLabel(copy.common.reason).fill("Takes over the fleet catalogs");
    await submit(dialog, change.submit);
    await expect(dialog).toBeHidden();
    await expect(roleCell(page, target.email)).toHaveText(`${role.fleet_analyst} · ${copy.scope.company}`);
    await expect(roleCell(page, target.email)).not.toContainText(role.viewer);
  });

  test("narrows a user to a division and to an operation", async ({ page }) => {
    const org = await seedStructure("chg");
    await seedUser(target);
    await gotoUsers(page);
    let dialog = await openChangeRoleDialog(page, target.email);
    await pickRoleAndScope(dialog, { role: role.manager, kind: copy.scope.division, division: org.divisionName });
    await dialog.getByLabel(copy.common.reason).fill("Now runs the division");
    await submit(dialog, change.submit);
    await expect(roleCell(page, target.email)).toHaveText(`${role.manager} · ${org.divisionName}`);
    dialog = await openChangeRoleDialog(page, target.email);
    await pickRoleAndScope(dialog, { role: role.supervisor, kind: copy.scope.operation, division: org.divisionName, operation: org.operationOption });
    await dialog.getByLabel(copy.common.reason).fill("Now runs one operation");
    await submit(dialog, change.submit);
    await expect(roleCell(page, target.email)).toHaveText(`${role.supervisor} · ${org.operationOption}`);
  });

  test("preselects the current role and scope", async ({ page }) => {
    const org = await seedStructure("pre");
    await seedUser({ ...target, role: "manager", scope: { type: "business_unit", id: org.division } });
    await gotoUsers(page);
    const dialog = await openChangeRoleDialog(page, target.email);
    await expect(dialog.getByLabel(copy.common.role, { exact: true })).toHaveValue("manager");
    await expect(dialog.getByLabel(copy.scope.label, { exact: true })).toHaveValue("business_unit");
    await expect(dialog.getByLabel(copy.scope.division, { exact: true })).toHaveValue(org.division);
  });

  test("requires a reason, also when only spaces are sent", async ({ page }) => {
    await seedUser(target);
    await gotoUsers(page);
    const dialog = await openChangeRoleDialog(page, target.email);
    await pickRoleAndScope(dialog, { role: role.fleet_analyst });
    await submit(dialog, change.submit);
    await expect(dialog).toBeVisible();
    await skipBrowserValidation(dialog);
    await dialog.getByLabel(copy.common.reason).fill("   ");
    await submit(dialog, change.submit);
    await expectFormError(dialog, errors.reason_required);
    await expect(roleCell(page, target.email)).toHaveText(`${role.viewer} · ${copy.scope.company}`);
  });

  test("rejects choosing the role and scope the user already has", async ({ page }) => {
    await seedUser(target);
    await gotoUsers(page);
    const dialog = await openChangeRoleDialog(page, target.email);
    await dialog.getByLabel(copy.common.reason).fill("Nothing really changes");
    await submit(dialog, change.submit);
    await expectFormError(dialog, errors.role_unchanged);
  });

  test("rejects a scope that was archived while the dialog was open", async ({ page }) => {
    const org = await seedStructure("gone");
    await seedUser(target);
    await gotoUsers(page);
    const dialog = await openChangeRoleDialog(page, target.email);
    await pickRoleAndScope(dialog, { role: role.manager, kind: copy.scope.division, division: org.divisionName });
    await setArchived("business_units", [org.division], true);
    await dialog.getByLabel(copy.common.reason).fill("Scope vanished meanwhile");
    await submit(dialog, change.submit);
    await expectFormError(dialog, errors.scope_not_found);
  });

  test("rejects an administrator limited to a division (request tampered with)", async ({ page }) => {
    const org = await seedStructure("tamper");
    await seedUser(target);
    await gotoUsers(page);
    const dialog = await openChangeRoleDialog(page, target.email);
    await pickRoleAndScope(dialog, { role: role.admin });
    await dialog.locator("form").evaluate((form: HTMLFormElement, divisionId: string) => {
      (form.elements.namedItem("scopeType") as HTMLInputElement).value = "business_unit";
      (form.elements.namedItem("scopeId") as HTMLInputElement).value = divisionId;
    }, org.division);
    await dialog.getByLabel(copy.common.reason).fill("Trying to scope an admin");
    await submit(dialog, change.submit);
    await expectFormError(dialog, errors.scope_not_allowed_for_role);
  });

  test("protects the last active administrator from demoting themselves", async ({ page }) => {
    await gotoUsers(page);
    const dialog = await openChangeRoleDialog(page, WORLD_USERS.admin.email);
    await pickRoleAndScope(dialog, { role: role.viewer });
    await dialog.getByLabel(copy.common.reason).fill("Stepping down");
    await submit(dialog, change.submit);
    await expectFormError(dialog, errors.last_admin_protected);
    await expect(roleCell(page, WORLD_USERS.admin.email)).toHaveText(`${role.admin} · ${copy.scope.company}`);
  });

  test("lets an administrator be demoted while another one remains", async ({ page }) => {
    await seedUser({ ...target, role: "admin" });
    await gotoUsers(page);
    const dialog = await openChangeRoleDialog(page, target.email);
    await pickRoleAndScope(dialog, { role: role.viewer });
    await dialog.getByLabel(copy.common.reason).fill("No longer needs admin");
    await submit(dialog, change.submit);
    await expect(roleCell(page, target.email)).toHaveText(`${role.viewer} · ${copy.scope.company}`);
  });
});

test.describe("deactivate a user", () => {
  test.use({ storageState: storageStatePath("admin") });
  test.beforeEach(resetCatalogs);
  const target = { email: "leaving@users.test", displayName: "Leaving Person", password: PASSWORD, role: "viewer" } as const;
  const off = copy.dialogs.deactivate;

  async function deactivate(page: Page, reason: string): Promise<Locator> {
    const dialog = await openDialog(page, off.trigger, off.title(target.displayName), userRow(page, target.email));
    await dialog.getByLabel(copy.common.reason).fill(reason);
    await submit(dialog, off.submit);
    return dialog;
  }

  test("shows the user as inactive and removes the row actions", async ({ page }) => {
    await seedUser(target);
    await gotoUsers(page);
    const dialog = await deactivate(page, "Left the company");
    await expect(dialog).toBeHidden();
    const row = userRow(page, target.email);
    await expect(row.locator(".badge")).toHaveText(copy.common.inactive);
    await expect(row.getByRole("button")).toHaveCount(0);
  });

  test("requires a reason", async ({ page }) => {
    await seedUser(target);
    await gotoUsers(page);
    const dialog = await openDialog(page, off.trigger, off.title(target.displayName), userRow(page, target.email));
    await skipBrowserValidation(dialog);
    await dialog.getByLabel(copy.common.reason).fill("   ");
    await submit(dialog, off.submit);
    await expectFormError(dialog, errors.reason_required);
    await expect(userRow(page, target.email).locator(".badge")).toHaveText(copy.common.active);
  });

  test("blocks the next sign-in with the generic credentials error", async ({ browser, page }) => {
    await seedUser(target);
    await gotoUsers(page);
    await deactivate(page, "Left the company");
    await expect(userRow(page, target.email).locator(".badge")).toHaveText(copy.common.inactive);
    const visitor = await signInInNewContext(browser, target.email, PASSWORD);
    await expect(visitor.getByText(copy.errors.login)).toBeVisible();
    await expect(visitor).toHaveURL(/\/login/);
    await visitor.context().close();
  });

  test("closes the session the user already had", async ({ browser, page }) => {
    await seedUser(target);
    const visitor = await signInInNewContext(browser, target.email, PASSWORD);
    await expect(visitor.getByRole("heading", { level: 1, name: copy.home.greeting(target.displayName) })).toBeVisible();
    await gotoUsers(page);
    await deactivate(page, "Left the company");
    await expect(userRow(page, target.email).locator(".badge")).toHaveText(copy.common.inactive);
    await visitor.goto("/");
    await expect(visitor).toHaveURL(/\/login/);
    await visitor.context().close();
  });
});

test.describe("a newly created user signs in", () => {
  test.beforeEach(resetCatalogs);

  test.describe("created through the screen", () => {
    test.use({ storageState: storageStatePath("admin") });

    test("with the initial password set by the administrator", async ({ browser, page }) => {
      const org = await seedStructure("login");
      await gotoUsers(page);
      const dialog = await openNewUserDialog(page);
      await fillNewUserBasics(dialog, { name: "Fresh Manager", email: "fresh.mgr@users.test", password: PASSWORD });
      await pickRoleAndScope(dialog, { role: role.manager, kind: copy.scope.division, division: org.divisionName });
      await submit(dialog, newUser.submit);
      await expect(dialog).toBeHidden();
      const visitor = await signInInNewContext(browser, "fresh.mgr@users.test", PASSWORD);
      await expect(visitor.getByRole("heading", { level: 1, name: copy.home.greeting("Fresh Manager") })).toBeVisible();
      await visitor.context().close();
    });
  });

  const entries = { home: copy.nav.home, fleet: copy.nav.fleet, users: copy.nav.users, organization: copy.nav.organization };
  const sidebarByRole: Record<string, readonly string[]> = {
    admin: [entries.home, entries.fleet, entries.users, entries.organization],
    fleet_analyst: [entries.home, entries.fleet, entries.organization],
    viewer: [entries.home, entries.fleet, entries.organization],
    manager: [entries.home, entries.organization],
    supervisor: [entries.home, entries.organization],
  };

  for (const [key, visible] of Object.entries(sidebarByRole)) {
    test(`sees the sidebar that matches the ${key} role`, async ({ browser }) => {
      const org = await seedStructure(`nav-${key}`);
      const scope =
        key === "manager" ? { type: "business_unit", id: org.division } as const
        : key === "supervisor" ? { type: "operation", id: org.operation } as const
        : undefined;
      const email = `${key}.nav@users.test`;
      await seedUser({ email, displayName: `Nav ${key}`, password: PASSWORD, role: key as RoleKey, ...(scope ? { scope } : {}) });
      const visitor = await signInInNewContext(browser, email, PASSWORD);
      const sidebar = visitor.getByRole("complementary");
      await expect(sidebar.getByRole("link", { name: copy.nav.home })).toBeVisible();
      for (const label of Object.values(entries)) {
        const link = sidebar.getByRole("link", { name: label, exact: true });
        await expect(link).toHaveCount(visible.includes(label) ? 1 : 0);
      }
      await expect(sidebar.locator(".account-role")).toHaveText(copy.roles[key as RoleKey]);
      await visitor.context().close();
    });
  }
});

test.describe("who can open the users screen", () => {
  test.beforeEach(resetCatalogs);

  test("an anonymous visitor is sent to the login page", async ({ page }) => {
    await page.goto("/users");
    await expect(page).toHaveURL(/\/login/);
  });

  for (const key of ["fleet_analyst", "viewer", "manager", "supervisor"] as const) {
    test.describe(`as ${key}`, () => {
      test.use({ storageState: storageStatePath(key) });

      test("sees the restricted notice, no table and no create button", async ({ page }) => {
        await page.goto("/users");
        await expect(page.getByRole("heading", { level: 1, name: copy.users.restrictedTitle })).toBeVisible();
        await expect(page.getByText(copy.users.restrictedText)).toBeVisible();
        await expect(page.getByRole("table")).toHaveCount(0);
        await expect(page.getByRole("button", { name: newUser.trigger })).toHaveCount(0);
      });

      test("has no Usuarios entry in the sidebar", async ({ page }) => {
        await page.goto("/");
        await expect(page.getByRole("complementary").getByRole("link", { name: copy.nav.users })).toHaveCount(0);
      });
    });
  }

  test.describe("as admin", () => {
    test.use({ storageState: storageStatePath("admin") });

    test("sees the table, the create button and the sidebar entry", async ({ page }) => {
      await gotoUsers(page);
      await expect(page.getByRole("button", { name: newUser.trigger })).toBeVisible();
      await expect(page.getByRole("complementary").getByRole("link", { name: copy.nav.users })).toBeVisible();
      await expect(page.getByRole("table", { name: copy.users.tableCaption })).toBeVisible();
    });
  });
});
