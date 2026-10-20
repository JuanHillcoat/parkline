import { describe, expect, it } from "vitest";
import { createHarness } from "./support/harness";

describe("InMemoryFleetStore.read", () => {
  it("does not let a read transaction persist audit entries or rows", async () => {
    const h = createHarness();
    const s = await h.seedTenantA();
    const entries = h.audit.entries.length;
    await h.store.read(async (tx) => {
      await tx.audit.record({
        occurredAt: new Date(), actorId: "u", actorKind: "user", actorRole: "admin", action: "fleet.supplier.rename",
        entityType: "supplier", entityId: s.supplierA.id, tenantId: "t-a", correlationId: "c", origin: "ui",
      });
      await tx.suppliers.rename("t-a", s.supplierA.id, "CHANGED");
    });
    expect(h.audit.entries).toHaveLength(entries);
    const after = await h.store.read((tx) => tx.suppliers.findById("t-a", s.supplierA.id));
    expect(after?.name).toBe(s.supplierA.name);
  });
});
