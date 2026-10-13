import { requirePermission } from "../../../src/identity/application/actor-context";
import { getContainer } from "../../../src/shared/infrastructure/container";
import { requireActor } from "../../_lib/session";
import { NewUserDialog } from "./user-dialogs";
import { UserTable } from "./user-table";

export const metadata = { title: "Users - Parkline" };

function Restricted() {
  return (
    <section className="card" role="status">
      <h1>You do not have permission to manage users</h1>
      <p>Ask a system administrator if you need access to this page.</p>
    </section>
  );
}

function Header({ canCreate }: { canCreate: boolean }) {
  return (
    <header className="page-head">
      <div>
        <h1>Users</h1>
        <p className="page-sub">Who can sign in, and what they can do.</p>
      </div>
      {canCreate && <NewUserDialog />}
    </header>
  );
}

export default async function UsersPage() {
  const actor = await requireActor();
  if (!requirePermission(actor, "user.read").ok) return <Restricted />;
  const listed = await getContainer().identity.listUsers.execute({ actor });
  if (!listed.ok) return <Restricted />;
  return (
    <>
      <Header canCreate={requirePermission(actor, "user.create").ok} />
      <UserTable users={listed.value} selfId={actor.user.id}
        canAssign={requirePermission(actor, "role.assign").ok}
        canDeactivate={requirePermission(actor, "user.deactivate").ok} />
    </>
  );
}
