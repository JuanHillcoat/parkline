/**
 * Install command: creates the single tenant and its first administrator.
 *
 * Tenant name, email and display name come from flags or prompts. The password
 * is read from the INSTALL_ADMIN_PASSWORD environment variable or from a
 * no-echo prompt; it is never accepted as a flag and never printed. On a
 * terminal the command shows what it will create and asks for confirmation.
 */
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Writable } from "node:stream";
import postgres from "postgres";
import type { InstallInput } from "../src/identity/application/use-cases/install-tenant-admin";
import { createContainer } from "../src/shared/infrastructure/container";
import {
  checkInput,
  collectInput,
  describeInstall,
  needsConfirmation,
  readFlags,
  requireTerminal,
  type Ask,
} from "./install-admin-input";

/**
 * One readline interface for the whole session (a new one per question can drop
 * buffered lines). Echo is switched off only while a hidden answer is typed.
 */
export type PrompterStreams = { input: NodeJS.ReadableStream; output: NodeJS.WritableStream; isTty: boolean };

export function createPrompter(streams: PrompterStreams): { ask: Ask; close: () => void } {
  let muted = false;
  const output = new Writable({
    write(chunk: Buffer, _encoding, done) {
      if (!muted) streams.output.write(chunk);
      done();
    },
  });
  const rl = createInterface({ input: streams.input, output, terminal: true });
  const ask: Ask = async (label, hidden) => {
    requireTerminal(label, streams.isTty);
    // The label is the readline prompt: readline redraws the line when a question
    // starts, so a label written beforehand would be erased. Echo is muted only
    // after the prompt is drawn.
    const pending = rl.question(`${label}: `);
    muted = hidden;
    try {
      return (await pending).trim();
    } finally {
      muted = false;
      if (hidden) process.stdout.write("\n");
    }
  };
  return { ask, close: () => { rl.close(); } };
}

async function confirm(ask: Ask): Promise<boolean> {
  return (await ask("Create it? Type yes to continue", false)).toLowerCase() === "yes";
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

async function run(url: string, argv: string[]): Promise<number> {
  const flags = readFlags(argv);
  const prompter = createPrompter({ input: process.stdin, output: process.stdout, isTty: process.stdin.isTTY });
  try {
    const input = await collectInput(flags, process.env, prompter.ask);
    const problem = checkInput(input);
    if (problem !== null) {
      console.error(problem);
      return 1;
    }
    if (needsConfirmation(flags, process.stdin.isTTY)) {
      console.log(describeInstall(input).join("\n"));
      if (!(await confirm(prompter.ask))) {
        console.log("Cancelled. Nothing was created.");
        return 1;
      }
    }
    return await install(url, input);
  } finally {
    prompter.close();
  }
}

async function main(): Promise<number> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");
  return run(url, process.argv.slice(2));
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
