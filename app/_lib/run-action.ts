import { revalidatePath } from "next/cache";
import type { ActorContext } from "../../src/identity/application/actor-context";
import type { DomainError } from "../../src/shared/domain/domain-error";
import type { Result } from "../../src/shared/domain/result";
import { failure, type ActionState } from "./action-state";
import { GENERIC_ERROR, REJECTED_REQUEST, errorMessage } from "./messages";
import { originAllowed, requireActor } from "./session";

type Mutation = (actor: ActorContext) => Promise<Result<unknown, DomainError>>;

/**
 * Runs one server action: Origin check, fresh authentication from the cookie,
 * the use case, and a safe message for every failure. Infrastructure
 * exceptions are logged here and never shown.
 */
export const runMutation = async (path: string, mutation: Mutation): Promise<ActionState> => {
  if (!(await originAllowed())) return failure(REJECTED_REQUEST);
  const actor = await requireActor();
  try {
    const result = await mutation(actor);
    if (!result.ok) return failure(errorMessage(result.error));
  } catch (error: unknown) {
    console.error("Server action failed", error);
    return failure(GENERIC_ERROR);
  }
  revalidatePath(path);
  return { status: "success" };
};
