import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const manifest = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

/** Commands that run TypeScript directly through type stripping, which Node flags as experimental. */
const typeStripped = Object.entries(manifest.scripts).filter(([, command]) =>
  command.includes("--experimental-transform-types"),
);

describe("package scripts that run TypeScript directly", () => {
  it("finds the command-line scripts", () => {
    expect(typeStripped.map(([name]) => name).sort()).toEqual(["db:create-app-login", "db:migrate", "install:admin"]);
  });

  it.each(typeStripped)("%s silences the experimental warning so it does not mix with prompts and output", (_name, command) => {
    expect(command).toContain("--disable-warning=ExperimentalWarning");
  });

  it.each(typeStripped)("%s silences only that warning, not every warning", (_name, command) => {
    expect(command).not.toContain("--no-warnings");
  });
});

const root = resolve(import.meta.dirname, "../..");

/** The node flags of a script, between `node` and the TypeScript file it runs. */
const nodeFlags = (command: string): string[] => command.split(/\s+/).slice(1, -1);

/** Runs a one-line TypeScript file with the given node flags and returns what it wrote to stderr. */
function stderrOf(flags: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "parkline-flags-"));
  try {
    const file = join(dir, "noop.ts");
    writeFileSync(file, "const answer: number = 42;\nconsole.log(answer);\n");
    const run = spawnSync(process.execPath, [...flags, file], { cwd: root, encoding: "utf8" });
    expect(run.status).toBe(0);
    return run.stderr;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("the experimental warning of type stripping", () => {
  const migrate = manifest.scripts["db:migrate"] ?? "";
  const flagsWithoutSilence = nodeFlags(migrate).filter((flag) => !flag.startsWith("--disable-warning"));

  it("is printed by node when the flag is absent (so the check below can tell the difference)", () => {
    expect(stderrOf(flagsWithoutSilence)).toContain("ExperimentalWarning");
  });

  it.each(typeStripped)("is not printed when %s runs with its own flags", (_name, command) => {
    expect(stderrOf(nodeFlags(command))).not.toContain("ExperimentalWarning");
  });
});
