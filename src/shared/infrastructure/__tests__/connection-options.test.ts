import { describe, expect, it } from "vitest";
import { connectionOptions, openDatabase } from "../connection-options";

describe("connectionOptions", () => {
  it("keeps the driver defaults for a direct connection", () => {
    expect(connectionOptions({})).toEqual({});
    expect(connectionOptions({ DATABASE_POOLER: "" })).toEqual({});
    expect(connectionOptions({ DATABASE_POOLER: "false" })).toEqual({});
  });

  it("uses one connection and no prepared statements behind a transaction pooler", () => {
    expect(connectionOptions({ DATABASE_POOLER: "transaction" })).toEqual({ max: 1, prepare: false });
  });

  it("ignores case and surrounding blanks in the setting", () => {
    expect(connectionOptions({ DATABASE_POOLER: "  Transaction " })).toEqual({ max: 1, prepare: false });
  });
});

describe("connectionOptions with an unknown pooler setting", () => {
  it("rejects a value that is neither empty, false nor transaction instead of silently going direct", () => {
    expect(() => connectionOptions({ DATABASE_POOLER: "transacton" })).toThrow(/DATABASE_POOLER/);
    expect(() => connectionOptions({ DATABASE_POOLER: "true" })).toThrow(/DATABASE_POOLER/);
  });

  it("names the accepted values and never echoes the connection string", () => {
    expect(() => connectionOptions({ DATABASE_POOLER: "x", DATABASE_URL: "postgres://u:secret@h/db" })).toThrow(
      /transaction/,
    );
    try {
      connectionOptions({ DATABASE_POOLER: "x", DATABASE_URL: "postgres://u:secret@h/db" });
    } catch (error) {
      expect(String(error)).not.toContain("secret");
    }
  });

  it("still accepts the documented values", () => {
    expect(connectionOptions({ DATABASE_POOLER: "FALSE" })).toEqual({});
    expect(connectionOptions({ DATABASE_POOLER: " " })).toEqual({});
  });
});

describe("openDatabase", () => {
  const url = "postgres://app:pw@localhost:5432/parkline";

  it("hands the pooler options to the driver", async () => {
    const sql = openDatabase({ DATABASE_URL: url, DATABASE_POOLER: "transaction" });
    expect(sql.options.max).toBe(1);
    expect(sql.options.prepare).toBe(false);
    await sql.end();
  });

  it("keeps the driver defaults for a direct connection", async () => {
    const sql = openDatabase({ DATABASE_URL: url });
    expect(sql.options.max).toBe(10);
    expect(sql.options.prepare).toBe(true);
    await sql.end();
  });

  it("fails at startup on an unknown pooler value before opening anything", () => {
    expect(() => openDatabase({ DATABASE_URL: url, DATABASE_POOLER: "transacton" })).toThrow(/DATABASE_POOLER/);
  });

  it("fails clearly when DATABASE_URL is missing or blank", () => {
    expect(() => openDatabase({})).toThrow(/DATABASE_URL is not set/);
    expect(() => openDatabase({ DATABASE_URL: "  " })).toThrow(/DATABASE_URL is not set/);
  });
});
