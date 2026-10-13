import { parseRole } from "../domain/role";
import type { RoleAssignment } from "../domain/role-assignment";
import type { ScopeType } from "../domain/scope";
import type { Session } from "../domain/session";
import type { User } from "../domain/user";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lets adapters answer "not found" for a malformed id instead of a cast error. */
export const isUuid = (value: string): boolean => UUID.test(value);

const SCOPE_TYPES: readonly string[] = ["tenant", "business_unit", "operation", "site"];

export type UserRow = {
  id: string;
  tenant_id: string;
  email: string;
  display_name: string;
  active: boolean;
};

export type AssignmentRow = {
  user_id: string;
  role: string;
  scope_type: string;
  scope_id: string;
  active: boolean;
};

export type SessionRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  token_hash: string;
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
};

export const toUser = (row: UserRow): User => ({
  id: row.id,
  tenantId: row.tenant_id,
  email: row.email,
  displayName: row.display_name,
  active: row.active,
});

/** A stored value outside the domain vocabulary is data corruption, so it throws. */
export const toAssignment = (row: AssignmentRow): RoleAssignment => {
  const role = parseRole(row.role);
  if (!role.ok) throw role.error;
  if (!SCOPE_TYPES.includes(row.scope_type)) throw new Error(`Unknown scope type ${row.scope_type}`);
  const scope = { type: row.scope_type as ScopeType, id: row.scope_id };
  return { userId: row.user_id, role: role.value, scope, active: row.active };
};

export const toSession = (row: SessionRow): Session => ({
  id: row.id,
  tenantId: row.tenant_id,
  userId: row.user_id,
  tokenHash: row.token_hash,
  createdAt: row.created_at,
  lastSeenAt: row.last_seen_at,
  expiresAt: row.expires_at,
  revokedAt: row.revoked_at,
});
