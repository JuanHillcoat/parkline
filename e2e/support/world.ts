/**
 * The synthetic world every end-to-end run starts from, and the typed reader of the file the
 * launcher writes (`e2e/.world.json`, git-ignored). The file holds the run's random passwords
 * and the owner connection of the ephemeral database; it never leaves the machine.
 * This module only uses Node built-ins so Playwright, the launcher and the specs can all load it.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pickPort, pickStateDir } from "./names";

export const E2E_PORT = pickPort(process.env);
export const BASE_URL = `http://localhost:${String(E2E_PORT)}`;
/** Per-run files live in `E2E_STATE_DIR` when set, so parallel runs never share a world or a session. */
export const STATE_DIR = pickStateDir(process.env, resolve(import.meta.dirname, ".."));
export const WORLD_FILE = resolve(STATE_DIR, ".world.json");
export const AUTH_DIR = resolve(STATE_DIR, ".auth");

export const ROLE_KEYS = ["admin", "fleet_analyst", "viewer", "manager", "supervisor"] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export type WorldUser = { readonly email: string; readonly displayName: string };

export const WORLD_USERS: Readonly<Record<RoleKey, WorldUser>> = {
  admin: { email: "admin@e2e.test", displayName: "Admin E2E" },
  fleet_analyst: { email: "analyst@e2e.test", displayName: "Analyst E2E" },
  viewer: { email: "viewer@e2e.test", displayName: "Viewer E2E" },
  manager: { email: "manager@e2e.test", displayName: "Manager E2E" },
  supervisor: { email: "supervisor@e2e.test", displayName: "Supervisor E2E" },
};

/** Names are stored in uppercase by the application, so the constants are already uppercase. */
export const WORLD_ORG = {
  tenantName: "TENANT E2E",
  division: "DIVISION E2E",
  site: "SITE E2E",
  operation: "OPERATION E2E",
  costCenter: "9000",
} as const;

export type WorldFile = {
  /** Names of the cluster resources of this run, so the Playwright teardown can drop them. */
  readonly resources: { readonly database: string; readonly login: string };
  /** Owner connection to the ephemeral database; used by `data.ts` only. */
  readonly ownerUrl: string;
  readonly passwords: Readonly<Record<RoleKey, string>>;
  readonly ids: {
    readonly tenant: string;
    readonly division: string;
    readonly site: string;
    readonly operation: string;
  };
};

export function readWorld(): WorldFile {
  return JSON.parse(readFileSync(WORLD_FILE, "utf8")) as WorldFile;
}

export const passwordOf = (role: RoleKey): string => readWorld().passwords[role];

export const storageStatePath = (role: RoleKey): string => resolve(AUTH_DIR, `${role}.json`);
