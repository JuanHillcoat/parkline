/**
 * Helpers for the sign-in and navigation suites: filling the real login form with any
 * credentials, and creating (then deactivating) a throwaway user through the use cases.
 */
import { expect, type Page } from "@playwright/test";
import postgres, { type Sql } from "postgres";
import { copy } from "../../app/_lib/copy";
import { createContainer, type Container } from "../../src/shared/infrastructure/container";
import { WORLD_USERS, passwordOf, readWorld } from "./world";

/** Fills the login form and presses the submit button; it does not wait for any outcome. */
export async function submitCredentials(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel(copy.login.emailLabel).fill(email);
  await page.getByLabel(copy.login.passwordLabel).fill(password);
  await page.getByRole("button", { name: copy.login.submit }).click();
}

/** The form's own error line (Next.js adds an empty route announcer that is also an alert). */
export const formError = (page: Page) => page.locator("p.form-error[role=alert]");

/** The generic sign-in failure message, visible on the login page. */
export async function expectLoginError(page: Page): Promise<void> {
  await expect(formError(page)).toHaveText(copy.errors.login);
  await expect(page).toHaveURL(/\/login$/);
}

export type Throwaway = { readonly email: string; readonly password: string };

type Opened = { readonly sql: Sql; readonly container: Container };

function openOwner(): Opened {
  const sql = postgres(readWorld().ownerUrl, { max: 2, connect_timeout: 10, onnotice: () => undefined });
  return { sql, container: createContainer(sql) };
}

async function adminContext(container: Container) {
  const email = WORLD_USERS.admin.email;
  const session = await container.identity.signIn.execute({ email, password: passwordOf("admin") });
  if (!session.ok) throw new Error("Admin sign-in failed while seeding");
  const actor = await container.identity.authenticate.execute({ token: session.value.token });
  if (!actor.ok) throw new Error("Admin authentication failed while seeding");
  return actor.value;
}

async function deactivate(container: Container, userId: string): Promise<void> {
  const actor = await adminContext(container);
  const done = await container.identity.deactivateUser.execute({
    actor,
    userId,
    reason: "End-to-end test: deactivated account",
  });
  if (!done.ok) throw new Error(`Deactivating failed: ${done.error.code}`);
}

/** Creates an active viewer with a known password; `deactivated` also turns the account off. */
export async function createThrowawayUser(name: string, deactivated = false): Promise<Throwaway> {
  const { sql, container } = openOwner();
  try {
    const actor = await adminContext(container);
    const credentials = { email: `${name}@e2e.test`, password: "throwaway-password-123" };
    const created = await container.identity.createUser.execute({
      actor,
      email: credentials.email,
      displayName: name,
      password: credentials.password,
      role: "viewer",
    });
    if (!created.ok) throw new Error(`Creating the user failed: ${created.error.code}`);
    if (deactivated) await deactivate(container, created.value.id);
    return credentials;
  } finally {
    await sql.end();
  }
}
