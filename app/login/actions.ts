"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { field } from "../_lib/action-state";
import { GENERIC_ERROR, LOGIN_ERROR, REJECTED_REQUEST } from "../_lib/messages";
import { isProduction, originAllowed } from "../_lib/session";
import { SESSION_COOKIE, sessionCookieOptions } from "../_lib/session-cookie";
import { getContainer } from "../../src/shared/infrastructure/container";

export type LoginState = { readonly email: string; readonly message: string | null };

type Attempt = { readonly expiresAt: Date; readonly token: string } | string;

const attempt = async (email: string, password: string): Promise<Attempt> => {
  try {
    const result = await getContainer().identity.signIn.execute({ email, password });
    return result.ok ? result.value : LOGIN_ERROR;
  } catch (error: unknown) {
    console.error("Sign-in failed", error);
    return GENERIC_ERROR;
  }
};

export async function loginAction(_previous: LoginState, form: FormData): Promise<LoginState> {
  const email = field(form, "email");
  if (!(await originAllowed())) return { email, message: REJECTED_REQUEST };
  const outcome = await attempt(email, field(form, "password"));
  if (typeof outcome === "string") return { email, message: outcome };
  const store = await cookies();
  store.set(SESSION_COOKIE, outcome.token, sessionCookieOptions(outcome.expiresAt, isProduction()));
  redirect("/");
}
