export type DevCredentials = { readonly email: string; readonly password: string };

/**
 * Local development shortcut: the credentials the dev server signs in with by itself, so the person trying
 * a change does not type them every time. It is a plain use of the real sign-in with credentials taken from
 * the environment, never a way around authentication.
 *
 * It exists ONLY while `NODE_ENV` is exactly "development" (`next dev`). A production build, the end-to-end
 * server and the unit tests are never "development", so the answer there is always null whatever the
 * variables hold. `next dev` listens on every interface, so callers also require a loopback host
 * (`isLoopbackHost`): a visitor on the local network never gets the administrator session.
 */
export const devAutoLoginCredentials = (env: Readonly<Record<string, string | undefined>>): DevCredentials | null => {
  if (env.NODE_ENV !== "development") return null;
  const email = env.DEV_AUTO_LOGIN_EMAIL?.trim() ?? "";
  const password = env.DEV_AUTO_LOGIN_PASSWORD ?? "";
  return email === "" || password === "" ? null : { email, password };
};

const LOOPBACK_HOST = /^(?:localhost|127(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}|\[::1\])(?::\d{1,5})?$/i;

/** True only for a Host header naming this machine (localhost, 127.0.0.0/8 or [::1]), with or without port. */
export const isLoopbackHost = (host: string | null): boolean => host !== null && LOOPBACK_HOST.test(host);

/** Where an anonymous visitor goes: the shortcut only when it is on and the request is addressed to a loopback host. */
export const signInPath = (env: Readonly<Record<string, string | undefined>>, host: string | null): "/login" | "/dev-login" =>
  devAutoLoginCredentials(env) !== null && isLoopbackHost(host) ? "/dev-login" : "/login";
