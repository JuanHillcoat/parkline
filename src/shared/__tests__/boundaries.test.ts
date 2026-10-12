import { ESLint } from "eslint";
import tseslint from "typescript-eslint";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { architectureConfig } from "../../../eslint.architecture.mjs";

const eslint = new ESLint({
  cwd: process.cwd(),
  overrideConfigFile: true,
  overrideConfig: [
    { files: ["**/*.ts"], languageOptions: { parser: tseslint.parser } },
    ...architectureConfig,
    {
      files: ["**/*.ts"],
      settings: {
        "import/resolver": { [resolve(import.meta.dirname, "support/fixture-resolver.cjs")]: {} },
      },
    },
  ],
});

const violations = async (filePath: string, code: string): Promise<string[]> => {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => `${m.ruleId ?? "parse"}: ${m.message}`);
};

const dependencyErrors = async (filePath: string, code: string): Promise<string[]> =>
  (await violations(filePath, code)).filter((m) => m.startsWith("boundaries/"));

describe("architecture boundaries", () => {
  it("reports a domain file importing from infrastructure", async () => {
    const errors = await dependencyErrors(
      "src/fleet/domain/vehicle.ts",
      'import { Repo } from "../infrastructure/vehicle-repository";\nexport const x = Repo;\n',
    );
    expect(errors).toHaveLength(1);
  });

  it("accepts domain importing shared domain and its own domain", async () => {
    const errors = await dependencyErrors(
      "src/fleet/domain/vehicle.ts",
      'import { ok } from "../../shared/domain/result";\nimport { Plate } from "./plate";\nexport const x = [ok, Plate];\n',
    );
    expect(errors).toEqual([]);
  });

  it("rejects a module importing another module's infrastructure", async () => {
    const errors = await dependencyErrors(
      "src/billing/application/use-cases/invoice.ts",
      'import { Repo } from "../../../fleet/infrastructure/repo";\nexport const x = Repo;\n',
    );
    expect(errors).toHaveLength(1);
  });

  it("rejects application importing infrastructure and routes importing adapters", async () => {
    const app = await dependencyErrors(
      "src/fleet/application/use-cases/register.ts",
      'import { Repo } from "../../infrastructure/repo";\nexport const x = Repo;\n',
    );
    const route = await dependencyErrors(
      "app/fleet/page.ts",
      'import { Repo } from "../../src/fleet/infrastructure/repo";\nexport const x = Repo;\n',
    );
    expect(app).toHaveLength(1);
    expect(route).toHaveLength(1);
  });

  it("lets routes use the composition root and use cases", async () => {
    const errors = await dependencyErrors(
      "app/fleet/page.ts",
      'import { container } from "../../src/shared/infrastructure/container";\nimport { register } from "../../src/fleet/application/use-cases/register";\nexport const x = [container, register];\n',
    );
    expect(errors).toEqual([]);
  });

  it("fails functions longer than 20 lines in non-test code", async () => {
    const body = Array.from({ length: 22 }, (_, i) => `  const v${String(i)} = ${String(i)};`).join("\n");
    const code = `export function long(): void {\n${body}\n}\n`;
    const errors = await violations("src/shared/domain/long.ts", code);
    expect(errors.some((m) => m.startsWith("max-lines-per-function"))).toBe(true);
  });
});
