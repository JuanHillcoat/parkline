import type { AssignmentDirectory } from "../../../shared/domain/ports/assignment-directory";

/**
 * Test double of the shared `AssignmentDirectory`. The organization module must not import fleet, so it
 * tests against this fake: a test declares how many open assignments an operation has.
 */
export class FakeAssignmentDirectory implements AssignmentDirectory {
  private readonly open = new Map<string, number>();

  setOpen(tenantId: string, operationId: string, count: number): void {
    this.open.set(`${tenantId}:${operationId}`, count);
  }

  countOpen(tenantId: string, operationId: string): Promise<number> {
    return Promise.resolve(this.open.get(`${tenantId}:${operationId}`) ?? 0);
  }
}
