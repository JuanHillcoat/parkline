import { moreToggle } from "../support/detail-page";
import { expect, test, type Locator, type APIRequest, type Page } from "@playwright/test";
import { copy } from "../../app/_lib/copy";
import { buttonsOf, gotoDetail, menuOf } from "../support/assignment-flows";
import { openSeeder, resetCatalogs } from "../support/data";
import {
  expectDialogClosed,
  fill,
  fillEquipment,
  gotoFleet,
  openDialog,
  REQUIRED_TEXT_DEFAULTS,
  rowOf,
  skipBrowserValidation,
  submitDialog,
} from "../support/fleet-flows";
import {
  fileInput,
  IMAGE_ACTIONS,
  MAX_STORED_BYTES,
  chooseImage,
  chooseImageAction,
  chosenFile,
  emptyFile,
  equipmentAudit,
  equipmentIdOf,
  expectLoaded,
  flatPng,
  gifFile,
  imagePath,
  jpeg,
  noisyPng,
  png,
  previewOf,
  requestAs,
  storedImage,
  svgFile,
  textNamedPng,
  undecodableLargeJpeg,
  webp,
  type ImageFile,
} from "../support/image-flows";
import { boxOf, expectNoHorizontalScroll, VIEWPORT_WIDTH } from "../support/mobile-flows";
import { readWorld, storageStatePath, type RoleKey } from "../support/world";

const d = copy.dialogs;
const byCode = copy.errors.byCode;
const photoLabel = copy.fleet.detail.info.photoLabel;
const SUPPLIER = "IMG RENTAL";
const ASSET_TYPE = "IMG FORKLIFT";

/** One supplier and one asset type, and optionally one equipment (with an image) per call. */
async function seedUnits(units: readonly { code: string; image?: ImageFile }[]): Promise<Record<string, string>> {
  const seeder = await openSeeder();
  try {
    const supplierId = await seeder.supplier(SUPPLIER);
    const assetTypeId = await seeder.assetType(ASSET_TYPE);
    const ids: Record<string, string> = {};
    for (const unit of units) {
      ids[unit.code] = await seeder.equipment({ supplierId, assetTypeId, internalCode: unit.code });
      if (unit.image !== undefined) await seeder.equipmentImage(ids[unit.code] ?? "", unit.image.buffer);
    }
    return ids;
  } finally {
    await seeder.close();
  }
}

const idOf = (ids: Record<string, string>, code: string): string => {
  const id = ids[code];
  if (id === undefined) throw new Error(`Equipment ${code} was not seeded`);
  return id;
};

/** Opens the new equipment dialog filled with the required fields (and the image, when given). */
async function openNewEquipment(page: Page, code: string, image?: ImageFile): Promise<Locator> {
  await gotoFleet(page, "equipment");
  const dialog = await openDialog(page, d.newEquipment.trigger);
  await fillEquipment(dialog, { code, supplier: SUPPLIER, assetType: ASSET_TYPE, ...REQUIRED_TEXT_DEFAULTS });
  if (image !== undefined) await chooseImage(dialog, image);
  return dialog;
}

/** Opens the edit dialog of the row with this code. */
async function openEdit(page: Page, code: string): Promise<Locator> {
  await gotoFleet(page, "equipment");
  return openDialog(page, d.editEquipment.trigger, rowOf(page, code));
}

const thumbOf = (page: Page, code: string): Locator => rowOf(page, code).locator("img.thumb");
const detailImage = (page: Page): Locator => page.locator("img.photo-image");
const placeholder = (page: Page): Locator => page.locator(".photo-placeholder");
const alertOf = (dialog: Locator): Locator => dialog.getByRole("alert");

test.describe("registering an equipment with an image", () => {
  test.use({ storageState: storageStatePath("admin") });
  test.beforeEach(resetCatalogs);

  test("stores the image, shows it as a thumbnail in the list and in the detail, and audits its hash", async ({ page }) => {
    await seedUnits([]);
    const dialog = await openNewEquipment(page, "IMG-NEW", png());
    await expect(previewOf(dialog)).toBeVisible();
    await submitDialog(dialog, d.newEquipment.submit);
    await expectDialogClosed(page);
    const id = await equipmentIdOf("IMG-NEW");
    const stored = await storedImage(id);
    expect(stored?.content_type).toBe("image/png");
    await expectLoaded(thumbOf(page, "IMG-NEW"));
    await expect(thumbOf(page, "IMG-NEW")).toHaveAttribute("src", `${imagePath(id)}?v=${stored?.sha256 ?? ""}`);
    await expect(thumbOf(page, "IMG-NEW")).toHaveAttribute("loading", "lazy");
    await gotoDetail(page, id, "IMG-NEW");
    await expectLoaded(detailImage(page));
    await expect(detailImage(page)).toHaveAttribute("alt", photoLabel);
    await expect(placeholder(page)).toHaveCount(0);
    const [created] = await equipmentAudit(id);
    expect(created?.action).toBe("fleet.equipment.create");
    expect(created?.after?.imageHash).toBe(stored?.sha256);
  });

  test("accepts JPEG and WebP files too", async ({ page }) => {
    await seedUnits([]);
    for (const [code, file, type] of [["IMG-JPG", jpeg(), "image/jpeg"], ["IMG-WEBP", webp(), "image/webp"]] as const) {
      const dialog = await openNewEquipment(page, code, file);
      await submitDialog(dialog, d.newEquipment.submit);
      await expectDialogClosed(page);
      expect((await storedImage(await equipmentIdOf(code)))?.content_type).toBe(type);
    }
  });

  test("without an image the list shows no thumbnail and the detail keeps the placeholder", async ({ page }) => {
    await seedUnits([]);
    const dialog = await openNewEquipment(page, "IMG-NONE");
    await expect(previewOf(dialog)).toHaveCount(0);
    await submitDialog(dialog, d.newEquipment.submit);
    await expectDialogClosed(page);
    const id = await equipmentIdOf("IMG-NONE");
    expect(await storedImage(id)).toBeNull();
    await expect(rowOf(page, "IMG-NONE")).toBeVisible();
    await expect(thumbOf(page, "IMG-NONE")).toHaveCount(0);
    await gotoDetail(page, id, "IMG-NONE");
    await expect(placeholder(page)).toBeVisible();
    await expect(detailImage(page)).toHaveCount(0);
    expect((await equipmentAudit(id))[0]?.after?.imageHash ?? null).toBeNull();
  });

  test("the dialog offers an optional image field with its hint and accepted types", async ({ page }) => {
    await seedUnits([]);
    const dialog = await openNewEquipment(page, "IMG-HINT");
    await expect(dialog.getByLabel(copy.dialogs.imageField.label, { exact: true })).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
    await expect(dialog.getByText(copy.dialogs.imageField.hint)).toBeVisible();
    await expect(dialog.getByLabel(copy.dialogs.imageField.label, { exact: true })).not.toHaveAttribute("required", /.*/u);
  });

  test("the preview is cleared when the dialog closes after a successful registration", async ({ page }) => {
    await seedUnits([]);
    const dialog = await openNewEquipment(page, "IMG-RESET", png());
    await submitDialog(dialog, d.newEquipment.submit);
    await expectDialogClosed(page);
    const again = await openDialog(page, d.newEquipment.trigger);
    await expect(previewOf(again)).toHaveCount(0);
  });
});

test.describe("errors of the image in the create dialog", () => {
  test.use({ storageState: storageStatePath("admin") });
  test.beforeEach(resetCatalogs);

  const refused: readonly [string, () => ImageFile, string][] = [
    ["a text file named .png", textNamedPng, byCode.image_unsupported_type],
    ["an SVG file", svgFile, byCode.image_unsupported_type],
    ["a GIF file", gifFile, byCode.image_unsupported_type],
    ["an empty file", emptyFile, byCode.image_empty],
    ["a file between 500 KB and 2 MB that the browser cannot decode", undecodableLargeJpeg, byCode.image_too_large],
  ];

  for (const [title, file, message] of refused) {
    test(`refuses ${title} with its message and registers nothing`, async ({ page }) => {
      await seedUnits([]);
      const dialog = await openNewEquipment(page, "IMG-BAD", file());
      await submitDialog(dialog, d.newEquipment.submit);
      await expect(alertOf(dialog)).toHaveText(message);
      await expect(dialog).toBeVisible();
      await page.reload();
      await expect(page.getByRole("button", { name: d.newEquipment.trigger })).toBeVisible();
      await expect(rowOf(page, "IMG-BAD")).toHaveCount(0);
    });
  }

  test("keeps the other fields after an image error so the person only changes the file", async ({ page }) => {
    await seedUnits([]);
    const dialog = await openNewEquipment(page, "IMG-KEEP", textNamedPng());
    await submitDialog(dialog, d.newEquipment.submit);
    await expect(alertOf(dialog)).toHaveText(byCode.image_unsupported_type);
    await expect(dialog.getByLabel(d.equipmentFields.internalCodeLabel, { exact: true })).toHaveValue("IMG-KEEP");
    await chooseImage(dialog, png());
    await submitDialog(dialog, d.newEquipment.submit);
    await expectDialogClosed(page);
    expect(await storedImage(await equipmentIdOf("IMG-KEEP"))).not.toBeNull();
  });
});

test.describe("changing the image of an equipment", () => {
  test.use({ storageState: storageStatePath("fleet_analyst") });
  test.beforeEach(resetCatalogs);

  test("replaces the image, shows the new one and audits both hashes with the reason", async ({ page }) => {
    const ids = await seedUnits([{ code: "IMG-REP", image: png() }]);
    const id = idOf(ids, "IMG-REP");
    const before = await storedImage(id);
    const dialog = await openEdit(page, "IMG-REP");
    await chooseImageAction(dialog, IMAGE_ACTIONS.replace);
    await chooseImage(dialog, jpeg());
    await fill(dialog, copy.common.reason, "Wrong photo");
    await submitDialog(dialog, d.editEquipment.submit);
    await expectDialogClosed(page);
    const after = await storedImage(id);
    expect(after?.content_type).toBe("image/jpeg");
    expect(after?.sha256).not.toBe(before?.sha256);
    await expect(thumbOf(page, "IMG-REP")).toHaveAttribute("src", `${imagePath(id)}?v=${after?.sha256 ?? ""}`);
    const update = (await equipmentAudit(id)).at(-1);
    expect(update).toMatchObject({ action: "fleet.equipment.update", reason: "Wrong photo" });
    expect(update?.before?.imageHash).toBe(before?.sha256);
    expect(update?.after?.imageHash).toBe(after?.sha256);
  });

  test("replaces the image from the detail page and the page refreshes", async ({ page }) => {
    const ids = await seedUnits([{ code: "IMG-DET", image: png() }]);
    const id = idOf(ids, "IMG-DET");
    const before = await storedImage(id);
    await gotoDetail(page, id, "IMG-DET");
    const dialog = await openDialog(page, d.editEquipment.trigger, buttonsOf(page));
    await chooseImageAction(dialog, IMAGE_ACTIONS.replace);
    await chooseImage(dialog, webp());
    await fill(dialog, copy.common.reason, "Better photo");
    await submitDialog(dialog, d.editEquipment.submit);
    await expectDialogClosed(page);
    const after = await storedImage(id);
    expect(after?.sha256).not.toBe(before?.sha256);
    await expect(detailImage(page)).toHaveAttribute("src", `${imagePath(id)}?v=${after?.sha256 ?? ""}`);
  });

  test("removes the image and the detail goes back to the placeholder", async ({ page }) => {
    const ids = await seedUnits([{ code: "IMG-DEL", image: png() }]);
    const id = idOf(ids, "IMG-DEL");
    const before = await storedImage(id);
    const dialog = await openEdit(page, "IMG-DEL");
    await chooseImageAction(dialog, IMAGE_ACTIONS.remove);
    await fill(dialog, copy.common.reason, "Photo of another unit");
    await submitDialog(dialog, d.editEquipment.submit);
    await expectDialogClosed(page);
    expect(await storedImage(id)).toBeNull();
    await expect(thumbOf(page, "IMG-DEL")).toHaveCount(0);
    await gotoDetail(page, id, "IMG-DEL");
    await expect(placeholder(page)).toBeVisible();
    const update = (await equipmentAudit(id)).at(-1);
    expect(update?.before?.imageHash).toBe(before?.sha256);
    expect(update?.after?.imageHash ?? null).toBeNull();
  });

  test("adds an image to an equipment that had none", async ({ page }) => {
    const ids = await seedUnits([{ code: "IMG-ADD" }]);
    const id = idOf(ids, "IMG-ADD");
    const dialog = await openEdit(page, "IMG-ADD");
    await expect(dialog.getByText(copy.dialogs.imageField.none)).toBeVisible();
    await expect(dialog.getByRole("radio")).toHaveCount(0);
    await expect(dialog.getByLabel(IMAGE_ACTIONS.keep, { exact: true })).toHaveCount(0);
    await expect(dialog.getByLabel(IMAGE_ACTIONS.remove, { exact: true })).toHaveCount(0);
    await expect(fileInput(dialog)).toHaveCount(1);
    await expect(dialog.getByLabel(IMAGE_ACTIONS.add, { exact: true })).toBeVisible();
    await chooseImage(dialog, png());
    await fill(dialog, copy.common.reason, "First photo");
    await submitDialog(dialog, d.editEquipment.submit);
    await expectDialogClosed(page);
    expect((await storedImage(id))?.content_type).toBe("image/png");
    await expectLoaded(thumbOf(page, "IMG-ADD"));
  });

  test("an equipment without an image, edited without choosing a file, stays without one", async ({ page }) => {
    const ids = await seedUnits([{ code: "IMG-NONE2" }]);
    const id = idOf(ids, "IMG-NONE2");
    const dialog = await openEdit(page, "IMG-NONE2");
    await fill(dialog, d.equipmentFields.brandLabel, "NEW BRAND");
    await fill(dialog, copy.common.reason, "Brand correction");
    await submitDialog(dialog, d.editEquipment.submit);
    await expectDialogClosed(page);
    expect(await storedImage(id)).toBeNull();
  });

  test("an image-only change needs the reason and saves nothing without it", async ({ page }) => {
    const ids = await seedUnits([{ code: "IMG-REASON", image: png() }]);
    const id = idOf(ids, "IMG-REASON");
    const before = await storedImage(id);
    const dialog = await openEdit(page, "IMG-REASON");
    await skipBrowserValidation(dialog);
    await chooseImageAction(dialog, IMAGE_ACTIONS.replace);
    await chooseImage(dialog, jpeg());
    await fill(dialog, copy.common.reason, "   ");
    await submitDialog(dialog, d.editEquipment.submit);
    await expect(alertOf(dialog)).toHaveText(byCode.reason_required);
    expect((await storedImage(id))?.sha256).toBe(before?.sha256);
  });

  test("keep is the default: editing another field leaves the image as it was", async ({ page }) => {
    const ids = await seedUnits([{ code: "IMG-KEEP2", image: png() }]);
    const id = idOf(ids, "IMG-KEEP2");
    const before = await storedImage(id);
    const dialog = await openEdit(page, "IMG-KEEP2");
    await expect(dialog.getByLabel(IMAGE_ACTIONS.keep, { exact: true })).toBeChecked();
    await expect(dialog.getByRole("radio")).toHaveCount(3);
    await expect(dialog.locator("img.image-preview")).toHaveAttribute("alt", copy.dialogs.imageField.currentAlt);
    await fill(dialog, d.equipmentFields.brandLabel, "NEW BRAND");
    await fill(dialog, copy.common.reason, "Brand correction");
    await submitDialog(dialog, d.editEquipment.submit);
    await expectDialogClosed(page);
    expect((await storedImage(id))?.sha256).toBe(before?.sha256);
    const update = (await equipmentAudit(id)).at(-1);
    expect(update?.before?.imageHash).toBe(before?.sha256);
    expect(update?.after?.imageHash).toBe(before?.sha256);
  });

  test("keeping the image and changing nothing else is still no change", async ({ page }) => {
    await seedUnits([{ code: "IMG-NOOP", image: png() }]);
    const dialog = await openEdit(page, "IMG-NOOP");
    await fill(dialog, copy.common.reason, "Nothing to do");
    await submitDialog(dialog, d.editEquipment.submit);
    await expect(alertOf(dialog)).toHaveText(byCode.no_changes);
  });

  test("replacing with no file chosen is refused as an empty image", async ({ page }) => {
    const ids = await seedUnits([{ code: "IMG-NOFILE", image: png() }]);
    const before = await storedImage(idOf(ids, "IMG-NOFILE"));
    const dialog = await openEdit(page, "IMG-NOFILE");
    await skipBrowserValidation(dialog);
    await chooseImageAction(dialog, IMAGE_ACTIONS.replace);
    await fill(dialog, copy.common.reason, "Replace it");
    await submitDialog(dialog, d.editEquipment.submit);
    await expect(alertOf(dialog)).toHaveText(byCode.image_empty);
    expect((await storedImage(idOf(ids, "IMG-NOFILE")))?.sha256).toBe(before?.sha256);
  });

  test("refuses an unsupported file and a too large one when replacing, keeping the current image", async ({ page }) => {
    const ids = await seedUnits([{ code: "IMG-REFUSE", image: png() }]);
    const before = await storedImage(idOf(ids, "IMG-REFUSE"));
    const dialog = await openEdit(page, "IMG-REFUSE");
    await chooseImageAction(dialog, IMAGE_ACTIONS.replace);
    await fill(dialog, copy.common.reason, "Try files");
    await chooseImage(dialog, svgFile());
    await submitDialog(dialog, d.editEquipment.submit);
    await expect(alertOf(dialog)).toHaveText(byCode.image_unsupported_type);
    await chooseImage(dialog, undecodableLargeJpeg());
    await submitDialog(dialog, d.editEquipment.submit);
    await expect(alertOf(dialog)).toHaveText(byCode.image_too_large);
    expect((await storedImage(idOf(ids, "IMG-REFUSE")))?.sha256).toBe(before?.sha256);
  });
});

test.describe("the client downscale", () => {
  test.use({ storageState: storageStatePath("admin") });
  test.beforeEach(resetCatalogs);

  test("shrinks a large photo to a WebP of at most 500 KB before it is sent, and the server stores that", async ({ page }) => {
    const large = noisyPng(1600, 1200);
    expect(large.length, "the fixture is bigger than the limit").toBeGreaterThan(MAX_STORED_BYTES);
    await seedUnits([]);
    const dialog = await openNewEquipment(page, "IMG-BIG", png("large.png", large));
    await expect(previewOf(dialog)).toBeVisible();
    await expect.poll(async () => (await chosenFile(dialog)).type).toBe("image/webp");
    expect((await chosenFile(dialog)).size).toBeLessThanOrEqual(MAX_STORED_BYTES);
    await submitDialog(dialog, d.newEquipment.submit);
    await expectDialogClosed(page);
    const id = await equipmentIdOf("IMG-BIG");
    const stored = await storedImage(id);
    expect(stored?.content_type).toBe("image/webp");
    expect(stored?.byte_size ?? Infinity).toBeLessThanOrEqual(MAX_STORED_BYTES);
    await gotoDetail(page, id, "IMG-BIG");
    await expectLoaded(detailImage(page));
    expect(await detailImage(page).evaluate((img: HTMLImageElement) => Math.max(img.naturalWidth, img.naturalHeight))).toBe(1280);
  });

  test("a file chosen while an earlier one is still being shrunk is the one that is sent", async ({ page }) => {
    await seedUnits([]);
    const dialog = await openNewEquipment(page, "IMG-RACE", png("large.png", noisyPng(1600, 1200)));
    const small = png("small.png");
    await chooseImage(dialog, small);
    await expect(previewOf(dialog)).toBeVisible();
    await page.waitForTimeout(1500); // long enough for the first, slower downscale to end
    expect(await chosenFile(dialog)).toEqual({ type: "image/png", size: small.buffer.length });
    await submitDialog(dialog, d.newEquipment.submit);
    await expectDialogClosed(page);
    expect((await storedImage(await equipmentIdOf("IMG-RACE")))?.content_type).toBe("image/png");
  });

  test("leaves a small image untouched", async ({ page }) => {
    await seedUnits([]);
    const small = png();
    const dialog = await openNewEquipment(page, "IMG-SMALL", small);
    await expect(previewOf(dialog)).toBeVisible();
    expect(await chosenFile(dialog)).toEqual({ type: "image/png", size: small.buffer.length });
    await submitDialog(dialog, d.newEquipment.submit);
    await expectDialogClosed(page);
    expect((await storedImage(await equipmentIdOf("IMG-SMALL")))?.content_type).toBe("image/png");
  });

  test("does not touch a file the browser cannot decode, so the server answers", async ({ page }) => {
    await seedUnits([]);
    const dialog = await openNewEquipment(page, "IMG-RAW", undecodableLargeJpeg());
    expect((await chosenFile(dialog)).type).toBe("image/jpeg");
    expect((await chosenFile(dialog)).size).toBeGreaterThan(MAX_STORED_BYTES);
  });
});

test.describe("the image endpoint", () => {
  test.use({ storageState: storageStatePath("fleet_analyst") });
  test.beforeEach(resetCatalogs);

  test("answers 200 with the stored type, the size, the validator and every safety header", async ({ request }) => {
    const file = png();
    const id = idOf(await seedUnits([{ code: "IMG-HTTP", image: file }]), "IMG-HTTP");
    const stored = await storedImage(id);
    const response = await request.get(imagePath(id));
    expect(response.status()).toBe(200);
    expect(await response.body()).toEqual(file.buffer);
    expect(response.headers()).toMatchObject({
      "content-type": "image/png",
      "content-length": String(file.buffer.length),
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "cache-control": "private, no-cache",
      etag: `"${stored?.sha256 ?? ""}"`,
      "content-disposition": "inline",
    });
  });

  test("answers 304 with no body when If-None-Match carries the ETag, and 200 for another one", async ({ request }) => {
    const id = idOf(await seedUnits([{ code: "IMG-ETAG", image: png() }]), "IMG-ETAG");
    const first = await request.get(imagePath(id));
    const etag = first.headers().etag ?? "";
    const second = await request.get(imagePath(id), { headers: { "If-None-Match": etag } });
    expect(second.status()).toBe(304);
    expect((await second.body()).length).toBe(0);
    expect(second.headers().etag).toBe(etag);
    const other = await request.get(imagePath(id), { headers: { "If-None-Match": '"not-the-hash"' } });
    expect(other.status()).toBe(200);
  });

  test("serves the new image under a new ETag after a change", async ({ request }) => {
    const id = idOf(await seedUnits([{ code: "IMG-NEWTAG", image: png() }]), "IMG-NEWTAG");
    const etag = (await request.get(imagePath(id))).headers().etag ?? "";
    const seeder = await openSeeder();
    await seeder.equipmentImage(id, jpeg().buffer);
    await seeder.close();
    const response = await request.get(imagePath(id), { headers: { "If-None-Match": etag } });
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("image/jpeg");
  });

  test("answers an empty 404 for an equipment without an image, an unknown id and a malformed id", async ({ request }) => {
    const id = idOf(await seedUnits([{ code: "IMG-NOIMG" }]), "IMG-NOIMG");
    for (const target of [id, "00000000-0000-4000-8000-000000000000", "not-an-id", "1%27%20or%201=1"]) {
      const response = await request.get(imagePath(target));
      expect(response.status(), target).toBe(404);
      expect((await response.body()).length, target).toBe(0);
    }
  });

  test("answers 401 with no body and no redirect when there is no session", async ({ playwright }) => {
    const id = idOf(await seedUnits([{ code: "IMG-ANON", image: png() }]), "IMG-ANON");
    const anonymous = await requestAs(playwright.request, null);
    const response = await anonymous.get(imagePath(id), { maxRedirects: 0 });
    expect(response.status()).toBe(401);
    expect((await response.body()).length).toBe(0);
    expect(response.headers().location).toBeUndefined();
    await anonymous.dispose();
  });
});

test.describe("the image follows the visibility of the equipment", () => {
  test.beforeEach(resetCatalogs);

  async function seedScoped(): Promise<{ near: string; far: string; loose: string; farOperation: string }> {
    const seeder = await openSeeder();
    try {
      const world = readWorld().ids;
      const supplierId = await seeder.supplier(SUPPLIER);
      const assetTypeId = await seeder.assetType(ASSET_TYPE);
      const division = await seeder.division("Img far division");
      const site = await seeder.site("Img far site");
      const farOperation = await seeder.operation({ division, site, name: "IMG FAR OP", costCenter: "7401" });
      const unit = async (code: string, operationId: string | null): Promise<string> => {
        const id = await seeder.equipment({ supplierId, assetTypeId, internalCode: code });
        await seeder.equipmentImage(id, png().buffer);
        if (operationId !== null) await seeder.assign({ equipmentId: id, operationId, day: "2026-01-05", reason: "Loaded late" });
        return id;
      };
      return { near: await unit("IMG-NEAR", world.operation), far: await unit("IMG-FAR", farOperation), loose: await unit("IMG-LOOSE", null), farOperation };
    } finally {
      await seeder.close();
    }
  }

  const statusOf = async (api: APIRequest, role: RoleKey, id: string): Promise<number> => {
    const context = await requestAs(api, role);
    try {
      return (await context.get(imagePath(id))).status();
    } finally {
      await context.dispose();
    }
  };

  test("company-wide readers see every image; scoped readers only the equipment their scope covers", async ({ playwright }) => {
    const ids = await seedScoped();
    for (const role of ["admin", "fleet_analyst", "viewer"] as const) {
      for (const id of [ids.near, ids.far, ids.loose]) expect(await statusOf(playwright.request, role, id), `${role} ${id}`).toBe(200);
    }
    for (const role of ["manager", "supervisor"] as const) {
      expect(await statusOf(playwright.request, role, ids.near), `${role} near`).toBe(200);
      expect(await statusOf(playwright.request, role, ids.far), `${role} far`).toBe(404);
      expect(await statusOf(playwright.request, role, ids.loose), `${role} unassigned`).toBe(404);
    }
  });

  test("moving the equipment to another division hides its image from the reader of the first one", async ({ playwright }) => {
    const ids = await seedScoped();
    expect(await statusOf(playwright.request, "manager", ids.near)).toBe(200);
    const seeder = await openSeeder();
    await seeder.move({ equipmentId: ids.near, operationId: ids.farOperation, day: "2026-02-10", reason: "Contract started" });
    await seeder.close();
    expect(await statusOf(playwright.request, "manager", ids.near)).toBe(404);
    expect(await statusOf(playwright.request, "supervisor", ids.near)).toBe(404);
    expect(await statusOf(playwright.request, "fleet_analyst", ids.near)).toBe(200);
  });
});

test.describe("roles", () => {
  test.beforeEach(resetCatalogs);

  test.describe("viewer", () => {
    test.use({ storageState: storageStatePath("viewer") });

    test("sees the image and the thumbnail and has no control to change it", async ({ page }) => {
      const id = idOf(await seedUnits([{ code: "IMG-VIEW", image: png() }]), "IMG-VIEW");
      await gotoFleet(page, "equipment");
      await expectLoaded(thumbOf(page, "IMG-VIEW"));
      await expect(page.getByRole("button", { name: d.newEquipment.trigger })).toHaveCount(0);
      await expect(page.getByRole("button", { name: d.editEquipment.trigger })).toHaveCount(0);
      await gotoDetail(page, id, "IMG-VIEW");
      await expectLoaded(detailImage(page));
      await expect(menuOf(page)).toHaveCount(0);
      await expect(page.locator('input[type="file"]')).toHaveCount(0);
    });
  });

  for (const role of ["admin", "fleet_analyst"] as const) {
    test.describe(role, () => {
      test.use({ storageState: storageStatePath(role) });

      test("can change the image from the detail page", async ({ page }) => {
        const id = idOf(await seedUnits([{ code: "IMG-ROLE", image: png() }]), "IMG-ROLE");
        await gotoDetail(page, id, "IMG-ROLE");
        await expect(moreToggle(page)).toBeVisible();
        const dialog = await openDialog(page, d.editEquipment.trigger, buttonsOf(page));
        await chooseImageAction(dialog, IMAGE_ACTIONS.remove);
        await fill(dialog, copy.common.reason, `Removed by ${role}`);
        await submitDialog(dialog, d.editEquipment.submit);
        await expectDialogClosed(page);
        expect(await storedImage(id)).toBeNull();
      });
    });
  }
});

test.describe("mobile layout of the image", () => {
  test.use({ storageState: storageStatePath("fleet_analyst") });
  test.beforeEach(resetCatalogs);

  test("@mobile the create dialog with a chosen image fits the screen", async ({ page }) => {
    await seedUnits([]);
    const dialog = await openNewEquipment(page, "IMG-MOB", png());
    await expect(previewOf(dialog)).toBeVisible();
    expect((await boxOf(dialog)).width).toBeLessThanOrEqual(VIEWPORT_WIDTH);
    const preview = await boxOf(previewOf(dialog));
    expect(preview.x + preview.width).toBeLessThanOrEqual(VIEWPORT_WIDTH);
    const input = await boxOf(dialog.getByLabel(copy.dialogs.imageField.label, { exact: true }));
    expect(input.x + input.width).toBeLessThanOrEqual(VIEWPORT_WIDTH);
    await expectNoHorizontalScroll(page);
  });

  test("@mobile the edit dialog with the current image fits the screen", async ({ page }) => {
    await seedUnits([{ code: "IMG-MOBE", image: png() }]);
    const dialog = await openEdit(page, "IMG-MOBE");
    await chooseImageAction(dialog, IMAGE_ACTIONS.replace);
    await expect(dialog.locator("img.image-preview")).toBeVisible();
    expect((await boxOf(dialog)).width).toBeLessThanOrEqual(VIEWPORT_WIDTH);
    await expectNoHorizontalScroll(page);
  });

  test("@mobile the thumbnail in the card and the detail image do not overflow", async ({ page }) => {
    const id = idOf(await seedUnits([{ code: "IMG-MOBV", image: png("p.png", flatPng(800, 600)) }]), "IMG-MOBV");
    await gotoFleet(page, "equipment");
    await expectLoaded(thumbOf(page, "IMG-MOBV"));
    const thumb = await boxOf(thumbOf(page, "IMG-MOBV"));
    expect(thumb.x + thumb.width).toBeLessThanOrEqual(VIEWPORT_WIDTH);
    await expectNoHorizontalScroll(page);
    await gotoDetail(page, id, "IMG-MOBV");
    await expectLoaded(detailImage(page));
    const image = await boxOf(detailImage(page));
    expect(image.x).toBeGreaterThanOrEqual(0);
    expect(image.x + image.width).toBeLessThanOrEqual(VIEWPORT_WIDTH);
    await expectNoHorizontalScroll(page);
  });
});
