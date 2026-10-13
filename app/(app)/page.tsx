import { requireActor } from "../_lib/session";

export const metadata = { title: "Home - Parkline" };

const STEPS = [
  { title: "Add suppliers", text: "Who rents you equipment.", cta: "Add supplier", primary: true },
  { title: "Add operations and sites", text: "Where the equipment works.", cta: "Add operation", primary: false },
  { title: "Add equipment", text: "Each unit with its supplier and number.", cta: "Add equipment", primary: false },
];

function Step({ index, step }: { index: number; step: (typeof STEPS)[number] }) {
  return (
    <section className="card">
      <span className="step-tag">Step {index + 1}</span>
      <h2>{step.title}</h2>
      <p>{step.text}</p>
      <button type="button" disabled className={step.primary ? "btn btn-primary" : "btn"}>
        {step.cta}
      </button>
      <p className="hint">Available soon</p>
    </section>
  );
}

export default async function HomePage() {
  await requireActor();
  return (
    <>
      <header className="page-head">
        <div>
          <h1>Welcome to Parkline</h1>
          <p className="page-sub">Nothing is loaded yet. Set up your fleet in three steps.</p>
        </div>
      </header>
      <div className="steps">
        {STEPS.map((step, index) => <Step key={step.title} index={index} step={step} />)}
      </div>
      <section className="card">
        <h2>What you will see here</h2>
        <p>Availability, open repair orders, preventives and monthly cost appear as soon as there is data.</p>
      </section>
    </>
  );
}
