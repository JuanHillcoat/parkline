import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Net depth of braces; anything but zero means a block was left open or closed twice. */
const braceDepth = (css: string): number => css.split("{").length - css.split("}").length;

describe("app/globals.css", () => {
  it("has balanced braces, so no block (such as a media query) swallows later rules", () => {
    const css = readFileSync(resolve(__dirname, "../../globals.css"), "utf8");
    expect(braceDepth(css)).toBe(0);
  });

  it("detects an unclosed media block", () => {
    expect(braceDepth("@media (max-width: 900px) { .a { color: red; }")).toBe(1);
    expect(braceDepth(".a { color: red; }")).toBe(0);
  });
});
