import { requirePermission, type ActorContext } from "../../src/identity/application/actor-context";
import { BrandMark } from "../_components/icons";
import { canReadCatalog, canViewFleet } from "../_lib/catalog-access";
import { copy } from "../_lib/copy";
import { ROLE_LABELS } from "../_lib/messages";
import { initialsOf, navigationFor, type NavSection } from "../_lib/navigation";
import { NavLink } from "./nav-link";

/** The roles of the actor as one display line. */
export function roleLine(actor: ActorContext): string {
  const roles = actor.assignments.map((a) => ROLE_LABELS[a.role]);
  return roles.join(", ") || copy.common.noRole;
}

function Section({ section }: { section: NavSection }) {
  return (
    <>
      <p className="nav-heading">{section.label}</p>
      <ul className="nav">
        {section.items.map((item) => (
          <li key={item.href}><NavLink item={item} /></li>
        ))}
      </ul>
    </>
  );
}

function Account({ actor }: { actor: ActorContext }) {
  return (
    <div className="account">
      <span className="avatar" aria-hidden="true">{initialsOf(actor.user.displayName)}</span>
      <div className="account-text">
        <p className="account-name">{actor.user.displayName}</p>
        <p className="account-role">{roleLine(actor)}</p>
      </div>
    </div>
  );
}

/** Sidebar content: the shell frame provides the surrounding `aside`. */
export function SidebarContent({ actor }: { actor: ActorContext }) {
  const sections = navigationFor({
    fleet: canViewFleet(actor),
    users: requirePermission(actor, "user.read").ok,
    organization: canReadCatalog(actor),
  });
  return (
    <>
      <p className="brand"><BrandMark /><span>{copy.common.productName}</span></p>
      <nav aria-label={copy.nav.main} className="sidebar-nav">
        {sections.map((section) => <Section key={section.label} section={section} />)}
      </nav>
      <Account actor={actor} />
    </>
  );
}
