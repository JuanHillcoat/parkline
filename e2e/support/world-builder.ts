/**
 * Builds the synthetic world through the application use cases, connected as the owner of
 * the ephemeral database (so audit entries and normalization are the real ones). Run by the
 * launcher only; the specs never import this file.
 */
import { randomBytes } from "node:crypto";
import type { Sql } from "postgres";
import { toActor } from "../../src/identity/application/actor-mapper";
import type { DomainError } from "../../src/shared/domain/domain-error";
import type { Result } from "../../src/shared/domain/result";
import { createContainer, type Container } from "../../src/shared/infrastructure/container";
import { ROLE_KEYS, WORLD_ORG, WORLD_USERS, type RoleKey, type WorldFile } from "./world";

const must = <T>(result: Result<T, DomainError>): T => {
  if (!result.ok) throw new Error(`World setup failed: ${result.error.code}`);
  return result.value;
};

const randomPassword = (): string => randomBytes(18).toString("base64url");

function generatePasswords(): Record<RoleKey, string> {
  return Object.fromEntries(ROLE_KEYS.map((role) => [role, randomPassword()])) as Record<RoleKey, string>;
}

async function adminContext(c: Container, password: string) {
  const session = must(await c.identity.signIn.execute({ email: WORLD_USERS.admin.email, password }));
  return must(await c.identity.authenticate.execute({ token: session.token }));
}

type Org = WorldFile["ids"];

async function buildOrganization(c: Container, password: string, tenant: string): Promise<Org> {
  const actor = toActor(await adminContext(c, password));
  const division = must(await c.organization.createBusinessUnit.execute({ actor, name: WORLD_ORG.division }));
  const site = must(await c.organization.createSite.execute({ actor, name: WORLD_ORG.site }));
  const operation = must(
    await c.organization.createOperation.execute({
      actor,
      businessUnitId: division.id,
      siteId: site.id,
      name: WORLD_ORG.operation,
      costCenter: WORLD_ORG.costCenter,
    }),
  );
  return { tenant, division: division.id, site: site.id, operation: operation.id };
}

function scopeOf(role: RoleKey, ids: Org): { type: string; id: string } | undefined {
  if (role === "manager") return { type: "business_unit", id: ids.division };
  if (role === "supervisor") return { type: "operation", id: ids.operation };
  return undefined;
}

async function createUsers(c: Container, passwords: Record<RoleKey, string>, ids: Org): Promise<void> {
  // The identity use cases take the authenticated context as it is; the organization ones take it through toActor.
  const adminAuthentication = await adminContext(c, passwords.admin);
  for (const role of ROLE_KEYS.filter((key) => key !== "admin")) {
    const { email, displayName } = WORLD_USERS[role];
    const scope = scopeOf(role, ids);
    must(
      await c.identity.createUser.execute({
        actor: adminAuthentication,
        email,
        displayName,
        password: passwords[role],
        role,
        ...(scope ? { scope } : {}),
      }),
    );
  }
}

/** Creates the tenant, the administrator, one division/site/operation and the other four users. */
export async function buildWorld(owner: Sql, ownerUrl: string, resources: WorldFile["resources"]): Promise<WorldFile> {
  const c = createContainer(owner);
  const passwords = generatePasswords();
  const installed = must(
    await c.identity.install.execute({
      tenantName: WORLD_ORG.tenantName,
      displayName: WORLD_USERS.admin.displayName,
      email: WORLD_USERS.admin.email,
      password: passwords.admin,
    }),
  );
  const ids = await buildOrganization(c, passwords.admin, installed.tenant.id);
  await createUsers(c, passwords, ids);
  return { resources, ownerUrl, passwords, ids };
}
