"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { CloseIcon } from "../_components/icons";
import { copy } from "../_lib/copy";
import { sectionTitle } from "../_lib/navigation";
import { Topbar } from "./topbar";

/** Calls `onEscape` on the Escape key while `active`. */
function useEscape(active: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onEscape();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
    };
  }, [active, onEscape]);
}

/** Drawer state tied to the page it was opened on, so navigating closes it. */
function useDrawer(pathname: string) {
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const open = openedAt === pathname;
  const close = useCallback(() => {
    setOpenedAt(null);
    menuRef.current?.focus();
  }, []);
  useEscape(open, close);
  const toggle = () => {
    if (open) close();
    else setOpenedAt(pathname);
  };
  return { open, close, menuRef, toggle };
}

type ShellFrameProps = { readonly sidebar: ReactNode; readonly account: ReactNode; readonly children: ReactNode };

/** A link to the page already open (only the query differs) keeps the pathname, so close on any link click. */
const closeOnLink = (close: () => void) => (event: MouseEvent<HTMLElement>) => {
  if (event.target instanceof Element && event.target.closest("a") !== null) close();
};

function Drawer({ close, children }: { readonly close: () => void; readonly children: ReactNode }) {
  return (
    <>
      <aside id="app-sidebar" className="sidebar" onClick={closeOnLink(close)}>
        <button type="button" className="icon-btn drawer-close" aria-label={copy.nav.closeMenu} onClick={close}>
          <CloseIcon />
        </button>
        {children}
      </aside>
      <div className="scrim" onClick={close} aria-hidden="true" />
    </>
  );
}

/** Page frame: sidebar (off-canvas drawer on narrow widths), top bar and content. */
export function ShellFrame({ sidebar, account, children }: ShellFrameProps) {
  const pathname = usePathname();
  const tab = useSearchParams().get("tab");
  const drawer = useDrawer(pathname);
  return (
    <div className="shell" data-nav-open={drawer.open}>
      <Drawer close={drawer.close}>{sidebar}</Drawer>
      <div className="main">
        <Topbar title={sectionTitle(pathname, tab)} drawerOpen={drawer.open} onMenu={drawer.toggle} menuRef={drawer.menuRef}>
          {account}
        </Topbar>
        <main id="content" className="content">{children}</main>
      </div>
    </div>
  );
}
