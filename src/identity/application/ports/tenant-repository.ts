import type { Tenant } from "../../domain/tenant";

export interface TenantRepository {
  /** The single installed tenant (decision D5), or null before install. */
  findSingle(): Promise<Tenant | null>;
  /**
   * Serializes concurrent installs until the transaction ends, so two installs
   * cannot both see no tenant and both create one.
   */
  lockForInstall(): Promise<void>;
  add(tenant: Tenant): Promise<void>;
}
