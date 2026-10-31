import type { ReactNode, RefObject } from "react";
import { MenuIcon } from "../_components/icons";
import { copy } from "../_lib/copy";
import type { BackLink } from "../_lib/navigation";

type TopbarProps = {
  readonly title: string;
  /** The way back to the list, shown at the left end in place of the title on a detail page. */
  readonly back: BackLink | null;
  readonly drawerOpen: boolean;
  readonly onMenu: () => void;
  readonly menuRef: RefObject<HTMLButtonElement | null>;
  readonly children: ReactNode;
};

/** Bar above the content: drawer button (narrow widths), section title (or, on a detail page, the way back) and account menu. */
export function Topbar({ title, back, drawerOpen, onMenu, menuRef, children }: TopbarProps) {
  return (
    <header className="topbar">
      <button
        type="button"
        ref={menuRef}
        className="icon-btn menu-btn"
        aria-label={copy.nav.openMenu}
        aria-expanded={drawerOpen}
        aria-controls="app-sidebar"
        onClick={onMenu}
      >
        <MenuIcon />
      </button>
      {back === null ? <p className="topbar-title">{title}</p> : <a className="back-link topbar-back" href={back.href}>{back.label}</a>}
      {children}
    </header>
  );
}
