/**
 * Names and URLs of the resources one end-to-end run creates in the Postgres cluster.
 * Pure on purpose: the launcher uses them to create and to sweep leftovers, and the unit
 * tests pin the format. The creation time is part of every name so a later run can tell a
 * crashed run's leftovers from a run that is still alive.
 */
const DATABASE_PREFIX = "parkline_e2e_";
const LOGIN_PREFIX = "e2e_login_";

export const e2eDatabaseName = (now: number, suffix: string): string => `${DATABASE_PREFIX}${String(now)}_${suffix}`;
export const e2eLoginName = (now: number, suffix: string): string => `${LOGIN_PREFIX}${String(now)}_${suffix}`;

function createdAt(name: string, prefix: string): number | null {
  if (!name.startsWith(prefix)) return null;
  const stamp = Number(name.slice(prefix.length).split("_")[0]);
  return Number.isFinite(stamp) ? stamp : null;
}

const isStale = (name: string, prefix: string, now: number, maxAgeMs: number): boolean => {
  const created = createdAt(name, prefix);
  return created !== null && now - created > maxAgeMs;
};

export const isStaleDatabase = (name: string, now: number, maxAgeMs: number): boolean =>
  isStale(name, DATABASE_PREFIX, now, maxAgeMs);

export const isStaleLogin = (name: string, now: number, maxAgeMs: number): boolean =>
  isStale(name, LOGIN_PREFIX, now, maxAgeMs);

/** The same server and credentials, another database. */
export function databaseUrl(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

/** The same server, another database and another login. */
export function loginUrl(base: string, database: string, user: string, password: string): string {
  const url = new URL(databaseUrl(base, database));
  url.username = user;
  url.password = password;
  return url.toString();
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isLocalUrl(value: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(value).hostname);
  } catch {
    return false;
  }
}

/**
 * The administrator connection used to create the ephemeral database. `E2E_ADMIN_DATABASE_URL`
 * wins; `DATABASE_URL` is honored only when it points to this machine, so a shell that happens to
 * export a hosted database URL can never make the run create anything there.
 */
export function pickAdminUrl(env: Record<string, string | undefined>, fallback: string): string {
  const explicit = env.E2E_ADMIN_DATABASE_URL?.trim();
  if (explicit) return explicit;
  const shared = env.DATABASE_URL?.trim();
  return shared && isLocalUrl(shared) ? shared : fallback;
}

type Env = Readonly<Record<string, string | undefined>>;

/** Port of the compiled app: 3100 by default, `E2E_PORT` when several runs share a machine. */
export function pickPort(env: Env): number {
  const raw = env.E2E_PORT?.trim();
  if (!raw) return 3100;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("E2E_PORT must be an integer between 1024 and 65535");
  }
  return port;
}

/** Folder for the per-run files (world, sessions, reports); `E2E_STATE_DIR` isolates parallel runs. */
export function pickStateDir(env: Env, fallback: string): string {
  return env.E2E_STATE_DIR?.trim() || fallback;
}
