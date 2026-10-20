import type { Options } from "postgres";

/**
 * Driver options that depend on where the database is reached from.
 *
 * Behind a transaction pooler (for example the pooled endpoint of a serverless Postgres host)
 * a session is not kept between statements, so prepared statements cannot be reused, and every
 * serverless instance should hold a single connection so that many instances do not exhaust the
 * pooler. A direct connection keeps the driver defaults.
 */
export const connectionOptions = (env: Readonly<Record<string, string | undefined>>): Options<Record<string, never>> =>
  env.DATABASE_POOLER?.trim().toLowerCase() === "transaction" ? { max: 1, prepare: false } : {};
