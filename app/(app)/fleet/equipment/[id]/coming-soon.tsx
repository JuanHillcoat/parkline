import { copy } from "../../../../_lib/copy";

const t = copy.fleet.detail;

/**
 * Nueva OR, Nueva OT and Indisponibilidad: their modules do not exist yet (issue 60 L4), so the buttons are
 * shown, disabled, with "Próximamente" as their description, until each module brings its own flow.
 */
export function ComingSoonButtons() {
  const buttons = [
    ["btn-green btn-icon-plus", t.comingSoon.newOr],
    ["btn-orange btn-icon-wrench", t.comingSoon.newOt],
    ["btn-red btn-icon-ban", t.comingSoon.unavailability],
  ] as const;
  return (
    <>
      {buttons.map(([tone, label]) => (
        <button key={label} type="button" className={`btn btn-tone ${tone}`} disabled title={t.soon} aria-describedby="detail-soon-hint">{label}</button>
      ))}
      <span id="detail-soon-hint" className="visually-hidden">{t.soon}</span>
    </>
  );
}
