import type { Role } from "./role";

export const PERMISSIONS = [
  "user.read",
  "user.create",
  "user.deactivate",
  "role.assign",
  "audit.read",
  "catalog.write",
  "catalog.read",
  "catalog.archive",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  // Archiving catalog rows belongs to the fleet sector, not to the systems administrator.
  admin: PERMISSIONS.filter((permission) => permission !== "catalog.archive"),
  manager: ["user.read", "audit.read", "catalog.read"],
  fleet_analyst: ["catalog.read", "catalog.write", "catalog.archive"],
  supervisor: ["catalog.read"],
  viewer: ["catalog.read"],
};

export const roleGrants = (role: Role, permission: Permission): boolean =>
  ROLE_PERMISSIONS[role].includes(permission);
