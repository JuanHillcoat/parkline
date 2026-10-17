import { copy } from "../_lib/copy";
import { requireActor } from "../_lib/session";

export const metadata = { title: copy.home.pageTitle };

const STEPS = copy.home.steps;

function Step({ index, step }: { index: number; step: (typeof STEPS)[number] }) {
  return (
    <section className="card">
      <span className="step-tag">{copy.home.stepLabel(index + 1)}</span>
      <h2>{step.title}</h2>
      <p>{step.text}</p>
      <button type="button" disabled className={index === 0 ? "btn btn-primary" : "btn"}>
        {step.cta}
      </button>
      <p className="hint">{copy.common.availableSoon}</p>
    </section>
  );
}

export default async function HomePage() {
  await requireActor();
  return (
    <>
      <header className="page-head">
        <div>
          <h1>{copy.home.welcome}</h1>
          <p className="page-sub">{copy.home.empty}</p>
        </div>
      </header>
      <div className="steps">
        {STEPS.map((step, index) => <Step key={step.title} index={index} step={step} />)}
      </div>
      <section className="card">
        <h2>{copy.home.preview.title}</h2>
        <p>{copy.home.preview.text}</p>
      </section>
    </>
  );
}
