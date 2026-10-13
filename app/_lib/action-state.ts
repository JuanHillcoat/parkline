export type ActionState =
  | { readonly status: "idle" }
  | { readonly status: "success" }
  | { readonly status: "error"; readonly message: string };

export const IDLE: ActionState = { status: "idle" };

export const failure = (message: string): ActionState => ({ status: "error", message });

/** Reads a text field from a form; anything else becomes an empty string. */
export const field = (form: FormData, name: string): string => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};
