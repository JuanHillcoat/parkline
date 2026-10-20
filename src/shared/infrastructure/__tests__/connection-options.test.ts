import { describe, expect, it } from "vitest";
import { connectionOptions } from "../connection-options";

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
