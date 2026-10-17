import { requirePermission } from "../../../src/identity/application/actor-context";
import { getContainer } from "../../../src/shared/infrastructure/container";
import { copy } from "../../_lib/copy";
import { requireActor } from "../../_lib/session";
import { NewUserDialog } from "./user-dialogs";
import { UserTable } from "./user-table";

export const metadata = { title: copy.users.pageTitle };

function Restricted() {
  return (
    <section className="card" role="status">
      <h1>{copy.users.restrictedTitle}</h1>
      <p>{copy.users.restrictedText}</p>
    </section>
  );
}

function Header({ canCreate }: { canCreate: boolean }) {
  return (
    <header className="page-head">
      <div>
        <h1>{copy.users.title}</h1>
        <p className="page-sub">{copy.users.subtitle}</p>
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
