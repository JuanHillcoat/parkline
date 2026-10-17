import { describe, expect, it } from "vitest";
import {
  assertReasonRule,
  hasReason,
  reasonRuleViolation,
  requiresReason,
  SENSITIVE_AUDIT_ACTIONS,
} from "../sensitive-actions";

describe("SENSITIVE_AUDIT_ACTIONS", () => {
  it("is the closed list; changing it is deliberate and needs a migration (see the module comment)", () => {
    expect([...SENSITIVE_AUDIT_ACTIONS]).toEqual([
      "role.assign",
      "role.revoke",
      "role.change",
      "user.deactivate",
    ]);
  });
});

describe("requiresReason", () => {
  it.each(SENSITIVE_AUDIT_ACTIONS)("requires a reason for %s", (action) => {
    expect(requiresReason(action)).toBe(true);
  });

  it("does not require one for other actions", () => {
    expect(requiresReason("user.create")).toBe(false);
    expect(requiresReason("")).toBe(false);
  });
});

describe("hasReason", () => {
  it("is false for null, undefined, empty and whitespace", () => {
    for (const value of [null, undefined, "", "   ", "\t\n"]) {
      expect(hasReason(value)).toBe(false);
    }
  });

  it("is true for non-blank text", () => {
    expect(hasReason(" because ")).toBe(true);
  });

  it.each([
    ["no-break space", "\u00A0"],
    ["zero-width space", "\u200B"],
    ["ideographic space", "\u3000"],
    ["byte order mark", "\uFEFF"],
    ["word joiner", "\u2060"],
    ["next line", "\u0085"],
    ["mixed with ASCII whitespace", " \t\u00A0\u200B\n\u3000\uFEFF\r"],
  ])("is false for a reason made only of invisible characters (%s)", (_name, value) => {
    expect(hasReason(value)).toBe(false);
  });

  it("is true when a visible character sits among invisible ones", () => {
    expect(hasReason("\u200B\u00A0x\uFEFF")).toBe(true);
    expect(hasReason("\u200E")).toBe(true);
    expect(hasReason("\u200A\u200E")).toBe(true);
  });
});

describe("assertReasonRule", () => {
  it("throws for a sensitive action without a usable reason, without echoing the reason", () => {
    for (const reason of [undefined, "", "  "]) {
      expect(() => {
        assertReasonRule({ action: "role.assign", reason });
      }).toThrow(/role\.assign.*reason/);
    }
  });

  it("accepts a sensitive action with a reason and other actions without one", () => {
    expect(reasonRuleViolation({ action: "role.assign", reason: "ok" })).toBeNull();
    expect(reasonRuleViolation({ action: "user.create" })).toBeNull();
  });
});
