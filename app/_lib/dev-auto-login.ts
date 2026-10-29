export type DevCredentials = { readonly email: string; readonly password: string };

/**
 * Local development shortcut: the credentials the dev server signs in with by itself, so the person trying
 * a change does not type them every time. It is a plain use of the real sign-in with credentials taken from
 * the environment, never a way around authentication.
 *
 * It exists ONLY while `NODE_ENV` is exactly "development" (`next dev`). A production build, the end-to-end
 * server and the unit tests are never "development", so the answer there is always null whatever the
 * variables hold.
 */
export const devAutoLoginCredentials = (env: Readonly<Record<string, string | undefined>>): DevCredentials | null => {
  if (env.NODE_ENV !== "development") return null;
  const email = env.DEV_AUTO_LOGIN_EMAIL?.trim() ?? "";
  const password = env.DEV_AUTO_LOGIN_PASSWORD ?? "";
  return email === "" || password === "" ? null : { email, password };
};
