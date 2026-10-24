import type { AssignmentDirectory } from "../../../shared/domain/ports/assignment-directory";
import type { AuditLog } from "../../../shared/domain/ports/audit-log";
import type {
  BusinessUnitRepository,
  OperationRepository,
  SiteRepository,
} from "./repositories";

/** Everything an organization use case touches inside one unit of work. */
export type OrganizationTx = {
  readonly businessUnits: BusinessUnitRepository;
  readonly operations: OperationRepository;
  readonly sites: SiteRepository;
  /** Counts the open equipment assignments of an operation through the shared kernel; fleet implements it. */
  readonly assignments: AssignmentDirectory;
  readonly audit: AuditLog;
};
