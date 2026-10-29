import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { devAutoLoginCredentials } from "../_lib/dev-auto-login";
import { isProduction } from "../_lib/session";
import { SESSION_COOKIE, sessionCookieOptions } from "../_lib/session-cookie";
import { getContainer } from "../../src/shared/infrastructure/container";

const notFound = (): Response => new Response(null, { status: 404 });

/**
 * Local development only: signs in with the credentials of the environment (the real sign-in, with its
 * throttling and audit) and goes to the home page. Anywhere that is not `next dev` it answers an empty 404,
 * as if the route did not exist.
 */
export async function GET(): Promise<Response> {
  const credentials = devAutoLoginCredentials(process.env);
  if (credentials === null) return notFound();
  const result = await getContainer().identity.signIn.execute({ ...credentials, clientAddress: null });
  if (!result.ok) return new Response("The development credentials were rejected. Use /login.", { status: 401 });
  (await cookies()).set(SESSION_COOKIE, result.value.token, sessionCookieOptions(result.value.expiresAt, isProduction()));
  redirect("/");
}
