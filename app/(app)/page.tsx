import type { ActorContext } from "../../src/identity/application/actor-context";
import { toActor } from "../../src/identity/application/actor-mapper";
import type { DomainError } from "../../src/shared/domain/domain-error";
import type { Result } from "../../src/shared/domain/result";
import { getContainer } from "../../src/shared/infrastructure/container";
import { canReadCatalog, canViewFleet } from "../_lib/catalog-access";
import { copy } from "../_lib/copy";
import { buildKpis, countActive, distribute, dropUnknowableCounts, hasNoData, type KpiKey } from "../_lib/dashboard-view";
import { requireActor } from "../_lib/session";
import { FirstSteps, KpiGrid } from "./dashboard-cards";
import { DistributionCard } from "./dashboard-distribution";
import "./dashboard.css";

export const metadata = { title: copy.home.pageTitle };

const t = copy.home;

type Actor = ReturnType<typeof toActor>;
type Named = { readonly id: string; readonly name: string; readonly archivedAt: Date | null };
type Lists = Partial<Record<KpiKey, readonly { readonly archivedAt: Date | null }[] | null>>;

/** A failed or forbidden list hides its card instead of breaking the page; the cause is only logged. */
async function read<T>(name: string, run: Promise<Result<readonly T[], DomainError>>): Promise<readonly T[] | null> {
  try {
    const result = await run;
    if (result.ok) return result.value;
    console.error("Dashboard list unavailable", name, result.error.code);
  } catch (error) {
    console.error("Dashboard list failed", name, error);
  }
  return null;
}

async function loadFleet(actor: Actor) {
  const { fleet } = getContainer();
  const [suppliers, assetTypes, equipment] = await Promise.all([
    read("suppliers", fleet.listSuppliers.execute({ actor })),
    read("assetTypes", fleet.listAssetTypes.execute({ actor })),
    read("equipment", fleet.listEquipment.execute({ actor })),
  ]);
  return { suppliers, assetTypes, equipment };
}

async function loadStructure(actor: Actor) {
  const { organization } = getContainer();
  const [divisions, operations, sites] = await Promise.all([
    read("divisions", organization.listBusinessUnits.execute({ actor })),
    read("operations", organization.listOperations.execute({ actor })),
    read("sites", organization.listSites.execute({ actor })),
  ]);
  return { divisions, operations, sites };
}

const namesOf = (rows: readonly Named[]): ReadonlyMap<string, string> =>
  new Map(rows.filter((row) => row.archivedAt === null).map((row) => [row.id, row.name]));

function countsOf(lists: Lists): Partial<Record<KpiKey, number>> {
  const counts: Partial<Record<KpiKey, number>> = {};
  for (const [key, rows] of Object.entries(lists) as [KpiKey, Lists[KpiKey]][]) {
    if (rows) counts[key] = countActive(rows);
  }
  return counts;
}

type Fleet = Awaited<ReturnType<typeof loadFleet>>;

function Distributions({ fleet }: { fleet: Fleet | null }) {
  if (!fleet?.equipment || !fleet.assetTypes || !fleet.suppliers) return null;
  const { equipment, assetTypes, suppliers } = fleet;
  const others = t.distribution.others;
  return (
    <div className="dist-grid">
      <DistributionCard
        id="dist-type"
        title={t.distribution.byAssetType}
        data={distribute(equipment, "assetTypeId", namesOf(assetTypes), others)}
      />
      <DistributionCard
        id="dist-supplier"
        title={t.distribution.bySupplier}
        data={distribute(equipment, "supplierId", namesOf(suppliers), others)}
      />
    </div>
  );
}

async function loadDashboard(context: ActorContext) {
  const actor = toActor(context);
  const showFleet = canViewFleet(context);
  const showStructure = canReadCatalog(context);
  const [fleet, structure] = await Promise.all([
    showFleet ? loadFleet(actor) : null,
    showStructure ? loadStructure(actor) : null,
  ]);
  const lists = { equipment: fleet?.equipment, suppliers: fleet?.suppliers, assetTypes: fleet?.assetTypes, ...structure };
  return { fleet, kpis: buildKpis(dropUnknowableCounts(countsOf(lists))), showFleet, showStructure };
}

export default async function HomePage() {
  const context = await requireActor();
  const { fleet, kpis, showFleet, showStructure } = await loadDashboard(context);
  return (
    <>
      <header className="page-head">
        <div>
          <h1>{t.greeting(context.user.displayName)}</h1>
          <p className="page-sub">{t.subtitle}</p>
        </div>
      </header>
      <KpiGrid kpis={kpis} />
      {hasNoData(kpis) && <FirstSteps organization={showStructure} fleet={showFleet} />}
      <Distributions fleet={fleet} />
    </>
  );
}
