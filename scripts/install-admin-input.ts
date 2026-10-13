/**
 * Input rules of the install command, kept free of I/O so they can be unit tested.
 *
 * Tenant name, email and display name come from flags or prompts. The password
 * never comes from a flag: it is INSTALL_ADMIN_PASSWORD or a no-echo prompt.
 */
import { parseArgs } from "node:util";
import type { InstallInput } from "../src/identity/application/use-cases/install-tenant-admin";

export type Flags = { "tenant-name"?: string; email?: string; "display-name"?: string };

/** Asks one question; `hidden` means the typed characters are not echoed. */
export type Ask = (label: string, hidden: boolean) => Promise<string>;

export function readFlags(argv: string[]): Flags {
  const options = {
    "tenant-name": { type: "string" },
    email: { type: "string" },
    "display-name": { type: "string" },
  } as const;
  return parseArgs({ args: argv, options, strict: true }).values;
}

/** Without a terminal there is nobody to ask, so a missing value is an error. */
export function requireTerminal(label: string, isTty: boolean): void {
  if (!isTty) throw new Error(`${label} is required (no terminal available to ask)`);
}

export async function collectInput(
  flags: Flags,
  env: Record<string, string | undefined>,
  ask: Ask,
): Promise<InstallInput> {
  return {
    tenantName: flags["tenant-name"] ?? (await ask("Tenant name", false)),
    email: flags.email ?? (await ask("Admin email", false)),
    displayName: flags["display-name"] ?? (await ask("Admin display name", false)),
    password: env.INSTALL_ADMIN_PASSWORD ?? (await ask("Admin password", true)),
  };
}
