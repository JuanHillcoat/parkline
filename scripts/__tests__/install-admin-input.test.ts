import { describe, expect, it } from "vitest";
import { collectInput, readFlags, requireTerminal, type Ask } from "../install-admin-input";

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
    expect(input.password).toBe("typed Admin password");
    expect(asked).toEqual(["Admin password:hidden"]);
  });

  it("lets flags override prompts and prompts only for what is missing", async () => {
    const asked: string[] = [];
    const input = await collectInput(readFlags(["--email", "flag@example.test"]), { INSTALL_ADMIN_PASSWORD: "p" }, answers(asked));
    expect(input.email).toBe("flag@example.test");
    expect(asked).toEqual(["Tenant name:visible", "Admin display name:visible"]);
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
