import { describe, expect, it } from "vitest";
import { devAutoLoginCredentials } from "../dev-auto-login";

const credentials = { DEV_AUTO_LOGIN_EMAIL: "dev@parkline.test", DEV_AUTO_LOGIN_PASSWORD: "a-local-password" };

describe("devAutoLoginCredentials", () => {
  it("returns the credentials only under next dev", () => {
    expect(devAutoLoginCredentials({ NODE_ENV: "development", ...credentials })).toEqual({
      email: "dev@parkline.test",
      password: "a-local-password",
    });
  });

  it.each(["production", "test", "", undefined])("is always null when NODE_ENV is %j, even with the variables set", (mode) => {
    expect(devAutoLoginCredentials({ NODE_ENV: mode, ...credentials })).toBeNull();
  });

  it("is null when the variables are missing or blank", () => {
    expect(devAutoLoginCredentials({ NODE_ENV: "development" })).toBeNull();
    expect(devAutoLoginCredentials({ NODE_ENV: "development", DEV_AUTO_LOGIN_EMAIL: "dev@parkline.test" })).toBeNull();
    expect(devAutoLoginCredentials({ NODE_ENV: "development", DEV_AUTO_LOGIN_EMAIL: "  ", DEV_AUTO_LOGIN_PASSWORD: "x" })).toBeNull();
    expect(devAutoLoginCredentials({ NODE_ENV: "development", DEV_AUTO_LOGIN_EMAIL: "dev@parkline.test", DEV_AUTO_LOGIN_PASSWORD: "" })).toBeNull();
  });

  it("trims the email but keeps the password as typed", () => {
    expect(devAutoLoginCredentials({ NODE_ENV: "development", DEV_AUTO_LOGIN_EMAIL: " dev@parkline.test ", DEV_AUTO_LOGIN_PASSWORD: " p " })).toEqual({
      email: "dev@parkline.test",
      password: " p ",
    });
  });
});
