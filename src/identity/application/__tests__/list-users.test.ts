import { describe, expect, it } from "vitest";
import type { Role } from "../../domain/role";
import { createHarness } from "./support/harness";

describe("ListUsers", () => {
  it("lists the tenant users ordered by display name with active roles", async () => {
    const h = createHarness();
    const { admin } = await h.installTenantA();
    await h.addUser(admin, "zed@example.test", "viewer");
    await h.addUser(admin, "mia@example.test", "manager");
    const result = await h.listUsers.execute({ actor: admin });
    if (!result.ok) throw result.error;
    expect(result.value.map((u) => u.email)).toEqual([
      "admin@example.test",
      "mia@example.test",
      "zed@example.test",
    ]);
    expect(result.value[1]).toEqual({
      id: expect.any(String) as string,
      email: "mia@example.test",
      displayName: "mia@example.test",
      active: true,
      roles: ["manager"],
    });
  });

  it("never exposes password hashes", async () => {
    const h = createHarness();
    const { admin } = await h.installTenantA();
    const result = await h.listUsers.execute({ actor: admin });
    if (!result.ok) throw result.error;
    expect(JSON.stringify(result.value)).not.toMatch(/hash|fake/i);
    for (const row of result.value) {
      expect(Object.keys(row).sort()).toEqual(["active", "displayName", "email", "id", "roles"]);
    }
  });

  it("is allowed for admin and manager and denied for the other roles", async () => {
    const h = createHarness();
    const { admin } = await h.installTenantA();
    const outcomes: Record<string, boolean> = {};
    const roles: Role[] = ["admin", "manager", "viewer", "supervisor", "fleet_analyst"];
    for (const role of roles) {
      const user = await h.addUser(admin, `${role}-user@example.test`, role);
      const result = await h.listUsers.execute({ actor: await h.actorOf(user) });
      outcomes[role] = result.ok;
      if (!result.ok) expect(result.error.code).toBe("forbidden");
    }
    expect(outcomes).toEqual({
      admin: true,
      manager: true,
      viewer: false,
      supervisor: false,
      fleet_analyst: false,
    });
  });

  it("only lists the actor tenant", async () => {
    const h = createHarness();
    const { admin } = await h.installTenantA();
    await h.seedTenantB();
    const result = await h.listUsers.execute({ actor: admin });
    if (!result.ok) throw result.error;
    expect(result.value.map((u) => u.email)).toEqual(["admin@example.test"]);
  });

  it("lists only active role assignments", async () => {
    const h = createHarness();
    const { tenant, admin } = await h.installTenantA();
    const ana = await h.addUser(admin, "ana@example.test", "manager");
    const scope = { type: "tenant", id: tenant.id } as const;
    const revoked = await h.revokeRole.execute({
      actor: admin,
      userId: ana.id,
      role: "manager",
      scope,
      reason: "cleanup",
    });
    expect(revoked.ok).toBe(true);
    await h.assignRole.execute({ actor: admin, userId: ana.id, role: "viewer", scope, reason: "read only" });
    const result = await h.listUsers.execute({ actor: admin });
    if (!result.ok) throw result.error;
    expect(result.value.find((u) => u.id === ana.id)?.roles).toEqual(["viewer"]);
  });
});
