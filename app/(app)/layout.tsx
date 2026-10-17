import type { ReactNode } from "react";
import { requireActor } from "../_lib/session";
import { Sidebar } from "./sidebar";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const actor = await requireActor();
  return (
    <div className="shell">
      <Sidebar actor={actor} />
      <main className="content">{children}</main>
    </div>
  );
}
