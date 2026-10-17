import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActorContext } from "../../src/identity/application/actor-context";
import type { DomainError } from "../../src/shared/domain/domain-error";
import type { Result } from "../../src/shared/domain/result";
import { failure, type ActionState } from "./action-state";
import { GENERIC_ERROR, REJECTED_REQUEST, errorMessage } from "./messages";
import { currentActor, originAllowed } from "./session";

type Mutation = (actor: ActorContext) => Promise<Result<unknown, DomainError>>;

type Authentication =
  | { readonly kind: "actor"; readonly actor: ActorContext }
  | { readonly kind: "anonymous" }
  | { readonly kind: "failed" };

/**
 * Re-authenticates from the cookie. An infrastructure failure is logged and
 * reported as `failed`; it must not escape the server action. The redirect for
 * an anonymous caller is issued by the caller, outside any try/catch.
 */
const authenticate = async (): Promise<Authentication> => {
  try {
    const actor = await currentActor();
    return actor === null ? { kind: "anonymous" } : { kind: "actor", actor };
  } catch (error: unknown) {
    console.error("Authentication failed", error);
    return { kind: "failed" };
  }
};

const execute = async (path: string, mutation: Mutation, actor: ActorContext): Promise<ActionState> => {
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

/**
 * Runs one server action: Origin check, fresh authentication from the cookie,
 * the use case, and a safe message for every failure. Infrastructure
 * exceptions are logged here and never shown.
 */
export const runMutation = async (path: string, mutation: Mutation): Promise<ActionState> => {
  if (!(await originAllowed())) return failure(REJECTED_REQUEST);
  const auth = await authenticate();
  if (auth.kind === "failed") return failure(GENERIC_ERROR);
  if (auth.kind === "anonymous") redirect("/login");
  return execute(path, mutation, auth.actor);
};
