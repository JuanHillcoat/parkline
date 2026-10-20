import { nameKey } from "../../shared/domain/catalog-name";

// A fixed locale: `localeCompare` without one depends on the runtime's default ICU data.
const collator = new Intl.Collator("en");

type Named = { readonly id: string; readonly name: string };
type Coded = { readonly id: string; readonly internalCode: string };

const byText = (a: string, b: string, idA: string, idB: string): number =>
  collator.compare(nameKey(a), nameKey(b)) || collator.compare(a, b) || collator.compare(idA, idB);

/** The list order of suppliers and asset types: by name key (accents folded), then the name, then id. */
export const compareByName = (a: Named, b: Named): number => byText(a.name, b.name, a.id, b.id);

/** The list order of equipment: by internal code key, then the code, then id. */
export const compareByCode = (a: Coded, b: Coded): number => byText(a.internalCode, b.internalCode, a.id, b.id);
