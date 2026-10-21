import { copy } from "./copy";

export type IconName = "home" | "fleet" | "users" | "organization";

export type NavItem = { readonly href: string; readonly label: string; readonly icon: IconName };
export type NavSection = { readonly label: string; readonly items: readonly NavItem[] };
export type NavAccess = { readonly fleet: boolean; readonly users: boolean; readonly organization: boolean };

const HOME: NavItem = { href: "/", label: copy.nav.home, icon: "home" };
const FLEET: NavItem = { href: "/fleet", label: copy.nav.fleet, icon: "fleet" };
const USERS: NavItem = { href: "/users", label: copy.nav.users, icon: "users" };
const ORGANIZATION: NavItem = { href: "/organization", label: copy.nav.organization, icon: "organization" };

const ALL_ITEMS: readonly NavItem[] = [HOME, FLEET, USERS, ORGANIZATION];

/** Menu sections for what the actor may open. An entry exists only when its screen does. */
export function navigationFor(access: NavAccess): readonly NavSection[] {
  const main = [HOME, ...(access.fleet ? [FLEET] : [])];
  const admin = [...(access.users ? [USERS] : []), ...(access.organization ? [ORGANIZATION] : [])];
  const sections: NavSection[] = [{ label: copy.nav.main, items: main }];
  if (admin.length > 0) sections.push({ label: copy.nav.administration, items: admin });
  return sections;
}

/** Whether `href` is the page shown at `pathname` (home matches only exactly). */
export function isCurrent(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Title of the section being shown, derived from the pathname. */
export function sectionTitle(pathname: string): string {
  const item = ALL_ITEMS.find((candidate) => isCurrent(candidate.href, pathname));
  return item?.label ?? copy.common.productName;
}

/** Up to two uppercase initials of a display name, for the avatar. */
export function initialsOf(displayName: string): string {
  const words = displayName.split(/\s+/).filter((word) => word !== "");
  const letters = [words[0], words.length > 1 ? words[words.length - 1] : undefined];
  return letters.map((word) => word?.charAt(0) ?? "").join("").toUpperCase() || "?";
}
