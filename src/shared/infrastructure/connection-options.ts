import postgres, { type Options, type Sql } from "postgres";

type Env = Readonly<Record<string, string | undefined>>;

const DIRECT = new Set(["", "false"]);

/**
 * Driver options that depend on where the database is reached from.
 *
 * Behind a transaction pooler (for example the pooled endpoint of a serverless Postgres host)
 * a session is not kept between statements, so prepared statements cannot be reused, and every
 * serverless instance should hold a single connection so that many instances do not exhaust the
 * pooler. A direct connection keeps the driver defaults.
 *
 * Any other value is a configuration mistake and fails at startup: silently falling back to a
 * direct connection would only show up later as failing queries against the pooler.
 */
export const connectionOptions = (env: Env): Options<Record<string, never>> => {
  const mode = (env.DATABASE_POOLER ?? "").trim().toLowerCase();
  if (mode === "transaction") return { max: 1, prepare: false };
  if (DIRECT.has(mode)) return {};
  throw new Error('DATABASE_POOLER must be unset, "false" or "transaction"');
};

/** Opens the application's database client from the environment; it connects on the first query. */
export const openDatabase = (env: Env): Sql => {
  const url = env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");
  return postgres(url, connectionOptions(env));
};
