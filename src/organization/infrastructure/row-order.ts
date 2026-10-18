import { nameKey } from "../domain/name";

type Named = { readonly id: string; readonly name: string };

// A fixed locale: `localeCompare` without one depends on the runtime's default ICU data.
const collator = new Intl.Collator("en");

/** The list order of every organization repository: by name key, then id. */
export const compareByName = (a: Named, b: Named): number =>
  collator.compare(nameKey(a.name), nameKey(b.name)) || collator.compare(a.id, b.id);
