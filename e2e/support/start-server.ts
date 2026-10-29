/**
 * Playwright `webServer.command`. Creates the ephemeral database, builds the world, writes
 * `e2e/.world.json`, starts the compiled app (`next start`) on the e2e port against the
 * restricted login and, on exit, stops the app and drops the database and the login. On Windows
 * Playwright kills the process tree without signals, so `global-teardown.ts` drops them too.
 * Run it with the same node flags as the repository scripts (see playwright.config.ts).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { adminUrl, createEphemeral, dropEphemeral, type Ephemeral } from "./database";
import { buildWorld } from "./world-builder";
import { E2E_PORT, WORLD_FILE } from "./world";

const ROOT = resolve(import.meta.dirname, "../..");
const NEXT_BIN = resolve(ROOT, "node_modules/next/dist/bin/next");

function startNext(appUrl: string): ChildProcess {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: appUrl,
    // An empty value wins over any `.env` file, so the app always uses a direct connection.
    DATABASE_POOLER: "",
    MIGRATE_DATABASE_URL: "",
    NODE_ENV: "production",
    // The development sign-in must stay inert in a production build even when its variables are set.
    DEV_AUTO_LOGIN_EMAIL: "dev-shortcut@parkline.test",
    DEV_AUTO_LOGIN_PASSWORD: "not-a-real-password",
  };
  return spawn(process.execPath, [NEXT_BIN, "start", "-p", String(E2E_PORT)], { cwd: ROOT, env, stdio: "inherit" });
}

function installCleanup(resources: Ephemeral, next: ChildProcess): void {
  let done = false;
  const cleanup = async (code: number): Promise<void> => {
    if (done) return;
    done = true;
    next.kill();
    await dropEphemeral(resources).catch((error: unknown) => {
      console.error("e2e cleanup failed:", error instanceof Error ? error.message : error);
    });
    process.exit(code);
  };
  for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK"] as const) process.on(signal, () => void cleanup(0));
  next.on("exit", (code) => void cleanup(code ?? 1));
}

async function main(): Promise<void> {
  console.log(`e2e: administrator connection to host ${new URL(adminUrl()).hostname}`);
  const resources = await createEphemeral();
  try {
    const world = await buildWorld(resources.owner, resources.ownerUrl, {
      database: resources.database,
      login: resources.login,
    });
    writeFileSync(WORLD_FILE, JSON.stringify(world), { mode: 0o600 });
  } catch (error) {
    await dropEphemeral(resources);
    throw error;
  }
  installCleanup(resources, startNext(resources.appUrl));
}

main().catch((error: unknown) => {
  console.error("e2e server failed to start:", error instanceof Error ? error.message : error);
  process.exit(1);
});
