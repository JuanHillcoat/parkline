/**
 * Lets a module that owns operations (organization) ask about the equipment assignments that point at
 * them without importing the fleet module (ADR-0005). Every query is scoped by tenant; an operation of
 * another tenant counts zero, exactly like an unknown one.
 */
export interface AssignmentDirectory {
  /** How many assignments of the operation are open (`valid_to` is null). */
  countOpen(tenantId: string, operationId: string): Promise<number>;
}
