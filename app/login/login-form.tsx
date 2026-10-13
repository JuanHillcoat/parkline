"use client";

import { useActionState } from "react";
import { copy } from "../_lib/copy";
import { loginAction, type LoginState } from "./actions";

const INITIAL: LoginState = { email: "", message: null };

function Credentials({ email }: { email: string }) {
  return (
    <>
      <div className="field">
        <label htmlFor="email">{copy.login.emailLabel}</label>
        <input id="email" name="email" type="email" autoComplete="username" required
          placeholder={copy.login.emailPlaceholder} defaultValue={email} className="input" />
      </div>
      <div className="field">
        <label htmlFor="password">{copy.login.passwordLabel}</label>
        <input id="password" name="password" type="password" autoComplete="current-password"
          required placeholder={copy.login.passwordPlaceholder} className="input" />
      </div>
    </>
  );
}

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, INITIAL);
  return (
    <form action={action} className="login-form" noValidate>
      <h1>{copy.login.title}</h1>
      <p className="page-sub">{copy.login.subtitle}</p>
      <Credentials email={state.email} />
      {state.message !== null && <p role="alert" className="form-error">{state.message}</p>}
      <button type="submit" disabled={pending} className="btn btn-primary btn-block" style={{ marginTop: 24 }}>
        {pending ? copy.login.submitting : copy.login.submit}
      </button>
    </form>
  );
}
