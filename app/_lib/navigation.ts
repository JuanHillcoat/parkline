import { copy } from "./copy";

export type IconName = "home" | "fleet" | "supplier" | "asset-type" | "users" | "organization";

/** The tabs of `/fleet` that have their own entry. The equipment tab is the default one. */
export type FleetNavTab = "equipment" | "suppliers" | "asset-types";

export type NavItem = {
  readonly href: string;
  readonly label: string;
  readonly icon: IconName;
  /** Set for the entries that are tabs of one page: the pathname alone cannot tell them apart. */
  readonly tab?: FleetNavTab;
};
export type NavSection = { readonly label: string; readonly items: readonly NavItem[] };
export type NavAccess = {
  readonly fleet: boolean;
  /** Suppliers and asset types are tenant-wide: only company-wide readers have their tabs. */
  readonly fleetCatalogs: boolean;
  readonly users: boolean;
  readonly organization: boolean;
};

const HOME: NavItem = { href: "/", label: copy.nav.home, icon: "home" };
const FLEET: NavItem = { href: "/fleet", label: copy.nav.fleet, icon: "fleet", tab: "equipment" };
const SUPPLIERS: NavItem = { href: "/fleet?tab=suppliers", label: copy.nav.suppliers, icon: "supplier", tab: "suppliers" };
const ASSET_TYPES: NavItem = { href: "/fleet?tab=asset-types", label: copy.nav.assetTypes, icon: "asset-type", tab: "asset-types" };
const USERS: NavItem = { href: "/users", label: copy.nav.users, icon: "users" };
const ORGANIZATION: NavItem = { href: "/organization", label: copy.nav.organization, icon: "organization" };

const ALL_ITEMS: readonly NavItem[] = [HOME, FLEET, SUPPLIERS, ASSET_TYPES, USERS, ORGANIZATION];

/** Menu sections for what the actor may open. An entry exists only when its screen does. */
export function navigationFor(access: NavAccess): readonly NavSection[] {
  const catalogs = access.fleet && access.fleetCatalogs ? [SUPPLIERS, ASSET_TYPES] : [];
  const main = [HOME, ...(access.fleet ? [FLEET] : []), ...catalogs];
  const admin = [...(access.users ? [USERS] : []), ...(access.organization ? [ORGANIZATION] : [])];
  const sections: NavSection[] = [{ label: copy.nav.main, items: main }];
  if (admin.length > 0) sections.push({ label: copy.nav.administration, items: admin });
  return sections;
}

/** Whether `href` is the page shown at `pathname` (home matches only exactly). */
export function isCurrent(href: string, pathname: string): boolean {
  const path = href.split("?")[0] ?? href;
  if (path === "/") return pathname === "/";
  return pathname === path || pathname.startsWith(`${path}/`);
}

const FLEET_TABS: readonly FleetNavTab[] = ["equipment", "suppliers", "asset-types"];

/** The fleet tab a `tab` query value selects; anything unknown is the equipment tab, like the page. */
export function fleetTabOf(raw: string | null): FleetNavTab {
  return FLEET_TABS.find((tab) => tab === raw) ?? "equipment";
}

/**
 * Whether the entry is the one being shown. Entries that are tabs of `/fleet` also read the `tab` query value;
 * only the list page has tabs, so every other page under `/fleet` (an equipment detail) belongs to "Flota".
 */
export function isActive(item: NavItem, pathname: string, tab: string | null): boolean {
  if (!isCurrent(item.href, pathname)) return false;
  if (item.tab === undefined) return true;
  const shown = pathname === "/fleet" ? fleetTabOf(tab) : "equipment";
  return item.tab === shown;
}

/** Title of the section being shown, derived from the pathname and the fleet tab. */
export function sectionTitle(pathname: string, tab: string | null = null): string {
  const item = ALL_ITEMS.find((candidate) => isActive(candidate, pathname, tab));
  return item?.label ?? copy.common.productName;
}

/** Up to two uppercase initials of a display name, for the avatar. */
export function initialsOf(displayName: string): string {
  const words = displayName.split(/\s+/).filter((word) => word !== "");
  const letters = [words[0], words.length > 1 ? words[words.length - 1] : undefined];
  return letters.map((word) => word?.charAt(0) ?? "").join("").toUpperCase() || "?";
}
