import { nameKey } from "../domain/name";

type Named = { readonly id: string; readonly name: string };

/** The list order of every organization repository: by name key, then id. */
export const compareByName = (a: Named, b: Named): number =>
  nameKey(a.name).localeCompare(nameKey(b.name)) || a.id.localeCompare(b.id);
