import { describe, expect, it } from "vitest";
import { clientAddress } from "../client-address";

describe("clientAddress", () => {
  it("ignores x-forwarded-for unless the proxy is trusted", () => {
    expect(clientAddress("203.0.113.7", false)).toBeNull();
  });

  it("returns null when the header is absent", () => {
    expect(clientAddress(null, true)).toBeNull();
  });

  it("takes the first value of a trusted header", () => {
    expect(clientAddress("203.0.113.7", true)).toBe("203.0.113.7");
  });

  it("trims whitespace around the value", () => {
    expect(clientAddress("  203.0.113.7  ", true)).toBe("203.0.113.7");
  });

  it("takes the first hop of a proxy chain", () => {
    expect(clientAddress("203.0.113.7, 198.51.100.2, 10.0.0.1", true)).toBe("203.0.113.7");
  });

  it("accepts IPv6 addresses", () => {
    expect(clientAddress("2001:db8::1", true)).toBe("2001:db8::1");
    expect(clientAddress("::1, 10.0.0.1", true)).toBe("::1");
    expect(clientAddress("::ffff:203.0.113.7", true)).toBe("::ffff:203.0.113.7");
  });

  it("rejects empty, blank and garbage values", () => {
    expect(clientAddress("", true)).toBeNull();
    expect(clientAddress("   ", true)).toBeNull();
    expect(clientAddress(", 203.0.113.7", true)).toBeNull();
    expect(clientAddress("not-an-ip", true)).toBeNull();
    expect(clientAddress("999.1.1.1", true)).toBeNull();
    expect(clientAddress("203.0.113.7:8080", true)).toBeNull();
    expect(clientAddress("<script>", true)).toBeNull();
  });

  it("rejects absurdly long values", () => {
    expect(clientAddress("1".repeat(500), true)).toBeNull();
    expect(clientAddress(`${"a:".repeat(200)}1`, true)).toBeNull();
  });
});
