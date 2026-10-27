import type { OperationDirectory, OperationInfo, SiteInfo } from "../../../shared/domain/ports/operation-directory";

type Stored = OperationInfo & { readonly tenantId: string };

/**
 * Test double of the shared `OperationDirectory`. The fleet module must not import organization, so it
 * tests against this fake. An operation of another tenant is invisible, like a missing one.
 */
export class FakeOperationDirectory implements OperationDirectory {
  private readonly rows: Stored[] = [];
  private readonly sites: (SiteInfo & { readonly tenantId: string })[] = [];

  addSite(row: SiteInfo & { readonly tenantId: string }): void {
    this.sites.push(row);
  }

  archiveSite(siteId: string, at: Date): void {
    const index = this.sites.findIndex((row) => row.id === siteId);
    const current = this.sites[index];
    if (current !== undefined) this.sites[index] = { ...current, archivedAt: at };
  }

  findSite(tenantId: string, siteId: string): Promise<SiteInfo | null> {
    const row = this.sites.find((r) => r.tenantId === tenantId && r.id === siteId);
    return Promise.resolve(row ? { id: row.id, archivedAt: row.archivedAt } : null);
  }

  add(row: Stored): void {
    this.rows.push(row);
  }

  archive(operationId: string, at: Date): void {
    const index = this.rows.findIndex((row) => row.id === operationId);
    const current = this.rows[index];
    if (current !== undefined) this.rows[index] = { ...current, archivedAt: at };
  }

  find(tenantId: string, operationId: string): Promise<OperationInfo | null> {
    const row = this.rows.find((r) => r.tenantId === tenantId && r.id === operationId);
    return Promise.resolve(row ? { id: row.id, businessUnitId: row.businessUnitId, siteId: row.siteId, archivedAt: row.archivedAt } : null);
  }
}
