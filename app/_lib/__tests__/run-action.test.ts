import { beforeEach, describe, expect, it, vi } from "vitest";
import { err, ok } from "../../../src/shared/domain/result";
import { ValidationError } from "../../../src/shared/domain/domain-error";

const session = vi.hoisted(() => ({ originAllowed: vi.fn(), currentActor: vi.fn(), requireActor: vi.fn() }));
const navigation = vi.hoisted(() => ({
  redirect: vi.fn((path: string): never => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  }),
}));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));

vi.mock("../session", () => session);
vi.mock("next/navigation", () => navigation);
vi.mock("next/cache", () => cache);

import { runMutation } from "../run-action";
import { GENERIC_ERROR, REJECTED_REQUEST } from "../messages";

const actor = { user: { id: "user-1" }, assignments: [] };

describe("runMutation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    session.originAllowed.mockResolvedValue(true);
    session.currentActor.mockResolvedValue(actor);
    // Mirror the real `requireActor` so the test also covers the pre-fix call shape.
    session.requireActor.mockImplementation(async () => {
      const current: unknown = await session.currentActor();
      if (current === null) navigation.redirect("/login");
      return current;
    });
  });

  it("rejects a request whose origin is not allowed, without authenticating", async () => {
    session.originAllowed.mockResolvedValue(false);
    const state = await runMutation("/users", () => Promise.resolve(ok(undefined)));
    expect(state).toEqual({ status: "error", message: REJECTED_REQUEST });
    expect(session.currentActor).not.toHaveBeenCalled();
  });

  it("returns the generic error, never throwing, when re-authentication hits an infrastructure failure", async () => {
    session.currentActor.mockRejectedValue(new Error("connection reset"));
    const mutation = vi.fn();
    const state = await runMutation("/users", mutation);
    expect(state).toEqual({ status: "error", message: GENERIC_ERROR });
    expect(mutation).not.toHaveBeenCalled();
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("redirects to the login page when there is no valid session", async () => {
    session.currentActor.mockResolvedValue(null);
    await expect(runMutation("/users", vi.fn())).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("returns a safe message for a domain error and does not revalidate", async () => {
    const state = await runMutation("/users", () =>
      Promise.resolve(err(new ValidationError("A reason is required"))),
    );
    expect(state.status).toBe("error");
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("returns the generic error when the use case throws an infrastructure failure", async () => {
    const state = await runMutation("/users", () => Promise.reject(new Error("db down")));
    expect(state).toEqual({ status: "error", message: GENERIC_ERROR });
  });

  it("revalidates the path and reports success when the use case succeeds", async () => {
    const state = await runMutation("/users", () => Promise.resolve(ok(undefined)));
    expect(state).toEqual({ status: "success" });
    expect(cache.revalidatePath).toHaveBeenCalledWith("/users");
  });
});
