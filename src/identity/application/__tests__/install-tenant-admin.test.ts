import { describe, expect, it } from "vitest";
import { createHarness, PASSWORD } from "./support/harness";

const input = {
  tenantName: "Tenant A",
  email: "Admin@Example.test",
  displayName: "Admin A",
  password: PASSWORD,
};

describe("InstallTenantAdmin", () => {
  it("creates the tenant, a hashed admin and a tenant-scoped admin assignment", async () => {
    const h = createHarness();
    const result = await h.install.execute(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { tenant, user } = result.value;
    expect(user.email).toBe("admin@example.test");
    const stored = await h.store.read((tx) => tx.users.findByEmail(tenant.id, user.email));
    expect(stored?.passwordHash).not.toBe(PASSWORD);
    expect(await h.hasher.verify(PASSWORD, stored?.passwordHash ?? "")).toBe(true);
    const assignments = await h.store.read((tx) => tx.assignments.listActiveByUser(tenant.id, user.id));
    expect(assignments).toEqual([
      { userId: user.id, role: "admin", scope: { type: "tenant", id: tenant.id }, active: true },
    ]);
  });

  it("audits the install as a system job event of the new tenant", async () => {
    const h = createHarness();
    const { tenant } = await h.installTenantA();
    const entries = h.auditOf("identity.install");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actorKind: "system",
      actorRole: "system",
      origin: "job",
      tenantId: tenant.id,
      entityType: "tenant",
      entityId: tenant.id,
    });
    expect(entries[0]?.occurredAt).toEqual(h.clock.now());
    expect(entries[0]?.operationId).toBeUndefined();
  });

  it("rejects a second install without writing anything", async () => {
    const h = createHarness();
    await h.installTenantA();
    const second = await h.install.execute({ ...input, tenantName: "Tenant B", email: "b@example.test" });
    expect(!second.ok && second.error.code).toBe("tenant_already_installed");
    expect(h.auditOf("identity.install")).toHaveLength(1);
  });

  it("rejects a weak password and invalid input", async () => {
    const h = createHarness();
    const weak = await h.install.execute({ ...input, password: "short" });
    expect(!weak.ok && weak.error.code).toBe("weak_password");
    const blank = await h.install.execute({ ...input, tenantName: " " });
    expect(!blank.ok && blank.error.code).toBe("validation");
    expect(await h.store.read((tx) => tx.tenants.findSingle())).toBeNull();
  });

  it("rolls the install back when the audit entry cannot be written", async () => {
    const h = createHarness();
    h.audit.failNextRecord(new Error("audit down"));
    await expect(h.install.execute(input)).rejects.toThrow("audit down");
    expect(await h.store.read((tx) => tx.tenants.findSingle())).toBeNull();
  });
});
