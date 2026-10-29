"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { NavIcon } from "../_components/icons";
import { isActive, type NavItem } from "../_lib/navigation";

/** A sidebar link with its icon that marks itself as the current page. */
export function NavLink({ item }: { readonly item: NavItem }) {
  const pathname = usePathname();
  const tab = useSearchParams().get("tab");
  const current = isActive(item, pathname, tab);
  return (
    <Link href={item.href} className="nav-item" aria-current={current ? "page" : undefined}>
      <NavIcon name={item.icon} />
      <span>{item.label}</span>
    </Link>
  );
}
