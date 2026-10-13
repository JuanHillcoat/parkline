import { describe, expect, it } from "vitest";
import {
  checkInput,
  collectInput,
  describeInstall,
  needsConfirmation,
  readFlags,
  requireTerminal,
  type Ask,
} from "../install-admin-input";

const answers = (log: string[]): Ask => (label, hidden) => {
  log.push(`${label}:${hidden ? "hidden" : "visible"}`);
  return Promise.resolve(`typed ${label}`);
};

const allFlags = ["--tenant-name", "Synthetic Tenant", "--email", "admin@example.test", "--display-name", "Admin"];

describe("install-admin input", () => {
  it("rejects --password because the password never comes from a flag", () => {
    expect(() => readFlags(["--password", "secret-value-123"])).toThrow();
  });

  it("uses INSTALL_ADMIN_PASSWORD without prompting for it", async () => {
    const asked: string[] = [];
    const input = await collectInput(readFlags(allFlags), { INSTALL_ADMIN_PASSWORD: "from-env-password" }, answers(asked));
    expect(input.password).toBe("from-env-password");
    expect(asked).toEqual([]);
  });

  it("prompts for the password with no echo when the env variable is missing", async () => {
    const asked: string[] = [];
    const input = await collectInput(readFlags(allFlags), {}, answers(asked));
    expect(input.password).toBe("typed Admin password (hidden, at least 12 characters)");
    expect(asked).toEqual(["Admin password (hidden, at least 12 characters):hidden"]);
  });

  it("lets flags override prompts and prompts only for what is missing", async () => {
    const asked: string[] = [];
    const input = await collectInput(readFlags(["--email", "flag@example.test"]), { INSTALL_ADMIN_PASSWORD: "p" }, answers(asked));
    expect(input.email).toBe("flag@example.test");
    expect(asked).toEqual(["Organization name:visible", "Admin display name (a person's name, not the password):visible"]);
  });

  it("describes what will be created without ever including the password", () => {
    const lines = describeInstall({
      tenantName: "Synthetic Tenant",
      email: "admin@example.test",
      displayName: "Ana Admin",
      password: "a-very-secret-value",
    });
    const text = lines.join("\n");
    expect(text).toContain("Synthetic Tenant");
    expect(text).toContain("admin@example.test");
    expect(text).toContain("Ana Admin");
    expect(text).not.toContain("a-very-secret-value");
  });

  it("rejects a display name that is the password or contains it", () => {
    const base = { tenantName: "T", email: "a@example.test", password: "correct-horse-battery" };
    expect(checkInput({ ...base, displayName: "correct-horse-battery" })).toMatch(/display name/i);
    expect(checkInput({ ...base, displayName: "x correct-horse-battery y" })).toMatch(/display name/i);
    expect(checkInput({ ...base, displayName: "Ana Admin" })).toBeNull();
  });

  it("parses --yes and asks for confirmation only on a terminal without it", () => {
    expect(readFlags(["--yes"]).yes).toBe(true);
    expect(needsConfirmation({ yes: undefined }, true)).toBe(true);
    expect(needsConfirmation({ yes: true }, true)).toBe(false);
    expect(needsConfirmation({ yes: undefined }, false)).toBe(false);
  });

  it("fails with a clear error when a value is missing and there is no terminal", () => {
    expect(() => {
      requireTerminal("Admin password", false);
    }).toThrow(
      "Admin password is required (no terminal available to ask)",
    );
    expect(() => {
      requireTerminal("Admin password", true);
    }).not.toThrow();
  });
});
