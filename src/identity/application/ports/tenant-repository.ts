import type { Tenant } from "../../domain/tenant";

export interface TenantRepository {
  /** The single installed tenant (decision D5), or null before install. */
  findSingle(): Promise<Tenant | null>;
  add(tenant: Tenant): Promise<void>;
}
