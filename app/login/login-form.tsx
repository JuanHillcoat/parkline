"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";

const INITIAL: LoginState = { email: "", message: null };

function Credentials({ email }: { email: string }) {
  return (
    <>
      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="username" required
          placeholder="you@example.com" defaultValue={email} className="input" />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password"
          required placeholder="Your password" className="input" />
      </div>
    </>
  );
}

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, INITIAL);
  return (
    <form action={action} className="login-form" noValidate>
      <h1>Sign in</h1>
      <p className="page-sub">Use the account your administrator gave you.</p>
      <Credentials email={state.email} />
      {state.message !== null && <p role="alert" className="form-error">{state.message}</p>}
      <button type="submit" disabled={pending} className="btn btn-primary btn-block" style={{ marginTop: 24 }}>
        {pending ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
