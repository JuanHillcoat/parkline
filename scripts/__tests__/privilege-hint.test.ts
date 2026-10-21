import { describe, expect, it } from "vitest";
import type { Sql } from "postgres";
import { RestrictedLoginError, assertOwnerConnection, describeFailure, isRestrictedLogin } from "../privilege-hint";

const pgError = (code: string): Error => Object.assign(new Error("permission denied for schema public"), { code });

/** A stand-in for the tagged-template client: it answers the one role query with a canned row. */
const fakeSql = (restricted: boolean): Sql => (() => Promise.resolve([{ restricted }])) as unknown as Sql;

describe("describeFailure", () => {
  it("turns a permission error into advice to use the owner connection when MIGRATE_DATABASE_URL is unset", () => {
    const message = describeFailure(pgError("42501"), {});
    expect(message).toContain("MIGRATE_DATABASE_URL");
    expect(message).toMatch(/owner/i);
  });

  it("tells the user to check the owner URL when MIGRATE_DATABASE_URL is already set", () => {
    const message = describeFailure(pgError("42501"), { MIGRATE_DATABASE_URL: "postgres://owner:secret@h/db" });
    expect(message).toMatch(/MIGRATE_DATABASE_URL/);
    expect(message).toMatch(/does not have|lacks|cannot/i);
    expect(message).not.toContain("secret");
  });

  it("leaves every other error alone", () => {
    expect(describeFailure(pgError("28P01"), {})).toBeUndefined();
    expect(describeFailure(new Error("boom"), {})).toBeUndefined();
    expect(describeFailure("not an error", {})).toBeUndefined();
  });

  it("explains a restricted-login refusal with the same advice", () => {
    expect(describeFailure(new RestrictedLoginError(), {})).toContain("MIGRATE_DATABASE_URL");
  });
});

describe("assertOwnerConnection", () => {
  it("rejects a connection that is a member of the restricted application role", async () => {
    await expect(assertOwnerConnection(fakeSql(true))).rejects.toBeInstanceOf(RestrictedLoginError);
  });

  it("lets an owner connection through", async () => {
    await expect(assertOwnerConnection(fakeSql(false))).resolves.toBeUndefined();
  });

  it("reports the answer of the role query", async () => {
    expect(await isRestrictedLogin(fakeSql(true))).toBe(true);
    expect(await isRestrictedLogin(fakeSql(false))).toBe(false);
  });
});
