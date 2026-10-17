import type { User } from "../../domain/user";

export type StoredUser = { readonly user: User; readonly passwordHash: string };

/** Every lookup is scoped by `tenantId`: a user of another tenant is never found. */
export interface UserRepository {
  findById(tenantId: string, id: string): Promise<User | null>;
  /** `email` must already be normalized. */
  findByEmail(tenantId: string, email: string): Promise<StoredUser | null>;
  /** Returns false, without writing, when the email is already taken in the tenant. */
  add(user: User, passwordHash: string): Promise<boolean>;
  setActive(tenantId: string, id: string, active: boolean): Promise<void>;
  /** Every user of the tenant, ordered by display name (case-insensitive) then id. Never returns hashes. */
  listByTenant(tenantId: string): Promise<readonly User[]>;
}
