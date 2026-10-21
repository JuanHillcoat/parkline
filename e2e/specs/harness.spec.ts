import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { login } from "../support/auth";
import { openSeeder, resetCatalogs } from "../support/data";
import { readWorld } from "../support/world";

/** Proves the helpers every suite relies on: seeding, resetting and keeping the world intact. */
test.describe("test harness", () => {
  test("seeds through the use cases and resets without touching the world", async ({ page }) => {
    const seeder = await openSeeder();
    try {
      const supplier = await seeder.supplier("Harness supplier");
      const assetType = await seeder.assetType("Harness type");
      await seeder.equipment({ supplierId: supplier, assetTypeId: assetType, internalCode: "H-1" });
    } finally {
      await seeder.close();
    }
    await resetCatalogs();

    const sql = postgres(readWorld().ownerUrl, { max: 1, onnotice: () => undefined });
    try {
      const [rows] = await sql<{ equipments: number; suppliers: number; users: number; operations: number }[]>`
        select (select count(*) from equipments)::int as equipments,
               (select count(*) from suppliers)::int as suppliers,
               (select count(*) from users)::int as users,
               (select count(*) from operations)::int as operations`;
      expect(rows).toEqual({ equipments: 0, suppliers: 0, users: 5, operations: 1 });
    } finally {
      await sql.end();
    }
    await login(page, "supervisor");
  });
});
