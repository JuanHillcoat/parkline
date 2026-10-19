import type { DomainError } from "../../../shared/domain/domain-error";
import type { Result } from "../../../shared/domain/result";
import type { Site } from "../../domain/entities";
import { siteSubject } from "../archive-subjects";
import { changeArchive, type ArchiveInput } from "../archiving";
import type { OrganizationDeps } from "../deps";

/** Restores (D4) a site: needs `catalog.archive` at the row's position (D2) and a mandatory reason. */
export class RestoreSite {
  constructor(private readonly deps: OrganizationDeps) {}

  execute(input: ArchiveInput): Promise<Result<Site, DomainError>> {
    return changeArchive(this.deps, siteSubject, "restore", input);
  }
}
