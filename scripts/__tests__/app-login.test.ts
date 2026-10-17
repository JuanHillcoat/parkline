import type { Sql } from "postgres";
import { describe, expect, it } from "vitest";
import { createAppLogin, readAppLoginConfig } from "../app-login";

const PASSWORD = "synthetic-pass-123";

describe("readAppLoginConfig", () => {
  it("defaults the user to parkline_login", () => {
    expect(readAppLoginConfig({ APP_DB_PASSWORD: PASSWORD })).toEqual({
      ok: true,
      value: { user: "parkline_login", password: PASSWORD },
    });
  });

  it("accepts a valid custom user", () => {
    const result = readAppLoginConfig({ APP_DB_USER: "app_web_1", APP_DB_PASSWORD: PASSWORD });
    expect(result).toEqual({ ok: true, value: { user: "app_web_1", password: PASSWORD } });
  });

  it("requires a password and names the variable", () => {
    const result = readAppLoginConfig({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("APP_DB_PASSWORD");
  });

  it("rejects a password shorter than 12 characters without echoing it", () => {
    const result = readAppLoginConfig({ APP_DB_PASSWORD: "short-pw-11" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("12");
      expect(result.message).not.toContain("short-pw-11");
    }
  });

  it.each(["Parkline", "1login", "with-dash", 'quo"te', "a b", "x".repeat(64), "parkline_app", "pg_monitor"])(
    "rejects the role name %s",
    (user) => {
      expect(readAppLoginConfig({ APP_DB_USER: user, APP_DB_PASSWORD: PASSWORD }).ok).toBe(false);
    },
  );
});

describe("createAppLogin", () => {
  it("refuses to run before the group role exists and points to db:migrate", async () => {
    const tx = () => Promise.resolve([]);
    const sql = { begin: (fn: (t: unknown) => Promise<unknown>) => fn(tx) } as unknown as Sql;
    await expect(createAppLogin(sql, { user: "parkline_login", password: PASSWORD })).rejects.toThrow(/db:migrate/);
  });
});
