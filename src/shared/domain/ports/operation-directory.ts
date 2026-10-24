/**
 * What another module needs to know about an operation: where it sits in the hierarchy and
 * whether it can still receive work. `archivedAt` is set when the operation is archived, and
 * implementers also report it when its site or its division is archived.
 */
export type OperationInfo = {
  readonly id: string;
  readonly businessUnitId: string;
  readonly siteId: string;
  readonly archivedAt: Date | null;
};

/**
 * Lets a module that attaches records to operations (fleet assignments) read them without importing
 * the organization module (ADR-0005). Every query is scoped by tenant; an operation of another
 * tenant is never visible, exactly like a missing one.
 */
export interface OperationDirectory {
  find(tenantId: string, operationId: string): Promise<OperationInfo | null>;
}
