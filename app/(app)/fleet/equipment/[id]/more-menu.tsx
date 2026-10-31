"use client";

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";

type Props = { readonly label: string; readonly groupLabel: string; readonly children: ReactNode };

/** Closes the menu on a click outside it or on Escape. */
function useDismiss(open: boolean, close: () => void) {
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open, close]);
  return root;
}

/**
 * The "Más acciones" disclosure. The items (buttons that open dialogs) stay in the page while the menu is
 * closed, only hidden, so a dialog opened from an item keeps living inside it; choosing an item closes the menu.
 */
export function MoreMenu({ label, groupLabel, children }: Props) {
  const [open, setOpen] = useState(false);
  const root = useDismiss(open, () => { setOpen(false); });
  const choose = (event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button") !== null) setOpen(false);
  };
  return (
    <span className="more-menu" ref={root}>
      <button type="button" className="btn" aria-expanded={open} aria-controls="more-menu-panel" onClick={() => { setOpen(!open); }}>
        <span aria-hidden="true">⋮</span>
        {label}
        <span aria-hidden="true">▾</span>
      </button>
      <div id="more-menu-panel" className="more-menu-panel" role="group" aria-label={groupLabel} data-open={open} onClick={choose}>
        {children}
      </div>
    </span>
  );
}
