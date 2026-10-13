import { redirect } from "next/navigation";
import { currentActor } from "../_lib/session";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in - Parkline" };

function BrandPanel() {
  return (
    <section className="login-brand">
      <p className="brand">Parkline</p>
      <div>
        <p className="login-pitch">Know what your fleet is doing, and what it is costing you.</p>
        <p className="login-note">Availability, repairs, preventives and invoices in one place.</p>
      </div>
      <p className="login-foot">Fleet and equipment management</p>
    </section>
  );
}

export default async function LoginPage() {
  if ((await currentActor()) !== null) redirect("/");
  return (
    <main className="login">
      <BrandPanel />
      <section className="login-panel">
        <LoginForm />
      </section>
    </main>
  );
}
