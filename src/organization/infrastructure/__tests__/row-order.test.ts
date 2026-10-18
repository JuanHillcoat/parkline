import { describe, expect, it, vi } from "vitest";
import { compareByName } from "../row-order";

const order = (names: readonly string[]): string[] =>
  names
    .map((name, index) => ({ id: String(index), name }))
    .sort(compareByName)
    .map((row) => row.name);

describe("compareByName", () => {
  it("orders accented and mixed-case names in one exact order", () => {
    expect(order(["Zed", "ana", "Álvaro", "alvaro"])).toEqual(["alvaro", "Álvaro", "ana", "Zed"]);
  });

  it("falls back to the id when two names have the same key", () => {
    const rows = [
      { id: "b", name: "Mina" },
      { id: "a", name: "mina" },
    ];
    expect(rows.sort(compareByName).map((row) => row.id)).toEqual(["a", "b"]);
  });

  it("uses a fixed collator, never the runtime default locale", () => {
    const spy = vi.spyOn(String.prototype, "localeCompare");
    order(["b", "a", "á"]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
