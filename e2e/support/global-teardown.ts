/**
 * Playwright global teardown. Drops the run's database and login by the names in the world
 * file. The launcher does the same on a clean exit; this covers platforms where Playwright
 * stops the web server without letting it run its signal handlers (Windows).
 */
import { existsSync, rmSync } from "node:fs";
import { dropResources, openAdmin } from "./database";
import { WORLD_FILE, readWorld } from "./world";

export default async function globalTeardown(): Promise<void> {
  if (!existsSync(WORLD_FILE)) return;
  const { resources } = readWorld();
  const admin = openAdmin();
  try {
    await dropResources(admin, resources.database, resources.login);
  } finally {
    await admin.end({ timeout: 2 });
    rmSync(WORLD_FILE, { force: true });
  }
}
