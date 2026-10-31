/**
 * Steps and checks shared by the replacement and detail-page action suites: open the detail page,
 * fill and submit the replace dialog like a person does, read the page back, and read the stored
 * rows and audit entries through an owner connection (the same one `data.ts` uses).
 */
import { expect, type Browser, type Locator, type Page } from "@playwright/test";
import postgres, { type Sql } from "postgres";
import { copy } from "../../app/_lib/copy";
import { openSeeder } from "./data";
import { buttonNamed, buttonsOf, titleOf } from "./detail-page";
import { fill, openDialog, skipBrowserValidation, submitDialog } from "./fleet-flows";
import { BASE_URL, readWorld, storageStatePath, type RoleKey } from "./world";

const t = copy.fleet.detail;
const r = copy.dialogs.replaceEquipment;

/** Fixed days (never "today") keep the assertions stable: the assignment starts long before the replacement. */
export const DAYS = { start: "2026-01-05", replace: "2026-06-15", before: "2026-06-14" } as const;
/** The same days as the screen shows them. */
export const SHOWN = { start: "05/01/2026", replace: "15/06/2026", before: "14/06/2026" } as const;

export const detailPath = (id: string, tab = ""): string => `/fleet/equipment/${id}${tab === "" ? "" : `?tab=${tab}`}`;

export async function gotoDetail(page: Page, id: string, code: string, tab = ""): Promise<void> {
  await page.goto(detailPath(id, tab));
  await expect(page.getByRole("heading", { level: 1, name: titleOf(code) })).toBeVisible();
}

export { buttonNamed, buttonsOf, infoCard, locationCard, menuOf } from "./detail-page";
export const pillOf = (page: Page): Locator => page.locator(".title-row .badge");
export const historyTable = (page: Page): Locator => page.getByRole("table", { name: t.history.caption });
export const historyRows = (page: Page): Locator => historyTable(page).locator("tbody tr");

/** The value beside a label of a card (definition list). */
export const valueOf = (card: Locator, label: string): Locator =>
  card.locator("div.detail-row").filter({ has: card.page().getByText(label, { exact: true }) }).locator("dd");

export const ALL_BUTTONS = {
  assign: copy.dialogs.assignEquipment.trigger,
  move: copy.dialogs.moveEquipment.trigger,
  replace: r.trigger,
  end: copy.dialogs.endAssignment.trigger,
  edit: copy.dialogs.editEquipment.trigger,
  archive: copy.dialogs.archive.trigger,
  restore: copy.dialogs.restore.trigger,
} as const;

export type ButtonKey = keyof typeof ALL_BUTTONS;

/** Exactly these header buttons show (the others are absent). */
export async function expectButtons(page: Page, shown: readonly ButtonKey[]): Promise<void> {
  for (const [key, name] of Object.entries(ALL_BUTTONS)) {
    const wanted = shown.includes(key as ButtonKey);
    await expect(buttonNamed(page, name), `${name} ${wanted ? "shows" : "is hidden"}`).toHaveCount(wanted ? 1 : 0);
  }
}

export type ReplaceWorld = {
  readonly outgoing: string;
  readonly incoming: string;
  readonly busy: string;
  readonly gone: string;
  readonly otherOperation: string;
  /** The site of `otherOperation`. */
  readonly otherSite: string;
  readonly codes: { readonly outgoing: string; readonly incoming: string; readonly busy: string; readonly gone: string };
};

/**
 * OUT-<tag> active in the world's operation since 2026-01-05; IN-<tag> free; BUSY-<tag> assigned in
 * another operation; GONE-<tag> archived. All of one asset type, so the incoming option reads `IN-<tag> - FORKLIFT`.
 */
export async function seedReplaceWorld(tag: string): Promise<ReplaceWorld> {
  const seeder = await openSeeder();
  try {
    const world = readWorld().ids;
    const supplier = await seeder.supplier(`Replace rental ${tag}`);
    const forklift = await seeder.assetType("Forklift");
    const site = await seeder.site(`Replace site ${tag}`);
    const otherOperation = await seeder.operation({ division: world.division, site, name: `Replace op ${tag}`, costCenter: "7301" });
    const unit = (internalCode: string) => seeder.equipment({ supplierId: supplier, assetTypeId: forklift, internalCode });
    const key = tag.toUpperCase();
    const codes = { outgoing: `OUT-${key}`, incoming: `IN-${key}`, busy: `BUSY-${key}`, gone: `GONE-${key}` };
    const outgoing = await unit(codes.outgoing);
    await seeder.assign({ equipmentId: outgoing, operationId: world.operation, day: DAYS.start, reason: "Loaded late" });
    const busy = await unit(codes.busy);
    await seeder.assign({ equipmentId: busy, operationId: otherOperation, day: DAYS.start, reason: "Loaded late" });
    const gone = await unit(codes.gone);
    await seeder.archiveEquipment(gone, "Loaded by mistake");
    return { outgoing, incoming: await unit(codes.incoming), busy, gone, otherOperation, otherSite: site, codes };
  } finally {
    await seeder.close();
  }
}

export type ReplaceValues = {
  /** The code of the incoming equipment; its option reads `<code> - FORKLIFT`. */
  incoming?: string;
  day?: string;
  outgoing?: "spare" | "retire";
  reason?: string;
};

export const outgoingGroup = (dialog: Locator): Locator => dialog.getByRole("group", { name: r.outgoingLegend });

/** Fills only the fields that are given. */
export async function fillReplace(dialog: Locator, v: ReplaceValues): Promise<void> {
  if (v.incoming !== undefined) await dialog.getByLabel(r.incomingLabel, { exact: true }).selectOption({ label: `${v.incoming} - FORKLIFT` });
  if (v.day !== undefined) await fill(dialog, r.dayLabel, v.day);
  if (v.outgoing !== undefined) {
    const label = v.outgoing === "spare" ? r.outgoingSpare : r.outgoingRetire;
    await outgoingGroup(dialog).getByRole("radio", { name: label }).check();
  }
  if (v.reason !== undefined) await fill(dialog, copy.common.reason, v.reason);
}

export const submitReplace = (dialog: Locator): Promise<void> => submitDialog(dialog, r.submit);

/** Opens the replace dialog on the outgoing equipment's page, fills it and submits; the browser checks are off when asked. */
export async function replaceVia(page: Page, values: ReplaceValues, options: { serverOnly?: boolean } = {}): Promise<Locator> {
  const dialog = await openDialog(page, r.trigger, buttonsOf(page));
  if (options.serverOnly === true) await skipBrowserValidation(dialog);
  await fillReplace(dialog, values);
  await submitReplace(dialog);
  return dialog;
}

/** The page of another role, in its own browser context. The caller closes the returned context. */
export async function pageAs(browser: Browser, role: RoleKey): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ baseURL: BASE_URL, storageState: storageStatePath(role) });
  return { page: await context.newPage(), close: () => context.close() };
}

// ---- stored rows and audit entries (owner connection) ----

async function withOwner<T>(run: (sql: Sql) => Promise<T>): Promise<T> {
  const sql = postgres(readWorld().ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    return await run(sql);
  } finally {
    await sql.end();
  }
}

export type StoredAssignment = {
  readonly kind: string;
  readonly from: string;
  readonly to: string | null;
  /** Null for a muleto: a spare belongs to a site (ADR-0013). */
  readonly operationId: string | null;
  readonly siteId: string;
  readonly reason: string | null;
};

/** Every assignment row of an equipment, oldest first, with the days as `YYYY-MM-DD` text. */
export const storedAssignments = (equipmentId: string): Promise<StoredAssignment[]> =>
  withOwner(async (sql) => {
    const rows = await sql<{ kind: string; from: string; to: string | null; operation_id: string | null; site_id: string; reason: string | null }[]>`
      select kind, valid_from::text as "from", valid_to::text as "to", operation_id, site_id, reason
      from equipment_assignments where equipment_id = ${equipmentId} order by valid_from, created_at`;
    return rows.map((row) => ({ kind: row.kind, from: row.from, to: row.to, operationId: row.operation_id, siteId: row.site_id, reason: row.reason }));
  });

export const isStoredArchived = (equipmentId: string): Promise<boolean> =>
  withOwner(async (sql) => {
    const rows = await sql<{ archived: boolean }[]>`select archived_at is not null as archived from equipments where id = ${equipmentId}`;
    return rows[0]?.archived ?? false;
  });

export type AuditEntry = {
  readonly action: string;
  readonly role: string;
  readonly reason: string | null;
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown> | null;
};

const toEntry = (row: AuditEntry): AuditEntry => ({ action: row.action, role: row.role, reason: row.reason, before: row.before, after: row.after });

/** The replace entries whose OUTGOING equipment is this one (`before` is its open assignment). */
export const replaceEntries = (outgoingId: string): Promise<AuditEntry[]> =>
  withOwner(async (sql) => {
    const rows = await sql<AuditEntry[]>`
      select action, role, reason, before, after from audit_log
      where action = 'fleet.assignment.replace' and before->>'equipmentId' = ${outgoingId} order by id`;
    return rows.map(toEntry);
  });

/** The entries of one action about one equipment (`entity_id` is the equipment for the catalog actions). */
export const catalogEntries = (action: string, equipmentId: string): Promise<AuditEntry[]> =>
  withOwner(async (sql) => {
    const rows = await sql<AuditEntry[]>`
      select action, role, reason, before, after from audit_log
      where action = ${action} and entity_id = ${equipmentId} order by id`;
    return rows.map(toEntry);
  });
