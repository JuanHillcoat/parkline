/**
 * Page objects and database readers for the equipment assignment flows (`/fleet/equipment/<id>`):
 * open each dialog, fill it, submit it with the browser's own checks off (the server rules are the
 * ones under test) and read back what was stored. The readers connect as the owner of the
 * ephemeral database, like the seeders do.
 */
import { expect, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { copy } from "../../app/_lib/copy";
import { openSeeder } from "./data";
import { openDialog, skipBrowserValidation, submitDialog } from "./fleet-flows";
import { readWorld } from "./world";

export const t = copy.fleet.detail;
export const d = copy.dialogs;
export const messages = copy.errors.byCode;

/** The operations of a fixture; both belong to the world's division and site. */
export const OP_A = "ASG OP A";
export const OP_B = "ASG OP B";

export const today = (): string => new Date().toISOString().slice(0, 10);

export type Fixture = {
  readonly equipment: Readonly<Record<string, string>>;
  readonly opA: string;
  readonly opB: string;
};

/** One supplier, one asset type, the operations OP_A and OP_B and one equipment per code. */
export async function seedFixture(codes: readonly string[]): Promise<Fixture> {
  const seeder = await openSeeder();
  try {
    const world = readWorld().ids;
    const supplierId = await seeder.supplier("Asg supplier");
    const assetTypeId = await seeder.assetType("Asg type");
    const opA = await seeder.operation({ division: world.division, site: world.site, name: OP_A, costCenter: "7301" });
    const opB = await seeder.operation({ division: world.division, site: world.site, name: OP_B, costCenter: "7302" });
    const equipment: Record<string, string> = {};
    for (const code of codes) equipment[code] = await seeder.equipment({ supplierId, assetTypeId, internalCode: code });
    return { equipment, opA, opB };
  } finally {
    await seeder.close();
  }
}

/** Runs seeding steps with the application use cases (assign, move, end, archive). */
export async function withSeeder(run: (seeder: Awaited<ReturnType<typeof openSeeder>>) => Promise<void>): Promise<void> {
  const seeder = await openSeeder();
  try {
    await run(seeder);
  } finally {
    await seeder.close();
  }
}

/** The id of a seeded equipment; a code that was never seeded fails here, with its name, not later as a timeout. */
export const idOf = (fixture: Fixture, code: string): string => {
  const id = fixture.equipment[code];
  if (id === undefined) throw new Error(`Unknown fixture code ${code}: it was not seeded by this test`);
  return id;
};

export async function gotoDetail(page: Page, id: string, code: string, tab = ""): Promise<void> {
  await page.goto(`/fleet/equipment/${id}${tab === "" ? "" : `?tab=${tab}`}`);
  await expect(page.getByRole("heading", { level: 1, name: t.title(code) })).toBeVisible();
}

export const buttonsOf = (page: Page): Locator => page.getByRole("group", { name: t.actionsLabel });
export const buttonNamed = (page: Page, name: string): Locator => buttonsOf(page).getByRole("button", { name, exact: true });
export const pillOf = (page: Page): Locator => page.locator(".title-row .badge");
export const historyRows = (page: Page): Locator => page.getByRole("table", { name: t.history.caption }).locator("tbody tr");
export const locationCard = (page: Page): Locator => page.getByRole("region", { name: t.location.title });

/** The value beside a label of a card (definition list). */
export const valueOf = (card: Locator, label: string): Locator =>
  card.locator("div.detail-row").filter({ has: card.page().getByText(label, { exact: true }) }).locator("dd");

/** The alert of a dialog that failed. */
export const alertOf = (dialog: Locator): Locator => dialog.getByRole("alert");

/** Where an equipment goes in a dialog: an operation, or a site as a muleto (a spare belongs to a site). */
export type PlaceValues = { operation?: string; site?: string };

const MULETO = d.placement.muleto;

/** Chooses the place: an operation by name, or Muleto and then its Site; nothing given touches nothing. */
export async function setPlace(dialog: Locator, label: string, v: PlaceValues): Promise<void> {
  if (v.operation !== undefined) await dialog.getByLabel(label, { exact: true }).selectOption({ label: v.operation });
  if (v.site === undefined) return;
  await dialog.getByLabel(label, { exact: true }).selectOption({ label: MULETO });
  await dialog.getByLabel(d.placement.siteLabel, { exact: true }).selectOption({ label: v.site });
}

async function setText(dialog: Locator, label: string, value: string | undefined): Promise<void> {
  if (value !== undefined) await dialog.getByLabel(label, { exact: true }).fill(value);
}

/** Opens a dialog from the header buttons, fills it and submits it; the caller reads the outcome. */
async function submitHeaderDialog(page: Page, trigger: string, submit: string, fill: (dialog: Locator) => Promise<void>): Promise<Locator> {
  const dialog = await openDialog(page, trigger, buttonsOf(page));
  await skipBrowserValidation(dialog);
  await fill(dialog);
  await submitDialog(dialog, submit);
  return dialog;
}

export type AssignValues = PlaceValues & { day?: string; reason?: string };

export function submitAssign(page: Page, v: AssignValues): Promise<Locator> {
  const a = d.assignEquipment;
  return submitHeaderDialog(page, a.trigger, a.submit, async (dialog) => {
    await setPlace(dialog, a.operationLabel, v);
    await setText(dialog, a.dayLabel, v.day);
    await setText(dialog, a.reasonLabel, v.reason);
  });
}

export type MoveValues = PlaceValues & { day?: string; reason?: string };

export function submitMove(page: Page, v: MoveValues): Promise<Locator> {
  const m = d.moveEquipment;
  return submitHeaderDialog(page, m.trigger, m.submit, async (dialog) => {
    await setPlace(dialog, m.operationLabel, v);
    await setText(dialog, m.dayLabel, v.day);
    await setText(dialog, copy.common.reason, v.reason);
  });
}

export type EndValues = { day?: string; reason?: string };

export function submitEnd(page: Page, v: EndValues): Promise<Locator> {
  const e = d.endAssignment;
  return submitHeaderDialog(page, e.trigger, e.submit, async (dialog) => {
    await setText(dialog, e.dayLabel, v.day);
    await setText(dialog, copy.common.reason, v.reason);
  });
}

export type CorrectValues = PlaceValues & { from?: string; to?: string; reason?: string };

/** Fills the correction dialog of a history row; empty strings clear a date. */
export async function fillCorrection(dialog: Locator, v: CorrectValues): Promise<void> {
  const c = d.correctAssignment;
  await setText(dialog, c.fromLabel, v.from);
  await setText(dialog, c.toLabel, v.to);
  await setPlace(dialog, c.operationLabel, v);
  await setText(dialog, copy.common.reason, v.reason);
}

/** Opens the Corregir dialog of the nth history row (0 is the newest) with the browser checks off. */
export async function openCorrection(page: Page, row: number): Promise<Locator> {
  const dialog = await openDialog(page, d.correctAssignment.trigger, historyRows(page).nth(row));
  await skipBrowserValidation(dialog);
  return dialog;
}

export async function submitCorrection(page: Page, row: number, v: CorrectValues): Promise<Locator> {
  const dialog = await openCorrection(page, row);
  await fillCorrection(dialog, v);
  await submitDialog(dialog, d.correctAssignment.submit);
  return dialog;
}

export type StoredAssignment = {
  readonly valid_from: string;
  readonly valid_to: string | null;
  readonly kind: string;
  /** Null for a spare of a site (ADR-0013). */
  readonly operation_id: string | null;
  readonly site_id: string;
  readonly reason: string | null;
};

const openOwner = () => postgres(readWorld().ownerUrl, { max: 1, onnotice: () => undefined });

/** The stored rows of an equipment, oldest first, with the days as YYYY-MM-DD text. */
export async function storedAssignments(equipmentId: string): Promise<StoredAssignment[]> {
  const sql = openOwner();
  try {
    return await sql<StoredAssignment[]>`
      select to_char(valid_from, 'YYYY-MM-DD') as valid_from, to_char(valid_to, 'YYYY-MM-DD') as valid_to,
             kind, operation_id, site_id, reason
      from equipment_assignments where equipment_id = ${equipmentId} order by equipment_assignments.valid_from`;
  } finally {
    await sql.end();
  }
}

export type AuditRow = {
  readonly action: string;
  readonly entity_type: string;
  readonly entity_id: string;
  readonly role: string;
  readonly reason: string | null;
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown> | null;
};

/** The assignment audit entries of an equipment, oldest first. The append-only log survives resets. */
export async function assignmentAudit(equipmentId: string): Promise<AuditRow[]> {
  const sql = openOwner();
  try {
    return await sql<AuditRow[]>`
      select action, entity_type, entity_id, role, reason, before, after
      from audit_log where subject_equipment_id = ${equipmentId} and action like 'fleet.assignment.%' order by id`;
  } finally {
    await sql.end();
  }
}

/** Marks an operation as archived straight in the database (the seeder's actor cannot archive). */
export async function archiveOperationAsOwner(operationId: string): Promise<void> {
  const sql = openOwner();
  try {
    await sql`update operations set archived_at = now() where id = ${operationId}`;
  } finally {
    await sql.end();
  }
}
