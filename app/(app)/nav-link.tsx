"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavIcon } from "../_components/icons";
import { isCurrent, type NavItem } from "../_lib/navigation";

/** A sidebar link with its icon that marks itself as the current page. */
export function NavLink({ item }: { readonly item: NavItem }) {
  const pathname = usePathname();
  const current = isCurrent(item.href, pathname);
  return (
    <Link href={item.href} className="nav-item" aria-current={current ? "page" : undefined}>
      <NavIcon name={item.icon} />
      <span>{item.label}</span>
    </Link>
  );
}
