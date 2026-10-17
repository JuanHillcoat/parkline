import type { AuditLog } from "../../../shared/domain/ports/audit-log";
import type {
  BusinessUnitRepository,
  OperationRepository,
  OperationSiteRepository,
  SiteRepository,
} from "./repositories";

/** Everything an organization use case touches inside one unit of work. */
export type OrganizationTx = {
  readonly businessUnits: BusinessUnitRepository;
  readonly operations: OperationRepository;
  readonly sites: SiteRepository;
  readonly links: OperationSiteRepository;
  readonly audit: AuditLog;
};
