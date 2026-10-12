/**
 * Install command: creates the single tenant and its first administrator.
 *
 * Tenant name, email and display name come from flags or prompts. The password
 * is read from the INSTALL_ADMIN_PASSWORD environment variable or from a
 * no-echo prompt; it is never accepted as a flag and never printed.
 */
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { Writable } from "node:stream";
import postgres from "postgres";
import type { InstallInput } from "../src/identity/application/use-cases/install-tenant-admin";
import { createContainer } from "../src/shared/infrastructure/container";

type Flags = { "tenant-name"?: string; email?: string; "display-name"?: string };

export function readFlags(argv: string[]): Flags {
  const options = {
    "tenant-name": { type: "string" },
    email: { type: "string" },
    "display-name": { type: "string" },
  } as const;
  return parseArgs({ args: argv, options, strict: true }).values;
}

/** Asks on the terminal; when `hidden`, the typed characters are not echoed. */
async function ask(label: string, hidden: boolean): Promise<string> {
  if (!process.stdin.isTTY) throw new Error(`${label} is required (no terminal available to ask)`);
  const output = new Writable({
    write(chunk: Buffer, _encoding, done) {
      if (!hidden) process.stdout.write(chunk);
      done();
    },
  });
  process.stdout.write(`${label}: `);
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  try {
    return (await rl.question("")).trim();
  } finally {
    rl.close();
    if (hidden) process.stdout.write("\n");
  }
}

async function collectInput(flags: Flags): Promise<InstallInput> {
  return {
    tenantName: flags["tenant-name"] ?? (await ask("Tenant name", false)),
    email: flags.email ?? (await ask("Admin email", false)),
    displayName: flags["display-name"] ?? (await ask("Admin display name", false)),
    password: process.env.INSTALL_ADMIN_PASSWORD ?? (await ask("Admin password", true)),
  };
}

async function install(url: string, input: InstallInput): Promise<number> {
  const sql = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    const result = await createContainer(sql).identity.install.execute(input);
    if (!result.ok) {
      console.error(`Install failed: ${result.error.message} (${result.error.code})`);
      return 1;
    }
    console.log(`Tenant created: ${result.value.tenant.id}`);
    console.log(`Admin created:  ${result.value.user.id}`);
    return 0;
  } finally {
    await sql.end();
  }
}

async function main(): Promise<number> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");
  const input = await collectInput(readFlags(process.argv.slice(2)));
  return install(url, input);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : "Install failed");
      process.exitCode = 1;
    });
}
