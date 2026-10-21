/**
 * Plain SQL migration runner.
 *
 * Applies `db/migrations/*.sql` in filename order. Each migration runs in its
 * own transaction together with its `schema_migrations` bookkeeping row, so a
 * failure leaves no partial state. Re-running applies only what is pending.
 * Runs as the database owner: MIGRATE_DATABASE_URL, falling back to DATABASE_URL.
 * Lives outside `src/` on purpose: it must not import application code.
 */
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres, { type Sql } from "postgres";
import { migrationUrl } from "./migrate-url";
import { assertOwnerConnection, exitWithFailure } from "./privilege-hint";

const MIGRATION_FILE = /^\d{4}_[a-z0-9_]+\.sql$/;

export async function migrate(sql: Sql, dir: string): Promise<string[]> {
  await sql`
    create table if not exists schema_migrations (
      name       text primary key,
      applied_at timestamptz not null default now()
    )
  `;

  const files = (await readdir(dir)).filter((f) => MIGRATION_FILE.test(f)).sort();
  const done = await sql<{ name: string }[]>`select name from schema_migrations`;
  const applied = new Set(done.map((r) => r.name));
  const newlyApplied: string[] = [];

  for (const file of files) {
    if (applied.has(file)) continue;
    const text = await readFile(resolve(dir, file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(text);
      await tx`insert into schema_migrations (name) values (${file})`;
    });
    newlyApplied.push(file);
  }
  return newlyApplied;
}

async function main(): Promise<void> {
  const url = migrationUrl(process.env);
  if (!url) {
    throw new Error("MIGRATE_DATABASE_URL or DATABASE_URL must be set (see .env.example)");
  }
  const sql = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    await assertOwnerConnection(sql);
    const dir = resolve(import.meta.dirname, "../db/migrations");
    const applied = await migrate(sql, dir);
    console.log(applied.length === 0 ? "No pending migrations." : `Applied: ${applied.join(", ")}`);
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    exitWithFailure(error, process.env);
  });
}
