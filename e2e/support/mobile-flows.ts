/**
 * Helpers for the mobile suite (400x608, touch). They measure what the user sees, with the
 * browser's own layout, so the tests state the rule ("40px tap target") and not the CSS.
 */
import { expect, type Locator, type Page } from "@playwright/test";
import { copy } from "../../app/_lib/copy";

export const VIEWPORT_WIDTH = 400;
export const VIEWPORT_HEIGHT = 608;
/** Smallest comfortable touch target in px: the app's own design bar (`.btn` is 42px, links 40px). WCAG 2.5.8 requires 24px, 2.5.5 suggests 44px. */
export const MIN_TAP_TARGET = 40;
/** Smallest text in px for values and labels in card mode (the app's design bar). */
export const MIN_TEXT_SIZE = 14;
/** Largest distance in px between a full-width control and the edge of its form: the card padding (16px) plus the border. */
export const EDGE_GAP_TOLERANCE = 24;

export type Box = { x: number; y: number; width: number; height: number };

export async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("The element has no layout box");
  return box;
}

/** Fails when the page itself scrolls sideways (the document is wider than the viewport). */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const widths = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
}

export const menuButton = (page: Page): Locator => page.getByRole("button", { name: copy.nav.openMenu });
export const drawerOf = (page: Page): Locator => page.locator("#app-sidebar");

export const drawerLinks = (page: Page): Locator =>
  drawerOf(page).getByRole("navigation", { name: copy.nav.main }).getByRole("link");

export async function openDrawer(page: Page): Promise<void> {
  await menuButton(page).tap();
  await expect(drawerOf(page)).toBeVisible();
  await expect(menuButton(page)).toHaveAttribute("aria-expanded", "true");
}

/** True when the element can receive keyboard focus (hidden elements cannot). */
export async function canTakeFocus(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => {
    (element as HTMLElement).focus();
    return document.activeElement === element;
  });
}

export type CardCell = { label: string; shownLabel: string; labelSize: number; valueSize: number };

/** For each labelled cell of a card: its `data-label`, the label really painted and both font sizes. */
export async function cardCells(row: Locator): Promise<CardCell[]> {
  return row.locator("td[data-label]").evaluateAll((cells) =>
    cells.map((cell) => ({
      label: cell.getAttribute("data-label") ?? "",
      shownLabel: getComputedStyle(cell, "::before").content,
      labelSize: parseFloat(getComputedStyle(cell, "::before").fontSize),
      valueSize: parseFloat(getComputedStyle(cell).fontSize),
    })),
  );
}

/** The row's cells as boxes in DOM order; the actions cell is always the last one. */
export async function cardLayout(row: Locator): Promise<{ others: Box[]; actions: Box }> {
  const boxes = await Promise.all((await row.locator("> th, > td").all()).map((cell) => boxOf(cell)));
  const actions = boxes[boxes.length - 1];
  if (actions === undefined) throw new Error("The row has no cells");
  return { others: boxes.slice(0, -1), actions };
}

/** Heights of every button and link-button inside the row, to check tap targets. */
export async function actionHeights(row: Locator): Promise<number[]> {
  const controls = await row.locator("td.cell-actions").getByRole("button").all();
  return Promise.all(controls.map(async (control) => (await boxOf(control)).height));
}

/** Horizontal position of `inner` relative to `outer`: how far each edge is from the other's. */
export async function edgeGaps(inner: Locator, outer: Locator): Promise<{ left: number; right: number }> {
  const [a, b] = [await boxOf(inner), await boxOf(outer)];
  return { left: a.x - b.x, right: b.x + b.width - (a.x + a.width) };
}
