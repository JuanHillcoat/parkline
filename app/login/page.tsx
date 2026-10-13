import { redirect } from "next/navigation";
import { currentActor } from "../_lib/session";
import { copy } from "../_lib/copy";
import { LoginForm } from "./login-form";

export const metadata = { title: copy.login.pageTitle };

function BrandPanel() {
  return (
    <section className="login-brand">
      <p className="brand">{copy.common.productName}</p>
      <div>
        <p className="login-pitch">{copy.login.pitch}</p>
        <p className="login-note">{copy.login.note}</p>
      </div>
      <p className="login-foot">{copy.common.tagline}</p>
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
