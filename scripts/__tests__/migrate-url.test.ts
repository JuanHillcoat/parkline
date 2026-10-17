import { describe, expect, it } from "vitest";
import { migrationUrl } from "../migrate-url";

describe("migrationUrl", () => {
  it("prefers MIGRATE_DATABASE_URL", () => {
    const env = { MIGRATE_DATABASE_URL: "postgres://owner@h/db", DATABASE_URL: "postgres://app@h/db" };
    expect(migrationUrl(env)).toBe("postgres://owner@h/db");
  });

  it("falls back to DATABASE_URL when MIGRATE_DATABASE_URL is unset or blank", () => {
    expect(migrationUrl({ DATABASE_URL: "postgres://app@h/db" })).toBe("postgres://app@h/db");
    expect(migrationUrl({ MIGRATE_DATABASE_URL: "  ", DATABASE_URL: "postgres://app@h/db" })).toBe("postgres://app@h/db");
  });

  it("returns undefined when neither is set", () => {
    expect(migrationUrl({})).toBeUndefined();
  });
});
