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

  it("keeps the shared kernel free of module imports", async () => {
    const errors = await dependencyErrors(
      "src/shared/domain/ports/access-policy.ts",
      'import type { Role } from "../../../identity/domain/role";\nexport type X = Role;\n',
    );
    expect(errors).toHaveLength(1);
  });

  it("lets a module use the shared access policy port and forbids importing identity", async () => {
    const port = await dependencyErrors(
      "src/organization/application/use-cases/create.ts",
      'import type { AccessPolicy } from "../../../shared/domain/ports/access-policy";\nexport type X = AccessPolicy;\n',
    );
    const identity = await dependencyErrors(
      "src/organization/application/use-cases/create.ts",
      'import { requirePermission } from "../../../identity/application/actor-context";\nexport const x = requirePermission;\n',
    );
    expect(port).toEqual([]);
    expect(identity).toHaveLength(1);
  });

  it("lets identity use the shared scope directory port and forbids importing organization", async () => {
    const path = "src/identity/application/use-cases/change-user-role.ts";
    const port = await dependencyErrors(
      path,
      'import type { ScopeDirectory } from "../../../shared/domain/ports/scope-directory";\nexport type X = ScopeDirectory;\n',
    );
    const application = await dependencyErrors(
      path,
      'import { ListOperations } from "../../../organization/application/use-cases/list-operations";\nexport const x = ListOperations;\n',
    );
    const infrastructure = await dependencyErrors(
      path,
      'import { PostgresScopeDirectory } from "../../../organization/infrastructure/postgres-scope-directory";\nexport const x = PostgresScopeDirectory;\n',
    );
    expect(port).toEqual([]);
    expect(application).toHaveLength(1);
    expect(infrastructure).toHaveLength(1);
  });

  it("lets metering use the shared equipment directory port and forbids importing fleet", async () => {
    const path = "src/metering/application/use-cases/record-reading.ts";
    const port = await dependencyErrors(
      path,
      'import type { EquipmentDirectory } from "../../../shared/domain/ports/equipment-directory";\nexport type X = EquipmentDirectory;\n',
    );
    const application = await dependencyErrors(
      path,
      'import { GetEquipment } from "../../../fleet/application/use-cases/get-equipment";\nexport const x = GetEquipment;\n',
    );
    const infrastructure = await dependencyErrors(
      path,
      'import { PostgresAssignmentDirectory } from "../../../fleet/infrastructure/postgres-assignment-directory";\nexport const x = PostgresAssignmentDirectory;\n',
    );
    const organization = await dependencyErrors(
      path,
      'import { ListOperations } from "../../../organization/application/use-cases/list-operations";\nexport const x = ListOperations;\n',
    );
    expect(port).toEqual([]);
    expect(application).toHaveLength(1);
    expect(infrastructure).toHaveLength(1);
    expect(organization).toHaveLength(1);
  });

  it("fails functions longer than 20 lines in non-test code", async () => {
    const body = Array.from({ length: 22 }, (_, i) => `  const v${String(i)} = ${String(i)};`).join("\n");
    const code = `export function long(): void {\n${body}\n}\n`;
    const errors = await violations("src/shared/domain/long.ts", code);
    expect(errors.some((m) => m.startsWith("max-lines-per-function"))).toBe(true);
  });
});
