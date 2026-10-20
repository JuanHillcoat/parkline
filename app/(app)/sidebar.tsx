import { requirePermission, type ActorContext } from "../../src/identity/application/actor-context";
import { canReadCatalog, canViewFleet } from "../_lib/catalog-access";
import { copy } from "../_lib/copy";
import { ROLE_LABELS } from "../_lib/messages";
import { signOutAction } from "./actions";
import { NavLink } from "./nav-link";

const COMING_SOON = copy.nav.comingSoon;

function SoonItem({ label }: { label: string }) {
  return (
    <li>
      <span className="nav-item" aria-disabled="true">
        {label}
        <span className="nav-tag">{copy.common.soon}</span>
      </span>
    </li>
  );
}

function Account({ actor }: { actor: ActorContext }) {
  const roles = actor.assignments.map((a) => ROLE_LABELS[a.role]);
  return (
    <div className="account">
      <p className="account-name">{actor.user.displayName}</p>
      <p className="account-role">{roles.join(", ") || copy.common.noRole}</p>
      <form action={signOutAction}>
        <button type="submit" className="btn signout">{copy.nav.signOut}</button>
      </form>
    </div>
  );
}

type AdministrationProps = { readonly users: boolean; readonly organization: boolean };

function Administration({ users, organization }: AdministrationProps) {
  return (
    <>
      <p className="nav-heading">{copy.nav.administration}</p>
      <ul className="nav">
        {users && <li><NavLink href="/users">{copy.nav.users}</NavLink></li>}
        {organization && <li><NavLink href="/organization">{copy.nav.organization}</NavLink></li>}
      </ul>
    </>
  );
}

export function Sidebar({ actor }: { actor: ActorContext }) {
  const canReadUsers = requirePermission(actor, "user.read").ok;
  const canReadOrganization = canReadCatalog(actor);
  return (
    <aside className="sidebar">
      <p className="brand">{copy.common.productName}</p>
      <nav aria-label={copy.nav.main}>
        <ul className="nav">
          <li><NavLink href="/">{copy.nav.home}</NavLink></li>
          {canViewFleet(actor) && <li><NavLink href="/fleet">{copy.nav.fleet}</NavLink></li>}
          {COMING_SOON.map((label) => <SoonItem key={label} label={label} />)}
        </ul>
        {(canReadUsers || canReadOrganization) && (
          <Administration users={canReadUsers} organization={canReadOrganization} />
        )}
      </nav>
      <Account actor={actor} />
    </aside>
  );
}
