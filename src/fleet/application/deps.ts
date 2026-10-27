import type { AccessPolicy } from "../../shared/domain/ports/access-policy";
import type { Clock } from "../../shared/domain/ports/clock";
import type { InitialReadingRecorder } from "../../shared/domain/ports/initial-reading-recorder";
import type { IdGenerator } from "../../shared/domain/ports/id-generator";
import type { UnitOfWork } from "../../shared/domain/ports/unit-of-work";
import type { FleetTx } from "./ports/fleet-tx";

export type FleetDeps = {
  readonly unitOfWork: UnitOfWork<FleetTx>;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  /** Cross-module authorization (ADR-0005); implemented by identity, wired by the container. */
  readonly accessPolicy: AccessPolicy;
  /** Loads the first reading of a new equipment in the same transaction (issue 52); implemented by metering, wired by the container. */
  readonly initialReadings?: InitialReadingRecorder<FleetTx>;
};
