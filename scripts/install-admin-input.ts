/**
 * Input rules of the install command, kept free of I/O so they can be unit tested.
 *
 * Tenant name, email and display name come from flags or prompts. The password
 * never comes from a flag: it is INSTALL_ADMIN_PASSWORD or a no-echo prompt.
 */
import { parseArgs } from "node:util";
import type { InstallInput } from "../src/identity/application/use-cases/install-tenant-admin";

export type Flags = { "tenant-name"?: string; email?: string; "display-name"?: string; yes?: boolean };

/** Asks one question; `hidden` means the typed characters are not echoed. */
export type Ask = (label: string, hidden: boolean) => Promise<string>;

export function readFlags(argv: string[]): Flags {
  const options = {
    "tenant-name": { type: "string" },
    email: { type: "string" },
    "display-name": { type: "string" },
    yes: { type: "boolean" },
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
    tenantName: flags["tenant-name"] ?? (await ask("Organization name", false)),
    email: flags.email ?? (await ask("Admin email (used to sign in)", false)),
    displayName: flags["display-name"] ?? (await ask("Admin display name (a person's name, not the password)", false)),
    password: env.INSTALL_ADMIN_PASSWORD ?? (await ask("Admin password (hidden, at least 12 characters)", true)),
  };
}

/** What is about to be created, for a confirmation step. Never includes the password. */
export function describeInstall(input: InstallInput): string[] {
  return [
    "About to create:",
    `  Organization : ${input.tenantName}`,
    `  Admin email  : ${input.email}`,
    `  Display name : ${input.displayName}`,
  ];
}

/**
 * Catches the most damaging typing mistake: the secret ending up in a visible
 * field. Returns an error message, or null when the input looks sane.
 */
export function checkInput(input: InstallInput): string | null {
  const { displayName, password } = input;
  if (password !== "" && displayName.includes(password)) {
    return "The display name contains the password. Re-run and type the person's name there.";
  }
  return null;
}

/** Interactive runs confirm before writing; `--yes` and non-interactive runs do not. */
export function needsConfirmation(flags: Pick<Flags, "yes">, isTty: boolean): boolean {
  return isTty && flags.yes !== true;
}
