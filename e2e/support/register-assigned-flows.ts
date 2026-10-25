/**
 * Steps for registering an equipment that is assigned to an operation in the same step (issue 50): the
 * optional "Asignación" group of the Nuevo equipo dialog, plus readers of what was stored.
 */
import { expect, type Locator, type Page } from "@playwright/test";
import postgres from "postgres";
import { copy } from "../../app/_lib/copy";
import { openSeeder } from "./data";
import { fillEquipment, gotoFleet, openDialog, REQUIRED_TEXT_DEFAULTS, seedBase, skipBrowserValidation, submitDialog } from "./fleet-flows";
import { readWorld } from "./world";

export const d = copy.dialogs;
export const OP_ONE = "REG OP ONE";
export const OP_TWO = "REG OP TWO";

export type Seeded = { readonly opOne: string; readonly opTwo: string };

/** One supplier, one asset type and two operations of the world's division and site. */
export async function seedRegisterFixture(): Promise<Seeded> {
  const seeder = await openSeeder();
  try {
    await seedBase(seeder, "Reg supplier", "Reg type");
    const { ids } = readWorld();
    const opOne = await seeder.operation({ division: ids.division, site: ids.site, name: OP_ONE, costCenter: "7401" });
    const opTwo = await seeder.operation({ division: ids.division, site: ids.site, name: OP_TWO, costCenter: "7402" });
    return { opOne, opTwo };
  } finally {
    await seeder.close();
  }
}

export type AssignmentChoice = { operation?: string; kind?: "active" | "spare"; day?: string; reason?: string };

const fieldOf = (dialog: Locator, label: string): Locator => dialog.getByLabel(label, { exact: true });

/** The group of the dialog that holds the optional assignment. */
export const groupOf = (dialog: Locator): Locator => dialog.getByRole("group", { name: d.newEquipment.assignmentLegend });

/** Fills only the assignment fields that are given. */
export async function fillAssignment(dialog: Locator, choice: AssignmentChoice): Promise<void> {
  const t = d.assignEquipment;
  if (choice.operation !== undefined) await fieldOf(dialog, t.operationLabel).selectOption({ label: choice.operation });
  if (choice.kind !== undefined) await fieldOf(dialog, t.kindLabel).selectOption(choice.kind);
  if (choice.day !== undefined) await fieldOf(dialog, t.dayLabel).fill(choice.day);
  if (choice.reason !== undefined) await fieldOf(dialog, t.reasonLabel).fill(choice.reason);
}

/** Opens the Nuevo equipo dialog on the board, with the browser's own checks off. */
export async function openNewEquipment(page: Page): Promise<Locator> {
  await gotoFleet(page, "equipment");
  const dialog = await openDialog(page, d.newEquipment.trigger);
  await skipBrowserValidation(dialog);
  return dialog;
}

/** Fills the equipment and its assignment choice in an open dialog and submits it. */
export async function fillAndSubmit(dialog: Locator, code: string, choice: AssignmentChoice): Promise<void> {
  await fillEquipment(dialog, { code, supplier: "REG SUPPLIER", assetType: "REG TYPE", ...REQUIRED_TEXT_DEFAULTS });
  await fillAssignment(dialog, choice);
  await submitDialog(dialog, d.newEquipment.submit);
}

/** Opens the dialog, registers a unit with the choice and returns the dialog so the caller reads the outcome. */
export async function registerWith(page: Page, code: string, choice: AssignmentChoice): Promise<Locator> {
  const dialog = await openNewEquipment(page);
  await fillAndSubmit(dialog, code, choice);
  return dialog;
}

const openOwner = () => postgres(readWorld().ownerUrl, { max: 1, onnotice: () => undefined });

/** The stored ids of the equipment with this internal code (none, or one). */
export async function equipmentIds(code: string): Promise<string[]> {
  const sql = openOwner();
  try {
    const rows = await sql<{ id: string }[]>`select id from equipments where internal_code = ${code.toUpperCase()}`;
    return rows.map((row) => row.id);
  } finally {
    await sql.end();
  }
}

/** The id of a registered equipment; fails with the code in the message when it is not there. */
export async function registeredId(code: string): Promise<string> {
  const [id] = await equipmentIds(code);
  if (id === undefined) throw new Error(`Equipment ${code} was not registered`);
  return id;
}

/** The audit actions written for one entity id, oldest first. */
export async function actionsFor(entityId: string): Promise<string[]> {
  const sql = openOwner();
  try {
    const rows = await sql<{ action: string }[]>`select action from audit_log where entity_id = ${entityId} order by id`;
    return rows.map((row) => row.action);
  } finally {
    await sql.end();
  }
}

/** The options of the Operación select, as the person reads them. */
export const operationOptions = (dialog: Locator): Locator => fieldOf(dialog, d.assignEquipment.operationLabel).locator("option");

export async function expectNothingRegistered(code: string): Promise<void> {
  expect(await equipmentIds(code)).toEqual([]);
}
