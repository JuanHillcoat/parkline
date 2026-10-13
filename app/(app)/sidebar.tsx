import { requirePermission, type ActorContext } from "../../src/identity/application/actor-context";
import { ROLE_LABELS } from "../_lib/messages";
import { signOutAction } from "./actions";
import { NavLink } from "./nav-link";

const COMING_SOON = ["Equipment", "Repair orders", "Hour readings", "Invoices", "Reports"];

function SoonItem({ label }: { label: string }) {
  return (
    <li>
      <span className="nav-item" aria-disabled="true">
        {label}
        <span className="nav-tag">Soon</span>
      </span>
    </li>
  );
}

function Account({ actor }: { actor: ActorContext }) {
  const roles = actor.assignments.map((a) => ROLE_LABELS[a.role]);
  return (
    <div className="account">
      <p className="account-name">{actor.user.displayName}</p>
      <p className="account-role">{roles.join(", ") || "No role"}</p>
      <form action={signOutAction}>
        <button type="submit" className="btn signout">Sign out</button>
      </form>
    </div>
  );
}

function Administration() {
  return (
    <>
      <p className="nav-heading">Administration</p>
      <ul className="nav"><li><NavLink href="/users">Users</NavLink></li></ul>
    </>
  );
}

export function Sidebar({ actor }: { actor: ActorContext }) {
  const canReadUsers = requirePermission(actor, "user.read").ok;
  return (
    <aside className="sidebar">
      <p className="brand">Parkline</p>
      <nav aria-label="Main">
        <ul className="nav">
          <li><NavLink href="/">Home</NavLink></li>
          {COMING_SOON.map((label) => <SoonItem key={label} label={label} />)}
        </ul>
        {canReadUsers && <Administration />}
      </nav>
      <Account actor={actor} />
    </aside>
  );
}
