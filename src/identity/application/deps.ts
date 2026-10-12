import type { Clock } from "../../shared/domain/ports/clock";
import type { IdGenerator } from "../../shared/domain/ports/id-generator";
import type { UnitOfWork } from "../../shared/domain/ports/unit-of-work";
import type { SessionPolicy } from "../domain/session";
import type { IdentityTx } from "./ports/identity-tx";
import type { PasswordHasher } from "./ports/password-hasher";
import type { SessionTokenService } from "./ports/session-token-service";

export type IdentityDeps = {
  readonly unitOfWork: UnitOfWork<IdentityTx>;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly hasher: PasswordHasher;
  readonly tokens: SessionTokenService;
  readonly policy: SessionPolicy;
};
