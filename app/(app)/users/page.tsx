import { requirePermission, type ActorContext } from "../../../src/identity/application/actor-context";
import { toActor } from "../../../src/identity/application/actor-mapper";
import { getContainer } from "../../../src/shared/infrastructure/container";
import { canReadCatalog } from "../../_lib/catalog-access";
import { copy } from "../../_lib/copy";
import { requireActor } from "../../_lib/session";
import { buildScopeOptions, EMPTY_SCOPE_OPTIONS, type ScopeOptions } from "../../_lib/user-scope";
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

/** The divisions and operations the actor may read; without catalog access only the company scope is offered. */
async function loadScopeOptions(context: ActorContext): Promise<ScopeOptions> {
  if (!canReadCatalog(context)) return EMPTY_SCOPE_OPTIONS;
  const { organization } = getContainer();
  const actor = toActor(context);
  const [units, operations] = await Promise.all([
    organization.listBusinessUnits.execute({ actor }),
    organization.listOperations.execute({ actor }),
  ]);
  if (units.ok && operations.ok) return buildScopeOptions(units.value, operations.value);
  const failed = [units, operations].flatMap((result) => (result.ok ? [] : [result.error.code]));
  console.error("Scope options unavailable", failed.join(","));
  return EMPTY_SCOPE_OPTIONS;
}

function Header({ canCreate, options }: { canCreate: boolean; options: ScopeOptions }) {
  return (
    <header className="page-head">
      <div>
        <h1>{copy.users.title}</h1>
        <p className="page-sub">{copy.users.subtitle}</p>
      </div>
      {canCreate && <NewUserDialog options={options} />}
    </header>
  );
}

export default async function UsersPage() {
  const actor = await requireActor();
  if (!requirePermission(actor, "user.read").ok) return <Restricted />;
  const listed = await getContainer().identity.listUsers.execute({ actor });
  if (!listed.ok) return <Restricted />;
  const options = await loadScopeOptions(actor);
  return (
    <>
      <Header canCreate={requirePermission(actor, "user.create").ok} options={options} />
      <UserTable users={listed.value} selfId={actor.user.id} options={options}
        canAssign={requirePermission(actor, "role.assign").ok}
        canDeactivate={requirePermission(actor, "user.deactivate").ok} />
    </>
  );
}
