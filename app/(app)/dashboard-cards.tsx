import { KpiIcon } from "../_components/icons";
import { copy } from "../_lib/copy";
import type { Kpi } from "../_lib/dashboard-view";

const t = copy.home;

function KpiCard({ kpi }: { kpi: Kpi }) {
  const label = t.kpi[kpi.key];
  return (
    <li>
      <a className="card kpi-card" href={kpi.href} aria-label={`${label}: ${String(kpi.count)}. ${t.kpiLink(label)}`}>
        <span className="kpi-icon"><KpiIcon name={kpi.key} /></span>
        <span className="kpi-value">{kpi.count}</span>
        <span className="kpi-label">{label}</span>
      </a>
    </li>
  );
}

/** One card per count the actor may read; each links to the screen that owns it. */
export function KpiGrid({ kpis }: { kpis: readonly Kpi[] }) {
  if (kpis.length === 0) return null;
  return (
    <section aria-labelledby="dash-summary">
      <h2 id="dash-summary" className="dash-sr">{t.summaryTitle}</h2>
      <ul className="kpi-grid">
        {kpis.map((kpi) => <KpiCard key={kpi.key} kpi={kpi} />)}
      </ul>
    </section>
  );
}

type Step = { readonly title: string; readonly text: string; readonly cta: string; readonly href: string };

function StepItem({ index, step }: { index: number; step: Step }) {
  return (
    <li className="first-step">
      <span className="first-step-tag">{t.firstSteps.stepLabel(index + 1)}</span>
      <h3>{step.title}</h3>
      <p>{step.text}</p>
      <a className={index === 0 ? "btn btn-primary" : "btn"} href={step.href}>{step.cta}</a>
    </li>
  );
}

/** Shown only while nothing is registered; links only to the screens the actor can open. */
export function FirstSteps({ organization, fleet }: { organization: boolean; fleet: boolean }) {
  const steps: Step[] = [
    ...(organization ? [{ ...t.firstSteps.organization, href: "/organization" }] : []),
    ...(fleet ? [{ ...t.firstSteps.fleet, href: "/fleet" }] : []),
  ];
  if (steps.length === 0) return null;
  return (
    <section className="empty-state first-steps" aria-labelledby="dash-first-steps">
      <h2 id="dash-first-steps">{t.firstSteps.title}</h2>
      <p>{t.firstSteps.text}</p>
      <ol className="first-step-list">
        {steps.map((step, index) => <StepItem key={step.href} index={index} step={step} />)}
      </ol>
    </section>
  );
}
