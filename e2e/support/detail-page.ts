/**
 * Locators of the equipment detail page (`/fleet/equipment/<id>`) shared by the end-to-end suites: the title,
 * the "Más acciones" menu, the cards and the two places where an action button can live (the menu and the
 * location card).
 */
import type { Locator, Page } from "@playwright/test";
import { copy } from "../../app/_lib/copy";

const t = copy.fleet.detail;

/** The start of the title, enough to find the heading of one equipment whatever its asset type is. */
export const titleOf = (code: string): string => t.title(code, "").trim();

export const locationCard = (page: Page): Locator => page.getByRole("region", { name: t.location.title });
export const infoCard = (page: Page): Locator => page.getByRole("region", { name: t.info.title });
export const maintenanceCard = (page: Page): Locator => page.getByRole("region", { name: t.maintenance.title });
export const usageCard = (page: Page): Locator => page.getByRole("region", { name: t.usage.title });
export const observationsCard = (page: Page): Locator => page.getByRole("region", { name: t.observations.title });

/**
 * The items of the "Más acciones" menu; absent for an actor without any of them. A closed menu is `visibility:
 * hidden` (out of the accessibility tree) but its items are still in the page, so the lookup includes hidden ones.
 */
export const menuOf = (page: Page): Locator => page.getByRole("group", { name: t.actionsLabel, includeHidden: true });
export const moreToggle = (page: Page): Locator => page.getByRole("button", { name: t.moreActions, exact: true });

/** Every place an action button can live: the menu and the location card (Asignar, Cambiar operación / sitio). */
export const buttonsOf = (page: Page): Locator => menuOf(page).or(locationCard(page));
/** A trigger by name, hidden or not; the buttons inside the dialogs (a submit may share the name) are left out. */
export const buttonNamed = (page: Page, name: string): Locator =>
  buttonsOf(page).getByRole("button", { name, exact: true, includeHidden: true }).and(page.locator(":not(dialog *)"));

/** The header button that loads a reading. */
export const recordButton = (page: Page, unit: "hours" | "km" = "hours"): Locator =>
  page.locator(".page-head").getByRole("button", { name: unit === "km" ? copy.dialogs.recordReading.triggerKm : copy.dialogs.recordReading.trigger, exact: true });

/** Opens the menu when `item` is hidden inside it and the menu is closed; the click repeats until React has hydrated. */
export async function revealMenuItem(page: Page, item: Locator): Promise<void> {
  const toggle = moreToggle(page);
  if ((await toggle.count()) === 0 || !(await item.isHidden())) return;
  if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
}

/** The value beside a label of a card (a definition list row). */
export const rowValueOf = (card: Locator, label: string): Locator =>
  card.locator("div.detail-row").filter({ has: card.page().getByText(label, { exact: true }) }).locator("dd");

/** The hours (or km) accumulated in the cycle, inside the ring of the maintenance card. */
export const ringValue = (page: Page): Locator => maintenanceCard(page).locator(".ring-value");
