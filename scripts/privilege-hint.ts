/**
 * Turns "this command ran with the wrong login" into advice instead of a bare Postgres error.
 *
 * Migrations and `db:create-app-login` need the database owner. With the two-login setup
 * `DATABASE_URL` is the restricted application login (a member of `parkline_app`), so when
 * `MIGRATE_DATABASE_URL` is forgotten both commands would run DDL as that login and fail with a
 * generic permission error (SQLSTATE 42501). Lives outside `src/` like the other commands.
 */
import type { Sql } from "postgres";

const PERMISSION_DENIED = "42501";
const NO_OWNER_URL =
  "This command must run as the database owner, but it is connected as the restricted application login. " +
  "Set MIGRATE_DATABASE_URL to the owner connection and run it again (DATABASE_URL is the application login).";
const OWNER_LACKS_RIGHTS =
  "The database refused the operation: the login in MIGRATE_DATABASE_URL does not have the privileges this command needs. " +
  "Use the database owner (or a role that can create tables and roles).";

/** Raised before any change when the connection is a member of the restricted application role. */
export class RestrictedLoginError extends Error {
  constructor() {
    super(NO_OWNER_URL);
    this.name = "RestrictedLoginError";
  }
}

/**
 * True when the current login inherits the privileges of `parkline_app` (false while that role does not
 * exist yet). It checks `usage`, not `member`: a superuser is a member of every role, and a hosted owner
 * that created `parkline_app` is a member with admin option only, neither of which is the restricted login.
 */
export async function isRestrictedLogin(sql: Sql, groupRole = "parkline_app"): Promise<boolean> {
  // The role is matched by name inside the subquery and checked by oid: a role that does not exist
  // yet (the very first run on a new database) yields no row, never a "role does not exist" error,
  // whatever order the planner evaluates the conditions in.
  const rows = await sql<{ restricted: boolean }[]>`
    select exists (
             select 1 from pg_roles r
             where r.rolname = ${groupRole}::text and pg_has_role(current_user, r.oid, 'usage')
           )
       and not (select rolsuper from pg_roles where rolname = current_user) as restricted`;
  return rows[0]?.restricted === true;
}

export async function assertOwnerConnection(sql: Sql): Promise<void> {
  if (await isRestrictedLogin(sql)) throw new RestrictedLoginError();
}

/** The advice for a failure the user can fix by changing the connection, or undefined for anything else. */
export function describeFailure(error: unknown, env: Record<string, string | undefined>): string | undefined {
  if (error instanceof RestrictedLoginError) return error.message;
  if ((error as { code?: unknown } | null)?.code !== PERMISSION_DENIED) return undefined;
  return env.MIGRATE_DATABASE_URL?.trim() ? OWNER_LACKS_RIGHTS : NO_OWNER_URL;
}

/** Prints the advice (or the raw error when there is none) and exits with a failure status. */
export function exitWithFailure(error: unknown, env: Record<string, string | undefined>): never {
  console.error(describeFailure(error, env) ?? error);
  process.exit(1);
}
