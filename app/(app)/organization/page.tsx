import { toActor } from "../../../src/identity/application/actor-mapper";
import { getContainer } from "../../../src/shared/infrastructure/container";
import { canReadCatalog } from "../../_lib/catalog-access";
import { copy } from "../../_lib/copy";
import { buildDivisionGroups, buildSiteRows, siteNamesById } from "../../_lib/organization-view";
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
  return <p className="card empty-note" role="status">{text}</p>;
}

/** Reads only through the list use cases, which already filter by the actor's scopes. */
async function loadStructure(actor: Actor) {
  const { organization } = getContainer();
  const [units, operations, sites] = await Promise.all([
    organization.listBusinessUnits.execute({ actor }),
    organization.listOperations.execute({ actor }),
    organization.listSites.execute({ actor }),
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

function Header({ data, canWrite }: { data: Data; canWrite: boolean }) {
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
      {needsFirstSteps && <p className="hint">{t.createFirst}</p>}
    </>
  );
}

function Structure({ data, canWrite }: { data: Data; canWrite: boolean }) {
  const groups = buildDivisionGroups(data.units, data.operations, siteNamesById(data.sites));
  const rows = buildSiteRows(data.sites, data.operations);
  return (
    <>
      <h2 className="section-title">{t.divisionsTitle}</h2>
      {groups.length === 0
        ? <Empty text={t.emptyDivisions} />
        : groups.map((group) => (
            <DivisionCard key={group.id ?? "hidden"} group={group} canWrite={canWrite}
              options={{ divisions: data.units, sites: data.sites }} />
          ))}
      <h2 className="section-title">{t.sitesTitle}</h2>
      {rows.length === 0 ? <Empty text={t.emptySites} /> : <SitesTable rows={rows} canWrite={canWrite} />}
    </>
  );
}

export default async function OrganizationPage() {
  const context = await requireActor();
  if (!canReadCatalog(context)) return <Restricted />;
  const actor = toActor(context);
  const data = await loadStructure(actor);
  if (data === null) return <Restricted />;
  const canWrite = getContainer().accessPolicy.check(actor, "catalog.write", { tenantId: actor.tenantId }).ok;
  return (
    <>
      <Header data={data} canWrite={canWrite} />
      <Structure data={data} canWrite={canWrite} />
    </>
  );
}
