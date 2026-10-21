import { describe, expect, it } from "vitest";
import {
  databaseUrl,
  e2eDatabaseName,
  e2eLoginName,
  isStaleDatabase,
  isStaleLogin,
  pickAdminUrl,
  pickPort,
  pickStateDir,
  loginUrl,
} from "../names";

const NOW = Date.UTC(2026, 9, 21, 12, 0, 0);
const MINUTE = 60_000;

describe("e2e resource names", () => {
  it("names a database and a login with the creation time and a random suffix", () => {
    expect(e2eDatabaseName(NOW, "abc123")).toBe(`parkline_e2e_${String(NOW)}_abc123`);
    expect(e2eLoginName(NOW, "abc123")).toBe(`e2e_login_${String(NOW)}_abc123`);
  });

  it("marks a database stale only when it is older than the allowed age", () => {
    const old = e2eDatabaseName(NOW - 10 * MINUTE, "aaaa");
    const fresh = e2eDatabaseName(NOW - 1 * MINUTE, "bbbb");
    expect(isStaleDatabase(old, NOW, 5 * MINUTE)).toBe(true);
    expect(isStaleDatabase(fresh, NOW, 5 * MINUTE)).toBe(false);
  });

  it("never marks a database or a login that is not an e2e resource as stale", () => {
    expect(isStaleDatabase("parkline", NOW, 0)).toBe(false);
    expect(isStaleDatabase("parkline_test_abc", NOW, 0)).toBe(false);
    expect(isStaleDatabase("parkline_e2e_notanumber_x", NOW, 0)).toBe(false);
    expect(isStaleLogin("parkline_login", NOW, 0)).toBe(false);
    expect(isStaleLogin(e2eLoginName(NOW - 10 * MINUTE, "zz"), NOW, 5 * MINUTE)).toBe(true);
  });

  it("builds connection urls without changing the original", () => {
    const base = "postgres://parkline:secret@localhost:54329/postgres";
    expect(databaseUrl(base, "db_one")).toBe("postgres://parkline:secret@localhost:54329/db_one");
    expect(loginUrl(base, "db_one", "app_user", "p@ss/word")).toBe(
      "postgres://app_user:p%40ss%2Fword@localhost:54329/db_one",
    );
    expect(base).toContain("/postgres");
  });
});

describe("pickAdminUrl", () => {
  const fallback = "postgres://parkline:parkline_dev@localhost:54329/postgres";

  it("prefers the explicit e2e variable, then a local DATABASE_URL, then the default", () => {
    const explicit = "postgres://admin:x@db.internal:5432/postgres";
    expect(pickAdminUrl({ E2E_ADMIN_DATABASE_URL: explicit, DATABASE_URL: "postgres://u:p@localhost/d" }, fallback)).toBe(explicit);
    expect(pickAdminUrl({ DATABASE_URL: "postgres://u:p@127.0.0.1:5432/d" }, fallback)).toBe("postgres://u:p@127.0.0.1:5432/d");
    expect(pickAdminUrl({}, fallback)).toBe(fallback);
  });

  it("ignores a DATABASE_URL that points to a remote host so a hosted database is never touched", () => {
    expect(pickAdminUrl({ DATABASE_URL: "postgres://u:p@ep-example.neon.tech/d" }, fallback)).toBe(fallback);
    expect(pickAdminUrl({ DATABASE_URL: "not a url" }, fallback)).toBe(fallback);
  });
});

describe("parallel runs", () => {
  it("uses port 3100 unless E2E_PORT overrides it", () => {
    expect(pickPort({})).toBe(3100);
    expect(pickPort({ E2E_PORT: "3201" })).toBe(3201);
    expect(pickPort({ E2E_PORT: " 3202 " })).toBe(3202);
  });

  it("rejects a port that is not a valid unprivileged number", () => {
    expect(() => pickPort({ E2E_PORT: "abc" })).toThrow(/E2E_PORT/);
    expect(() => pickPort({ E2E_PORT: "80" })).toThrow(/E2E_PORT/);
    expect(() => pickPort({ E2E_PORT: "70000" })).toThrow(/E2E_PORT/);
  });

  it("keeps the run state next to the specs unless E2E_STATE_DIR points elsewhere", () => {
    expect(pickStateDir({}, "/repo/e2e")).toBe("/repo/e2e");
    expect(pickStateDir({ E2E_STATE_DIR: "/tmp/run-a" }, "/repo/e2e")).toBe("/tmp/run-a");
    expect(pickStateDir({ E2E_STATE_DIR: "  " }, "/repo/e2e")).toBe("/repo/e2e");
  });
});
