import { copy } from "../../_lib/copy";
import { equipmentPrerequisites, fleetHref, type Option, type Prerequisite } from "../../_lib/fleet-view";

const t = copy.fleet.guidance;

const LABELS = {
  supplier: { done: t.supplierDone, missing: t.supplierMissing, action: t.createSupplier },
  assetType: { done: t.assetTypeDone, missing: t.assetTypeMissing, action: t.createAssetType },
} as const;

function Step({ item }: { item: Prerequisite }) {
  const labels = LABELS[item.kind];
  return (
    <li className="checklist-item" data-done={item.done}>
      <span className="checklist-mark" aria-hidden="true">{item.done ? "✓" : "○"}</span>
      <span className="checklist-label">
        {item.done ? labels.done : labels.missing}
        <span className="visually-hidden"> ({item.done ? t.done : t.missing})</span>
      </span>
      {!item.done && <a className="btn btn-primary" href={fleetHref({ tab: item.tab })}>{labels.action}</a>}
    </li>
  );
}

type Props = { readonly suppliers: readonly Option[]; readonly assetTypes: readonly Option[] };

/** Shown to writers in place of the missing "Nuevo equipo" button: what is missing and where to create it. */
export function EquipmentGuidance({ suppliers, assetTypes }: Props) {
  return (
    <section className="card guidance" aria-labelledby="equipment-guidance-title">
      <h2 id="equipment-guidance-title">{t.title}</h2>
      <p>{t.text}</p>
      <ul className="checklist" aria-label={t.listLabel}>
        {equipmentPrerequisites(suppliers, assetTypes).map((item) => <Step key={item.kind} item={item} />)}
      </ul>
    </section>
  );
}
