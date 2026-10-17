/**
 * Which connection string migrations use. Migrations and the app-login command run as the
 * database owner (`MIGRATE_DATABASE_URL`); the application itself uses `DATABASE_URL`, which
 * should point at a member of the restricted `parkline_app` role. When the owner URL is unset
 * (a single-login setup, or the ephemeral test harness) `DATABASE_URL` is used.
 */
export function migrationUrl(env: Record<string, string | undefined>): string | undefined {
  const owner = env.MIGRATE_DATABASE_URL?.trim();
  if (owner) return owner;
  return env.DATABASE_URL?.trim() || undefined;
}
