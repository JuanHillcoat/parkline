"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getContainer } from "../../src/shared/infrastructure/container";
import { isProduction, originAllowed } from "../_lib/session";
import { SESSION_COOKIE, clearedCookieOptions } from "../_lib/session-cookie";

/** Revokes the session on the server, clears the cookie and goes to the login page. */
export async function signOutAction(): Promise<void> {
  if (!(await originAllowed())) redirect("/login");
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token !== undefined && token !== "") {
    try {
      await getContainer().identity.signOut.execute({ token });
    } catch (error: unknown) {
      console.error("Sign-out failed", error);
    }
  }
  store.set(SESSION_COOKIE, "", clearedCookieOptions(isProduction()));
  redirect("/login");
}
