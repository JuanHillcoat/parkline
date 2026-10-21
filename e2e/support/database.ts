/**
 * Lifecycle of the ephemeral database and of the restricted application login of one run.
 * Everything here runs as the cluster administrator and only touches resources whose names carry
 * the e2e prefixes (see `names.ts`); the `parkline` development database is never opened.
 */
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import postgres, { type Sql } from "postgres";
import { createAppLogin } from "../../scripts/app-login";
import { migrate } from "../../scripts/migrate";
import { databaseUrl, e2eDatabaseName, e2eLoginName, isStaleDatabase, isStaleLogin, loginUrl, pickAdminUrl } from "./names";

const MIGRATIONS_DIR = resolve(import.meta.dirname, "../../db/migrations");
const DEFAULT_ADMIN_URL = "postgres://parkline:parkline_dev@localhost:54329/postgres";
const STALE_AFTER_MS = 10 * 60_000;

export type Ephemeral = {
  readonly database: string;
  readonly login: string;
  readonly ownerUrl: string;
  readonly appUrl: string;
  readonly admin: Sql;
  readonly owner: Sql;
};

export const adminUrl = (): string => databaseUrl(pickAdminUrl(process.env, DEFAULT_ADMIN_URL), "postgres");

const open = (url: string, max: number): Sql => postgres(url, { max, onnotice: () => undefined });

/** Drops databases and logins that a crashed earlier run left behind (older than ten minutes). */
export async function sweepLeftovers(admin: Sql, now = Date.now()): Promise<void> {
  const databases = await admin<{ datname: string }[]>`select datname from pg_database where datname like 'parkline\_e2e\_%'`;
  for (const { datname } of databases) {
    if (isStaleDatabase(datname, now, STALE_AFTER_MS)) await admin.unsafe(`drop database if exists "${datname}" with (force)`);
  }
  const roles = await admin<{ rolname: string }[]>`select rolname from pg_roles where rolname like 'e2e\_login\_%'`;
  for (const { rolname } of roles) {
    if (isStaleLogin(rolname, now, STALE_AFTER_MS)) await admin.unsafe(`drop role if exists "${rolname}"`);
  }
}

/** Creates the database, migrates it and creates the restricted login with a random password. */
export async function createEphemeral(): Promise<Ephemeral> {
  const base = adminUrl();
  const admin = open(base, 1);
  await sweepLeftovers(admin);
  const now = Date.now();
  const database = e2eDatabaseName(now, randomBytes(4).toString("hex"));
  const login = e2eLoginName(now, randomBytes(4).toString("hex"));
  await admin.unsafe(`create database "${database}"`);
  const ownerUrl = databaseUrl(base, database);
  const owner = open(ownerUrl, 2);
  try {
    const password = await prepare(owner, login);
    return { database, login, ownerUrl, appUrl: loginUrl(base, database, login, password), admin, owner };
  } catch (error) {
    // The database already exists: drop it and the login before reporting, so a failed
    // migration never leaves resources behind for the next run to sweep.
    await dropEphemeral({ database, login, ownerUrl, appUrl: "", admin, owner });
    throw error;
  }
}

/** Migrates the new database and creates the restricted login; returns the login's random password. */
async function prepare(owner: Sql, login: string): Promise<string> {
  await migrate(owner, MIGRATIONS_DIR);
  const password = randomBytes(24).toString("base64url");
  await createAppLogin(owner, { user: login, password });
  return password;
}

/** Drops the database first, then the cluster-level login. Safe to call twice. */
export async function dropResources(admin: Sql, database: string, login: string): Promise<void> {
  await admin.unsafe(`drop database if exists "${database}" with (force)`);
  await admin.unsafe(`drop role if exists "${login}"`);
}

export async function dropEphemeral(resources: Ephemeral): Promise<void> {
  await resources.owner.end({ timeout: 2 }).catch(() => undefined);
  await dropResources(resources.admin, resources.database, resources.login);
  await resources.admin.end({ timeout: 2 });
}

/** Opens an administrator connection for the teardown, which runs in another process. */
export const openAdmin = (): Sql => open(adminUrl(), 1);
