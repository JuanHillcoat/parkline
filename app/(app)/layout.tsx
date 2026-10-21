import type { ReactNode } from "react";
import { copy } from "../_lib/copy";
import { initialsOf } from "../_lib/navigation";
import { requireActor } from "../_lib/session";
import { AccountMenu } from "./account-menu";
import { ShellFrame } from "./mobile-nav";
import { SidebarContent, roleLine } from "./sidebar";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const actor = await requireActor();
  const { displayName } = actor.user;
  const account = <AccountMenu name={displayName} role={roleLine(actor)} initials={initialsOf(displayName)} />;
  return (
    <>
      <a className="skip-link" href="#content">{copy.nav.skipToContent}</a>
      <ShellFrame sidebar={<SidebarContent actor={actor} />} account={account}>
        {children}
      </ShellFrame>
    </>
  );
}
