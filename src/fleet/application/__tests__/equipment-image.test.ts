import { describe, expect, it } from "vitest";
import { imageHash, MAX_IMAGE_BYTES } from "../../../shared/domain/image";
import { actorWith, createHarness, grant, type Harness } from "./support/harness";

const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Magic bytes followed by a marker byte, so two images with the same type have different hashes. */
const image = (magic: readonly number[], marker: number, size = 32): Uint8Array => {
  const bytes = new Uint8Array(size).fill(marker);
  bytes.set(magic);
  return bytes;
};
const jpegA = image(JPEG, 1);
const jpegB = image(JPEG, 2);
const png = image(PNG, 3);
const SVG = new TextEncoder().encode("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>");

const seed = async () => {
  const h = createHarness();
  const s = await h.seedTenantA();
  const withImage = h.orThrow(
    await h.createEquipment.execute(h.equipmentInput(s.supplierA.id, s.forklift.id, "EQ-IMG", { image: jpegA })),
  );
  return { h, s, withImage };
};

const code = (result: { ok: boolean; error?: { code: string } }): string => (result.ok ? "ok" : (result.error?.code ?? "?"));

describe("CreateEquipment with an image", () => {
  it("stores the image, shows its hash in the list and the detail, and puts the hash in the audit entry", async () => {
    const { h, withImage } = await seed();
    const got = h.orThrow(await h.getEquipmentImage.execute({ actor: h.admin, id: withImage.id }));
    expect(got).toMatchObject({ contentType: "image/jpeg", byteSize: jpegA.length, sha256: imageHash(jpegA) });
    expect([...got.data]).toEqual([...jpegA]);
    expect(h.orThrow(await h.getEquipment.execute({ actor: h.admin, id: withImage.id })).imageHash).toBe(imageHash(jpegA));
    const listed = h.orThrow(await h.listEquipment.execute({ actor: h.admin }));
    expect(listed.find((item) => item.id === withImage.id)?.imageHash).toBe(imageHash(jpegA));
    const entry = h.auditOf("fleet.equipment.create").find((e) => e.entityId === withImage.id);
    expect(entry?.after).toMatchObject({ imageHash: imageHash(jpegA) });
  });

  it("has no image by default: null hash in the audit entry and the detail, not_found for the image", async () => {
    const { h, s } = await seed();
    expect(h.auditOf("fleet.equipment.create").find((e) => e.entityId === s.eq1.id)?.after).toMatchObject({ imageHash: null });
    expect(h.orThrow(await h.getEquipment.execute({ actor: h.admin, id: s.eq1.id })).imageHash).toBeNull();
    expect(code(await h.getEquipmentImage.execute({ actor: h.admin, id: s.eq1.id }))).toBe("not_found");
    const explicit = await h.createEquipment.execute(h.equipmentInput(s.supplierA.id, s.forklift.id, "EQ-NULL", { image: null }));
    expect(explicit.ok).toBe(true);
  });

  it("validates the image before any write: nothing is stored or audited", async () => {
    const { h, s } = await seed();
    const entries = h.audit.entries.length;
    const cases: [Uint8Array, string][] = [
      [SVG, "image_unsupported_type"],
      [new Uint8Array(0), "image_empty"],
      [image(JPEG, 1, MAX_IMAGE_BYTES + 1), "image_too_large"],
    ];
    for (const [bytes, expected] of cases) {
      const result = await h.createEquipment.execute(h.equipmentInput(s.supplierA.id, s.forklift.id, "EQ-BAD", { image: bytes }));
      expect(code(result)).toBe(expected);
    }
    expect(h.audit.entries).toHaveLength(entries);
    const listed = h.orThrow(await h.listEquipment.execute({ actor: h.admin }));
    expect(listed.some((item) => item.internalCode === "EQ-BAD")).toBe(false);
  });

  it("stores no image when the equipment itself is refused (internal code taken)", async () => {
    const { h, s } = await seed();
    const taken = await h.createEquipment.execute(h.equipmentInput(s.supplierA.id, s.forklift.id, "EQ-IMG", { image: png }));
    expect(code(taken)).toBe("internal_code_taken");
    const kept = await h.store.read((tx) => tx.images.findHashes("t-a", [s.eq1.id]));
    expect(kept.size).toBe(0);
  });
});

const edit = (h: Harness, id: string, s: { supplierA: { id: string }; forklift: { id: string } }, extra: object) => ({
  actor: h.admin, id, reason: "Photo update", supplierId: s.supplierA.id, assetTypeId: s.forklift.id, internalCode: "EQ-IMG",
  brand: "Brand", model: "Model", year: null, serialNumber: null, batteryQuantity: null, observations: null, ...extra,
});

describe("UpdateEquipment image changes", () => {
  it("replaces the image: new bytes, and the audit entry has the hash before and after", async () => {
    const { h, s, withImage } = await seed();
    h.orThrow(await h.updateEquipment.execute(edit(h, withImage.id, s, { image: { action: "replace", bytes: png } })));
    const got = h.orThrow(await h.getEquipmentImage.execute({ actor: h.admin, id: withImage.id }));
    expect(got).toMatchObject({ contentType: "image/png", sha256: imageHash(png) });
    const entry = h.auditOf("fleet.equipment.update")[0];
    expect(entry?.before).toMatchObject({ imageHash: imageHash(jpegA) });
    expect(entry?.after).toMatchObject({ imageHash: imageHash(png) });
    expect(entry?.reason).toBe("Photo update");
  });

  it("adds an image to an equipment without one", async () => {
    const { h, s } = await seed();
    const input = edit(h, s.eq1.id, s, { internalCode: "EQ-0001", image: { action: "replace", bytes: jpegB } });
    h.orThrow(await h.updateEquipment.execute(input));
    expect(h.auditOf("fleet.equipment.update")[0]).toMatchObject({ before: { imageHash: null }, after: { imageHash: imageHash(jpegB) } });
  });

  it("removes the image", async () => {
    const { h, s, withImage } = await seed();
    h.orThrow(await h.updateEquipment.execute(edit(h, withImage.id, s, { image: { action: "remove" } })));
    expect(code(await h.getEquipmentImage.execute({ actor: h.admin, id: withImage.id }))).toBe("not_found");
    expect(h.orThrow(await h.getEquipment.execute({ actor: h.admin, id: withImage.id })).imageHash).toBeNull();
    expect(h.auditOf("fleet.equipment.update")[0]).toMatchObject({ before: { imageHash: imageHash(jpegA) }, after: { imageHash: null } });
  });

  it("keeps the image when a field changes and the image is kept or omitted", async () => {
    const { h, s, withImage } = await seed();
    h.orThrow(await h.updateEquipment.execute(edit(h, withImage.id, s, { model: "Other" })));
    h.orThrow(await h.updateEquipment.execute(edit(h, withImage.id, s, { model: "Third", image: { action: "keep" } })));
    expect(h.orThrow(await h.getEquipmentImage.execute({ actor: h.admin, id: withImage.id })).sha256).toBe(imageHash(jpegA));
    expect(h.auditOf("fleet.equipment.update")[1]).toMatchObject({ before: { imageHash: imageHash(jpegA) }, after: { imageHash: imageHash(jpegA) } });
  });

  it("counts an image-only change as a change", async () => {
    const { h, s, withImage } = await seed();
    const result = await h.updateEquipment.execute(edit(h, withImage.id, s, { image: { action: "replace", bytes: jpegB } }));
    expect(result.ok).toBe(true);
    expect(h.auditOf("fleet.equipment.update")).toHaveLength(1);
  });

  it("answers no_changes for nothing changed: kept image, same bytes, or removing a missing image", async () => {
    const { h, s, withImage } = await seed();
    const same = edit(h, withImage.id, s, {});
    expect(code(await h.updateEquipment.execute(same))).toBe("no_changes");
    expect(code(await h.updateEquipment.execute({ ...same, image: { action: "replace", bytes: jpegA } }))).toBe("no_changes");
    const bare = edit(h, s.eq1.id, s, { internalCode: "EQ-0001", image: { action: "remove" } });
    expect(code(await h.updateEquipment.execute(bare))).toBe("no_changes");
    expect(h.auditOf("fleet.equipment.update")).toHaveLength(0);
  });

  it("validates a replacement before any write: the equipment, its image and the audit stay as they were", async () => {
    const { h, s, withImage } = await seed();
    const entries = h.audit.entries.length;
    const cases: [Uint8Array, string][] = [
      [SVG, "image_unsupported_type"],
      [new Uint8Array(0), "image_empty"],
      [image(PNG, 1, MAX_IMAGE_BYTES + 1), "image_too_large"],
    ];
    for (const [bytes, expected] of cases) {
      const input = edit(h, withImage.id, s, { model: "Changed", image: { action: "replace", bytes } });
      expect(code(await h.updateEquipment.execute(input))).toBe(expected);
    }
    expect(h.audit.entries).toHaveLength(entries);
    expect(h.orThrow(await h.getEquipment.execute({ actor: h.admin, id: withImage.id }))).toMatchObject({ model: "Model", imageHash: imageHash(jpegA) });
  });

  it("needs a reason even for an image-only change", async () => {
    const { h, s, withImage } = await seed();
    const input = edit(h, withImage.id, s, { reason: "  ", image: { action: "remove" } });
    expect(code(await h.updateEquipment.execute(input))).toBe("reason_required");
    expect(h.orThrow(await h.getEquipment.execute({ actor: h.admin, id: withImage.id })).imageHash).toBe(imageHash(jpegA));
  });
});

describe("archive and restore keep the image", () => {
  it("leaves the image untouched through an archive and a restore, and refuses an edit while archived", async () => {
    const { h, s, withImage } = await seed();
    h.orThrow(await h.archiveEquipment.execute({ actor: h.analyst, id: withImage.id, reason: "Retired" }));
    expect(h.orThrow(await h.getEquipmentImage.execute({ actor: h.admin, id: withImage.id })).sha256).toBe(imageHash(jpegA));
    const archivedEdit = await h.updateEquipment.execute(edit(h, withImage.id, s, { image: { action: "remove" } }));
    expect(code(archivedEdit)).toBe("archived");
    h.orThrow(await h.restoreEquipment.execute({ actor: h.analyst, id: withImage.id, reason: "Back" }));
    expect(h.orThrow(await h.getEquipment.execute({ actor: h.admin, id: withImage.id })).imageHash).toBe(imageHash(jpegA));
  });
});

describe("GetEquipmentImage authorization and visibility", () => {
  it("answers the same not_found for a missing id, another tenant, no image and an out-of-scope equipment", async () => {
    const { h, s, withImage } = await seed();
    await h.assign(withImage.id, "op1", "2026-01-10");
    await h.assign(s.c43.id, "op3", "2026-01-10");
    const outside = actorWith([grant("viewer", "operation", "op3")]);
    const results = [
      await h.getEquipmentImage.execute({ actor: h.admin, id: "missing" }),
      await h.getEquipmentImage.execute({ actor: h.adminB, id: withImage.id }),
      await h.getEquipmentImage.execute({ actor: h.admin, id: s.c43.id }),
      await h.getEquipmentImage.execute({ actor: outside, id: withImage.id }),
    ];
    expect(results.map(code)).toEqual(["not_found", "not_found", "not_found", "not_found"]);
  });

  it("shows the image to readers whose scope covers the open assignment, and to a tenant-wide reader", async () => {
    const { h, withImage } = await seed();
    await h.assign(withImage.id, "op1", "2026-01-10");
    const readers = [
      actorWith([grant("viewer", "operation", "op1")]),
      actorWith([grant("manager", "business_unit", "bu1")]),
      actorWith([grant("viewer", "site", "s1")]),
      actorWith([grant("viewer", "tenant", "t-a")]),
    ];
    for (const actor of readers) expect(code(await h.getEquipmentImage.execute({ actor, id: withImage.id }))).toBe("ok");
  });

  it("hides an unassigned equipment from a scoped reader but not from a tenant-wide one", async () => {
    const { h, withImage } = await seed();
    const scoped = actorWith([grant("viewer", "operation", "op1")]);
    expect(code(await h.getEquipmentImage.execute({ actor: scoped, id: withImage.id }))).toBe("not_found");
    expect(code(await h.getEquipmentImage.execute({ actor: actorWith([grant("viewer", "tenant", "t-a")]), id: withImage.id }))).toBe("ok");
  });

  it("refuses an actor with no role and an inactive actor", async () => {
    const { h, withImage } = await seed();
    expect(code(await h.getEquipmentImage.execute({ actor: actorWith([]), id: withImage.id }))).toBe("not_found");
    const inactive = actorWith([grant("admin", "tenant", "t-a")], { active: false });
    expect(code(await h.getEquipmentImage.execute({ actor: inactive, id: withImage.id }))).toBe("forbidden");
  });
});
