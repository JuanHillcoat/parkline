/**
 * Helpers for the equipment image suites (issue 44): synthetic image files built in code, the dialog steps,
 * owner-side readers of what was stored, and request contexts for the image endpoint. No real photo is used.
 */
import { crc32, deflateSync } from "node:zlib";
import { expect, type APIRequest, type APIRequestContext, type Locator } from "@playwright/test";
import postgres from "postgres";
import { copy } from "../../app/_lib/copy";
import { BASE_URL, readWorld, storageStatePath, type RoleKey } from "./world";

export type ImageFile = { name: string; mimeType: string; buffer: Buffer };

export const MAX_STORED_BYTES = 500 * 1024;

const u32 = (value: number): Buffer => {
  const out = Buffer.alloc(4);
  out.writeUInt32BE(value);
  return out;
};

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  return Buffer.concat([u32(data.length), body, u32(crc32(body))]);
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Encodes raw RGB rows (each already prefixed with the filter byte 0) as a PNG. */
function encodePng(width: number, height: number, rows: Buffer): Buffer {
  const header = Buffer.concat([u32(width), u32(height), Buffer.from([8, 2, 0, 0, 0])]);
  return Buffer.concat([SIGNATURE, chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

/** A flat-colour PNG: tiny in bytes whatever its size in pixels. */
export function flatPng(width: number, height: number, [red, green, blue] = [200, 90, 30]): Buffer {
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x += 1) row.set([red, green, blue], 1 + x * 3);
  return encodePng(width, height, Buffer.concat(Array.from({ length: height }, () => row)));
}

/**
 * A photo-like PNG that is large in bytes (over 500 KB for 1600x1200) yet compresses well as WebP: a smooth
 * gradient with a little seeded noise, so the same file is produced on every run.
 */
export function noisyPng(width: number, height: number): Buffer {
  let seed = 12345;
  const noise = (): number => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return (seed >>> 16) & 3;
  };
  const rows = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    const base = y * (1 + width * 3);
    for (let x = 0; x < width * 3; x += 1) rows[base + 1 + x] = ((x >> 3) + (y >> 2) + noise()) & 0xff;
  }
  return encodePng(width, height, rows);
}

// Smallest valid files of each type, as base64 constants.
const JPEG_1X1 =
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
const WEBP_1X1 = "UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==";

export const png = (name = "photo.png", buffer = flatPng(40, 30)): ImageFile => ({ name, mimeType: "image/png", buffer });
export const jpeg = (name = "photo.jpg"): ImageFile => ({ name, mimeType: "image/jpeg", buffer: Buffer.from(JPEG_1X1, "base64") });
export const webp = (name = "photo.webp"): ImageFile => ({ name, mimeType: "image/webp", buffer: Buffer.from(WEBP_1X1, "base64") });

/** Files the server must refuse, named like images so only the content gives them away. */
export const textNamedPng = (): ImageFile => ({ name: "notes.png", mimeType: "image/png", buffer: Buffer.from("this is plain text") });
export const svgFile = (): ImageFile => ({
  name: "logo.svg",
  mimeType: "image/svg+xml",
  buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>'),
});
export const gifFile = (): ImageFile => ({ name: "anim.gif", mimeType: "image/gif", buffer: Buffer.from("GIF89a\u0001\u0000\u0001\u0000\u0000\u0000\u0000;", "latin1") });
export const emptyFile = (): ImageFile => ({ name: "empty.png", mimeType: "image/png", buffer: Buffer.alloc(0) });

/**
 * Between 500 KB and 2 MB, with a JPEG signature but no decodable picture: the browser cannot decode it, so the
 * client downscale leaves it alone and the server answers "too large".
 */
export const undecodableLargeJpeg = (): ImageFile => ({
  name: "big.jpg",
  mimeType: "image/jpeg",
  buffer: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(600 * 1024)]),
});

const m = copy.dialogs.imageField;

/** The file input of a dialog. */
export const fileInput = (dialog: Locator): Locator => dialog.locator('input[type="file"]');

export const chooseImage = (dialog: Locator, file: ImageFile): Promise<void> => fileInput(dialog).setInputFiles(file);

/** Picks keep, replace or remove in the edit dialog; the labels depend on whether the equipment has an image. */
export const chooseImageAction = (dialog: Locator, label: string): Promise<void> => dialog.getByLabel(label, { exact: true }).check();

export const IMAGE_ACTIONS = { keep: m.keep, replace: m.replace, add: m.add, remove: m.remove } as const;

/** The type and size of the file the browser will upload, after any client downscale. */
export const chosenFile = (dialog: Locator): Promise<{ type: string; size: number }> =>
  fileInput(dialog).evaluate((input: HTMLInputElement) => ({ type: input.files?.[0]?.type ?? "", size: input.files?.[0]?.size ?? 0 }));

export const previewOf = (dialog: Locator): Locator => dialog.locator("img.image-preview");

/** Waits until an `<img>` has loaded a real picture. */
export const expectLoaded = (image: Locator): Promise<void> =>
  expect.poll(() => image.evaluate((img: HTMLImageElement) => (img.complete ? img.naturalWidth : 0))).toBeGreaterThan(0);

const openOwner = () => postgres(readWorld().ownerUrl, { max: 1, onnotice: () => undefined });

export type StoredImageRow = { content_type: string; byte_size: number; sha256: string };

/** The stored row of an equipment's image (without the bytes), or null. */
export async function storedImage(equipmentId: string): Promise<StoredImageRow | null> {
  const sql = openOwner();
  try {
    const rows = await sql<StoredImageRow[]>`select content_type, byte_size, sha256 from equipment_images where equipment_id = ${equipmentId}`;
    return rows[0] ?? null;
  } finally {
    await sql.end();
  }
}

/** The id of the active equipment with this internal code (codes are unique per test). */
export async function equipmentIdOf(code: string): Promise<string> {
  const sql = openOwner();
  try {
    const rows = await sql<{ id: string }[]>`select id from equipments where internal_code = ${code} and archived_at is null`;
    const id = rows[0]?.id;
    if (id === undefined) throw new Error(`No active equipment with code ${code}`);
    return id;
  } finally {
    await sql.end();
  }
}

export type EquipmentAudit = {
  action: string;
  reason: string | null;
  before: { imageHash?: string | null } | null;
  after: { imageHash?: string | null } | null;
};

/** The create and update audit entries of an equipment, oldest first. */
export async function equipmentAudit(equipmentId: string): Promise<EquipmentAudit[]> {
  const sql = openOwner();
  try {
    return await sql<EquipmentAudit[]>`
      select action, reason, before, after from audit_log
      where entity_id = ${equipmentId} and action in ('fleet.equipment.create', 'fleet.equipment.update') order by id`;
  } finally {
    await sql.end();
  }
}

/** A request context signed in as `role`, or with no session at all. Dispose it when done. */
export function requestAs(api: APIRequest, role: RoleKey | null): Promise<APIRequestContext> {
  const storageState = role === null ? { cookies: [], origins: [] } : storageStatePath(role);
  return api.newContext({ baseURL: BASE_URL, storageState });
}

export const imagePath = (equipmentId: string): string => `/fleet/equipment/${equipmentId}/image`;
