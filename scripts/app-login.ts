/**
 * `pnpm db:create-app-login`: creates (or updates) the login role the application connects
 * with and makes it a member of the restricted group role `parkline_app` (migration 0004).
 *
 * Runs as the database owner (MIGRATE_DATABASE_URL, falling back to DATABASE_URL). The
 * password comes from APP_DB_PASSWORD only: never a flag, never printed, never logged. It is
 * embedded server-side with format(%L), so no JavaScript string ever concatenates it into SQL.
 * Lives outside `src/` on purpose: it must not import application code.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres, { type Sql } from "postgres";
import { migrationUrl } from "./migrate-url";

export const APP_GROUP_ROLE = "parkline_app";
export const DEFAULT_APP_LOGIN = "parkline_login";
export const MIN_PASSWORD_LENGTH = 12;
const ROLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

export type AppLoginConfig = { user: string; password: string };
export type ConfigResult = { ok: true; value: AppLoginConfig } | { ok: false; message: string };

export function isValidRoleName(name: string): boolean {
  return ROLE_NAME.test(name) && name !== APP_GROUP_ROLE && !name.startsWith("pg_");
}

export function readAppLoginConfig(env: Record<string, string | undefined>): ConfigResult {
  const user = env.APP_DB_USER?.trim() || DEFAULT_APP_LOGIN;
  if (!isValidRoleName(user)) {
    return { ok: false, message: `APP_DB_USER must match ${ROLE_NAME.source}, must not start with pg_ and must not be ${APP_GROUP_ROLE}.` };
  }
  const password = env.APP_DB_PASSWORD ?? "";
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, message: `APP_DB_PASSWORD is required and must have at least ${String(MIN_PASSWORD_LENGTH)} characters (set it in the environment, never as a flag).` };
  }
  return { ok: true, value: { user, password } };
}

type RoleState = { groupExists: boolean; present: boolean; superuser: boolean };

async function readRoleState(tx: Sql, user: string): Promise<RoleState | undefined> {
  const [row] = await tx<RoleState[]>`
    select
      exists (select 1 from pg_roles where rolname = ${APP_GROUP_ROLE}::text) as "groupExists",
      exists (select 1 from pg_roles where rolname = ${user}::text) as "present",
      coalesce((select rolsuper from pg_roles where rolname = ${user}::text), false) as "superuser"`;
  return row;
}

/** Builds the role statements server-side: identifiers with %I, the password with %L. */
async function roleStatements(tx: Sql, verb: string, config: AppLoginConfig): Promise<string[]> {
  const rows = await tx<{ statement: string }[]>`
    select 1 as step, format('%s role %I login nosuperuser nocreatedb nocreaterole noreplication password %L',
      ${verb}::text, ${config.user}::text, ${config.password}::text) as statement
    union all
    select 2, format('grant %I to %I', ${APP_GROUP_ROLE}::text, ${config.user}::text)
    order by step`;
  return rows.map((row) => row.statement);
}

/** Creates or updates the login and grants the group role. Returns what it did. */
export async function createAppLogin(sql: Sql, config: AppLoginConfig): Promise<"created" | "updated"> {
  return sql.begin(async (transaction) => {
    const tx = transaction as unknown as Sql;
    const state = await readRoleState(tx, config.user);
    if (!state?.groupExists) {
      throw new Error(`The group role ${APP_GROUP_ROLE} does not exist yet. Run "pnpm db:migrate" first.`);
    }
    if (state.superuser) {
      throw new Error(`Refusing to change ${config.user}: it is a superuser, not an application login.`);
    }
    // Ordered by step: the create/alter statement first, then the grant.
    for (const statement of await roleStatements(tx, state.present ? "alter" : "create", config)) {
      await tx.unsafe(statement);
    }
    return state.present ? "updated" : "created";
  });
}

async function main(): Promise<void> {
  const url = migrationUrl(process.env);
  if (!url) throw new Error("MIGRATE_DATABASE_URL or DATABASE_URL must be set (see .env.example)");
  const config = readAppLoginConfig(process.env);
  if (!config.ok) throw new Error(config.message);
  const sql = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    const outcome = await createAppLogin(sql, config.value);
    console.log(`Login role ${config.value.user} ${outcome}; member of ${APP_GROUP_ROLE}.`);
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Creating the application login failed");
    process.exit(1);
  });
}
