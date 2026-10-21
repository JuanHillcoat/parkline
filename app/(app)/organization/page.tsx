import { toActor } from "../../../src/identity/application/actor-mapper";
import { getContainer } from "../../../src/shared/infrastructure/container";
import { canReadCatalog } from "../../_lib/catalog-access";
import { copy } from "../../_lib/copy";
import {
  archivedToggleHref,
  buildDivisionGroups,
  buildSiteRows,
  type SiteRow,
  siteNamesById,
  wantsArchived,
} from "../../_lib/organization-view";
import { requireActor } from "../../_lib/session";
import { NewDivisionDialog, NewOperationDialog, NewSiteDialog } from "./organization-dialogs";
import { DivisionCard, SitesTable } from "./organization-tables";

export const metadata = { title: copy.organization.pageTitle };

const t = copy.organization;

type Actor = ReturnType<typeof toActor>;

function Restricted() {
  return (
    <section className="card" role="status">
      <h1>{t.restrictedTitle}</h1>
      <p>{t.restrictedText}</p>
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="empty-state" role="status"><p>{text}</p></div>;
}

/** Reads only through the list use cases, which already filter by the actor's scopes. */
async function loadStructure(actor: Actor, includeArchived: boolean) {
  const { organization } = getContainer();
  const [units, operations, sites] = await Promise.all([
    organization.listBusinessUnits.execute({ actor, includeArchived }),
    organization.listOperations.execute({ actor, includeArchived }),
    organization.listSites.execute({ actor, includeArchived }),
  ]);
  if (!units.ok || !operations.ok || !sites.ok) return null;
  return { units: units.value, operations: operations.value, sites: sites.value };
}

type Data = NonNullable<Awaited<ReturnType<typeof loadStructure>>>;

function Actions({ data }: { data: Data }) {
  const canCreateOperation = data.units.length > 0 && data.sites.length > 0;
  return (
    <span className="head-actions">
      <NewDivisionDialog />
      <NewSiteDialog />
      {canCreateOperation && <NewOperationDialog divisions={data.units} sites={data.sites} />}
    </span>
  );
}

function ArchivedToggle({ showing }: { showing: boolean }) {
  return (
    <div className="toolbar">
      <a className="btn" href={archivedToggleHref(showing)}>
        {showing ? t.hideArchived : t.showArchived}
      </a>
    </div>
  );
}

type Access = { readonly canWrite: boolean; readonly canArchive: boolean };

function Header({ data, canWrite, canArchive, showArchived }: Access & { data: Data; showArchived: boolean }) {
  const needsFirstSteps = canWrite && (data.units.length === 0 || data.sites.length === 0);
  return (
    <>
      <header className="page-head">
        <div>
          <h1>{t.title}</h1>
          <p className="page-sub">{t.subtitle}</p>
        </div>
        {canWrite && <Actions data={data} />}
      </header>
      {canArchive && <ArchivedToggle showing={showArchived} />}
      {needsFirstSteps && <p className="hint">{t.createFirst}</p>}
    </>
  );
}

function SitesSection({ rows, ...access }: Access & { rows: readonly SiteRow[] }) {
  return (
    <section className="card section-card">
      <header className="section-head">
        <h2>{t.sitesTitle}</h2>
        <span className="count-pill">{rows.length}</span>
      </header>
      {rows.length === 0 ? <Empty text={t.emptySites} /> : <SitesTable rows={rows} {...access} />}
    </section>
  );
}

function Structure({ data, ...access }: Access & { data: Data }) {
  const groups = buildDivisionGroups(data.units, data.operations, siteNamesById(data.sites));
  const rows = buildSiteRows(data.sites, data.operations);
  return (
    <>
      <h2 className="section-title">{t.divisionsTitle}</h2>
      {groups.length === 0
        ? <Empty text={t.emptyDivisions} />
        : groups.map((group) => (
            <DivisionCard key={group.id ?? "hidden"} group={group} {...access}
              options={{ divisions: data.units, sites: data.sites }} />
          ))}
      <SitesSection rows={rows} {...access} />
    </>
  );
}

type PageProps = { readonly searchParams: Promise<{ readonly archived?: string | readonly string[] }> };

export default async function OrganizationPage({ searchParams }: PageProps) {
  const context = await requireActor();
  if (!canReadCatalog(context)) return <Restricted />;
  const actor = toActor(context);
  const { accessPolicy } = getContainer();
  const position = { tenantId: actor.tenantId };
  const canArchive = accessPolicy.check(actor, "catalog.archive", position).ok;
  const showArchived = canArchive && wantsArchived((await searchParams).archived);
  const data = await loadStructure(actor, showArchived);
  if (data === null) return <Restricted />;
  const canWrite = accessPolicy.check(actor, "catalog.write", position).ok;
  return (
    <>
      <Header data={data} canWrite={canWrite} canArchive={canArchive} showArchived={showArchived} />
      <Structure data={data} canWrite={canWrite} canArchive={canArchive} />
    </>
  );
}
