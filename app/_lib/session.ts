import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ActorContext } from "../../src/identity/application/actor-context";
import { getContainer } from "../../src/shared/infrastructure/container";
import { isSameOrigin } from "./origin";
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

/** The authenticated actor, or a redirect to the login page. */
export const requireActor = async (): Promise<ActorContext> => {
  const actor = await currentActor();
  if (actor === null) redirect("/login");
  return actor;
};

/** CSRF check (decision D7) for server actions: the Origin header must match the Host. */
export const originAllowed = async (): Promise<boolean> => {
  const incoming = await headers();
  const host = incoming.get("x-forwarded-host") ?? incoming.get("host");
  return isSameOrigin(incoming.get("origin"), host);
};

export const isProduction = (): boolean => process.env.NODE_ENV === "production";
