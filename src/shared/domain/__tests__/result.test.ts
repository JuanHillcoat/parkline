import { describe, expect, it } from "vitest";
import { andThen, err, isErr, isOk, map, mapErr, ok, unwrapOr } from "../result";

describe("Result", () => {
  it("creates ok and err values", () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
    expect(err("boom")).toEqual({ ok: false, error: "boom" });
    expect(isOk(ok(1))).toBe(true);
    expect(isErr(err("x"))).toBe(true);
  });

  it("maps only the ok side", () => {
    expect(map(ok(2), (n) => n * 3)).toEqual(ok(6));
    expect(map(err("e"), (n: number) => n * 3)).toEqual(err("e"));
  });

  it("maps only the error side", () => {
    expect(mapErr(err("e"), (e) => `${e}!`)).toEqual(err("e!"));
    expect(mapErr(ok(1), (e: string) => `${e}!`)).toEqual(ok(1));
  });

  it("chains computations that may fail", () => {
    const half = (n: number) => (n % 2 === 0 ? ok(n / 2) : err("odd"));
    expect(andThen(ok(4), half)).toEqual(ok(2));
    expect(andThen(ok(3), half)).toEqual(err("odd"));
    expect(andThen(err("first"), half)).toEqual(err("first"));
  });

  it("unwraps with a fallback", () => {
    expect(unwrapOr(ok(1), 0)).toBe(1);
    expect(unwrapOr(err("e"), 0)).toBe(0);
  });
});
