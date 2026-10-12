import type { RoleAssignmentRepository } from "../application/ports/role-assignment-repository";
import type { SessionRepository } from "../application/ports/session-repository";
import type { TenantRepository } from "../application/ports/tenant-repository";
import type { StoredUser, UserRepository } from "../application/ports/user-repository";
import type { RoleAssignment } from "../domain/role-assignment";
import type { Session } from "../domain/session";
import type { Tenant } from "../domain/tenant";
import type { User } from "../domain/user";

export type StoredAssignment = { readonly tenantId: string; assignment: RoleAssignment };

/** The data of one in-memory identity database. A transaction works on a copy. */
export type IdentityState = {
  tenants: Tenant[];
  users: StoredUser[];
  assignments: StoredAssignment[];
  sessions: Session[];
};

export const emptyState = (): IdentityState => ({
  tenants: [],
  users: [],
  assignments: [],
  sessions: [],
});

export class InMemoryTenantRepository implements TenantRepository {
  constructor(private readonly state: IdentityState) {}

  findSingle(): Promise<Tenant | null> {
    return Promise.resolve(this.state.tenants[0] ?? null);
  }

  /** Nothing to serialize in memory: use cases run one at a time per store. */
  lockForInstall(): Promise<void> {
    return Promise.resolve();
  }

  add(tenant: Tenant): Promise<void> {
    this.state.tenants.push(tenant);
    return Promise.resolve();
  }
}

export class InMemoryUserRepository implements UserRepository {
  constructor(private readonly state: IdentityState) {}

  findById(tenantId: string, id: string): Promise<User | null> {
    const found = this.state.users.find((s) => s.user.tenantId === tenantId && s.user.id === id);
    return Promise.resolve(found?.user ?? null);
  }

  findByEmail(tenantId: string, email: string): Promise<StoredUser | null> {
    const found = this.state.users.find((s) => s.user.tenantId === tenantId && s.user.email === email);
    return Promise.resolve(found ?? null);
  }

  add(user: User, passwordHash: string): Promise<boolean> {
    const sameId = this.state.users.some((s) => s.user.id === user.id);
    if (sameId) return Promise.reject(new Error("unique violation on users"));
    const taken = this.state.users.some((s) => s.user.tenantId === user.tenantId && s.user.email === user.email);
    if (taken) return Promise.resolve(false);
    this.state.users.push({ user, passwordHash });
    return Promise.resolve(true);
  }

  setActive(tenantId: string, id: string, active: boolean): Promise<void> {
    const index = this.state.users.findIndex((s) => s.user.tenantId === tenantId && s.user.id === id);
    const current = this.state.users[index];
    if (current) this.state.users[index] = { ...current, user: { ...current.user, active } };
    return Promise.resolve();
  }
}

const sameKey = (a: RoleAssignment, b: RoleAssignment): boolean =>
  a.userId === b.userId && a.role === b.role && a.scope.type === b.scope.type && a.scope.id === b.scope.id;

export class InMemoryRoleAssignmentRepository implements RoleAssignmentRepository {
  constructor(private readonly state: IdentityState) {}

  listActiveByUser(tenantId: string, userId: string): Promise<readonly RoleAssignment[]> {
    const own = this.state.assignments.filter(
      (s) => s.tenantId === tenantId && s.assignment.userId === userId && s.assignment.active,
    );
    return Promise.resolve(own.map((s) => s.assignment));
  }

  add(tenantId: string, assignment: RoleAssignment): Promise<void> {
    const exists = this.state.assignments.some(
      (s) => s.tenantId === tenantId && s.assignment.active && sameKey(s.assignment, assignment),
    );
    if (exists) return Promise.reject(new Error("unique violation on active assignments"));
    this.state.assignments.push({ tenantId, assignment });
    return Promise.resolve();
  }

  deactivate(tenantId: string, assignment: RoleAssignment): Promise<void> {
    for (const stored of this.state.assignments) {
      if (stored.tenantId === tenantId && stored.assignment.active && sameKey(stored.assignment, assignment)) {
        stored.assignment = { ...stored.assignment, active: false };
      }
    }
    return Promise.resolve();
  }

  countActiveAdminUsers(tenantId: string): Promise<number> {
    const activeUsers = new Set(
      this.state.users.filter((s) => s.user.tenantId === tenantId && s.user.active).map((s) => s.user.id),
    );
    const admins = this.state.assignments.filter(
      (s) =>
        s.tenantId === tenantId &&
        s.assignment.active &&
        s.assignment.role === "admin" &&
        activeUsers.has(s.assignment.userId),
    );
    return Promise.resolve(new Set(admins.map((s) => s.assignment.userId)).size);
  }
}

export class InMemorySessionRepository implements SessionRepository {
  constructor(private readonly state: IdentityState) {}

  add(session: Session): Promise<void> {
    this.state.sessions.push(session);
    return Promise.resolve();
  }

  findByTokenHash(tokenHash: string): Promise<Session | null> {
    return Promise.resolve(this.state.sessions.find((s) => s.tokenHash === tokenHash) ?? null);
  }

  touch(tenantId: string, id: string, lastSeenAt: Date): Promise<void> {
    return this.update((s) => s.tenantId === tenantId && s.id === id, { lastSeenAt });
  }

  revoke(tenantId: string, id: string, at: Date): Promise<void> {
    return this.update((s) => s.tenantId === tenantId && s.id === id && s.revokedAt === null, { revokedAt: at });
  }

  revokeAllForUser(tenantId: string, userId: string, at: Date): Promise<void> {
    const open = (s: Session): boolean => s.tenantId === tenantId && s.userId === userId && s.revokedAt === null;
    return this.update(open, { revokedAt: at });
  }

  private update(match: (session: Session) => boolean, change: Partial<Session>): Promise<void> {
    this.state.sessions = this.state.sessions.map((s) => (match(s) ? { ...s, ...change } : s));
    return Promise.resolve();
  }
}
