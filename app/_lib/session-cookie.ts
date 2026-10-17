export const SESSION_COOKIE = "parkline_session";

export type SessionCookieOptions = {
  readonly httpOnly: true;
  readonly sameSite: "lax";
  readonly path: "/";
  readonly secure: boolean;
  readonly expires: Date;
};

/** Cookie attributes for a session: HttpOnly, SameSite=Lax, Secure in production. */
export const sessionCookieOptions = (expiresAt: Date, production: boolean): SessionCookieOptions => ({
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  secure: production,
  expires: expiresAt,
});

/** Same attributes with an expiry in the past, used to clear the cookie. */
export const clearedCookieOptions = (production: boolean): SessionCookieOptions =>
  sessionCookieOptions(new Date(0), production);
