import type { AccessPolicy } from "../../shared/domain/ports/access-policy";
import type { Clock } from "../../shared/domain/ports/clock";
import type { IdGenerator } from "../../shared/domain/ports/id-generator";
import type { UnitOfWork } from "../../shared/domain/ports/unit-of-work";
import type { MeteringTx } from "./ports/metering-tx";

/** What building a row and its audit entry needs: the clock and the id generator. */
export type CoreDeps = Pick<MeteringDeps, "clock" | "ids">;

export type MeteringDeps = {
  readonly unitOfWork: UnitOfWork<MeteringTx>;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  /** Cross-module authorization (ADR-0005); implemented by identity, wired by the container. */
  readonly accessPolicy: AccessPolicy;
};
