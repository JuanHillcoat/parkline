import type { Role } from "./role";

export const PERMISSIONS = [
  "user.read",
  "user.create",
  "user.deactivate",
  "role.assign",
  "audit.read",
  "catalog.write",
  "catalog.read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  admin: PERMISSIONS,
  manager: ["user.read", "audit.read", "catalog.read"],
  fleet_analyst: ["catalog.read", "catalog.write"],
  supervisor: ["catalog.read"],
  viewer: ["catalog.read"],
};

export const roleGrants = (role: Role, permission: Permission): boolean =>
  ROLE_PERMISSIONS[role].includes(permission);
