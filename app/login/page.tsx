import { redirect } from "next/navigation";
import { currentActor } from "../_lib/session";
import { copy } from "../_lib/copy";
import { LoginForm } from "./login-form";

export const metadata = { title: copy.login.pageTitle };

function Contours() {
  return (
    <svg className="login-bg" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <g fill="none" stroke="#2563eb" strokeOpacity=".14" strokeWidth="1.2">
      <path d="M-50 640C150 560 260 700 460 620S760 520 900 600 1150 560 1260 500"/>
      <path d="M-50 600C150 520 260 660 460 580S760 480 900 560 1150 520 1260 460"/>
      <path d="M-50 560C150 480 260 620 460 540S760 440 900 520 1150 480 1260 420"/>
      <path d="M-50 520C150 440 260 580 460 500S760 400 900 480 1150 440 1260 380"/>
      <path d="M-50 480C150 400 260 540 460 460S760 360 900 440 1150 400 1260 340"/>
      <path d="M-50 440C150 360 260 500 460 420S760 320 900 400 1150 360 1260 300"/>
      <path d="M-50 400C150 320 260 460 460 380S760 280 900 360 1150 320 1260 260"/>
      <path d="M-50 360C150 280 260 420 460 340S760 240 900 320 1150 280 1260 220"/>
      <path d="M-50 320C150 240 260 380 460 300S760 200 900 280 1150 240 1260 180"/>
      <path d="M-50 280C150 200 260 340 460 260S760 160 900 240 1150 200 1260 140"/>
      </g>
    </svg>
  );
}

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
      <Contours />
      <BrandPanel />
      <section className="login-panel">
        <LoginForm />
      </section>
    </main>
  );
}
