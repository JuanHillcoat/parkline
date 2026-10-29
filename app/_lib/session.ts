import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ActorContext } from "../../src/identity/application/actor-context";
import { getContainer } from "../../src/shared/infrastructure/container";
import { clientAddress } from "./client-address";
import { signInPath } from "./dev-auto-login";
import { isSameOrigin, requestHost } from "./origin";
import { SESSION_COOKIE } from "./session-cookie";

/**
 * Resolves the session cookie to an actor through `AuthenticateSession`.
 * Deduplicated per request, never across requests. Every page and every server
 * action calls this itself; the layout is never the only guard.
 */
export const currentActor = cache(async (): Promise<ActorContext | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token === undefined || token === "") return null;
  const result = await getContainer().identity.authenticate.execute({ token });
  return result.ok ? result.value : null;
});

/** The same proxy declaration drives the Origin check and the per-address sign-in limit. */
const proxyTrusted = (): boolean => process.env.TRUST_FORWARDED_HOST === "true";

/** The host the current request was addressed to, honoring the proxy declaration. */
export const currentRequestHost = async (): Promise<string | null> => {
  const incoming = await headers();
  return requestHost(incoming.get("x-forwarded-host"), incoming.get("host"), proxyTrusted());
};

/**
 * The authenticated actor, or a redirect to the login page (to the development sign-in under `next dev` with
 * credentials, only for a request addressed to a loopback host).
 */
export const requireActor = async (): Promise<ActorContext> => {
  const actor = await currentActor();
  if (actor === null) redirect(signInPath(process.env, await currentRequestHost()));
  return actor;
};

/** CSRF check (decision D7) for server actions: the Origin header must match the Host. */
export const originAllowed = async (): Promise<boolean> => {
  const host = await currentRequestHost();
  return isSameOrigin((await headers()).get("origin"), host);
};

/** The client address for sign-in throttling, or null when no trusted proxy vouches for it. */
export const requestClientAddress = async (): Promise<string | null> =>
  clientAddress((await headers()).get("x-forwarded-for"), proxyTrusted());

export const isProduction = (): boolean => process.env.NODE_ENV === "production";
