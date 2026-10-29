import { describe, expect, it } from "vitest";
import { devAutoLoginCredentials, isLoopbackHost, signInPath } from "../dev-auto-login";

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

describe("isLoopbackHost", () => {
  it.each(["localhost", "localhost:3000", "LOCALHOST:3000", "127.0.0.1", "127.0.0.1:3000", "127.1.2.3", "127.255.255.254:8080", "[::1]", "[::1]:3000"])(
    "accepts %j",
    (host) => {
      expect(isLoopbackHost(host)).toBe(true);
    },
  );

  it.each([
    null,
    "",
    "192.168.1.173:3000",
    "10.0.0.5",
    "0.0.0.0:3000",
    "parkline.example",
    "localhost.evil.com",
    "127.0.0.1.evil.com",
    "128.0.0.1",
    "127.0.0.256",
    "[::2]",
    "[fe80::1]:3000",
    "[::1]x",
    "::1",
    "localhost:abc",
    "evil.com#localhost",
  ])("rejects %j", (host) => {
    expect(isLoopbackHost(host)).toBe(false);
  });
});

describe("signInPath", () => {
  const dev = { NODE_ENV: "development", ...credentials };

  it("goes to /dev-login only with the shortcut on and a loopback host", () => {
    expect(signInPath(dev, "localhost:3000")).toBe("/dev-login");
    expect(signInPath(dev, "[::1]:3000")).toBe("/dev-login");
  });

  it("goes to /login from a LAN host even with the shortcut on", () => {
    expect(signInPath(dev, "192.168.1.173:3000")).toBe("/login");
    expect(signInPath(dev, null)).toBe("/login");
  });

  it("goes to /login in production with the variables set", () => {
    expect(signInPath({ NODE_ENV: "production", ...credentials }, "localhost:3000")).toBe("/login");
  });

  it("goes to /login in development without the variables", () => {
    expect(signInPath({ NODE_ENV: "development" }, "localhost:3000")).toBe("/login");
  });
});
