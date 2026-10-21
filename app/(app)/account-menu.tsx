"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { ChevronDownIcon, LogoutIcon } from "../_components/icons";
import { copy } from "../_lib/copy";
import { signOutAction } from "./actions";

type AccountMenuProps = { readonly name: string; readonly role: string; readonly initials: string };

/** Closes the popup on Escape or on a click outside of it. */
function useDismiss(open: boolean, close: () => void, root: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onClick = (e: MouseEvent) => {
      if (e.target instanceof Node && root.current?.contains(e.target) === false) close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open, close, root]);
}

type TriggerProps = AccountMenuProps & { readonly open: boolean; readonly onToggle: () => void };

function Trigger({ name, role, initials, open, onToggle }: TriggerProps) {
  return (
    <button
      type="button"
      className="account-trigger"
      aria-expanded={open}
      aria-haspopup="true"
      aria-label={copy.nav.accountMenu}
      onClick={onToggle}
    >
      <span className="avatar" aria-hidden="true">{initials}</span>
      <span className="account-text account-text-top">
        <span className="account-name">{name}</span>
        <span className="account-role">{role}</span>
      </span>
      <ChevronDownIcon />
    </button>
  );
}

function Popup({ name, role }: { readonly name: string; readonly role: string }) {
  return (
    <div className="popover" role="group" aria-label={copy.nav.accountMenu}>
      <p className="account-name">{name}</p>
      <p className="account-role">{role}</p>
      <form action={signOutAction}>
        <button type="submit" className="btn btn-block popover-action">
          <LogoutIcon />
          {copy.nav.signOut}
        </button>
      </form>
    </div>
  );
}

/** Avatar button in the top bar that opens the account popup with the sign-out action. */
export function AccountMenu(props: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const close = () => {
    setOpen(false);
  };
  useDismiss(open, close, root);
  return (
    <div className="account-menu" ref={root}>
      <Trigger {...props} open={open} onToggle={() => { setOpen(!open); }} />
      {open && <Popup name={props.name} role={props.role} />}
    </div>
  );
}
