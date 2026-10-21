import type { ReactNode } from "react";
import { copy } from "../../_lib/copy";
import { fleetHref, pageWindow, type EquipmentFilters, type FleetQuery, type FleetTab, type Option, type Page } from "../../_lib/fleet-view";

const t = copy.fleet;

type TabsProps = { readonly active: FleetTab; readonly archived: boolean; readonly counts: Readonly<Record<FleetTab, number>> };

const TAB_LABELS: readonly (readonly [FleetTab, string])[] = [
  ["equipment", t.tabs.equipment],
  ["suppliers", t.tabs.suppliers],
  ["asset-types", t.tabs.assetTypes],
];

/** Tabs are plain links: the server renders the active one from the query string. */
export function FleetTabs({ active, archived, counts }: TabsProps) {
  return (
    <nav className="tabs" aria-label={t.tabsLabel}>
      {TAB_LABELS.map(([tab, label]) => (
        <a key={tab} className="tab" href={fleetHref({ tab, archived })} aria-current={tab === active ? "page" : undefined}>
          {label} <span className="count-pill">{counts[tab]}</span>
        </a>
      ))}
    </nav>
  );
}

type SelectProps = { id: string; name: string; label: string; all: string; options: readonly Option[]; value: string | null };

function FilterSelect(props: SelectProps) {
  return (
    <div className="field">
      <label htmlFor={props.id}>{props.label}</label>
      <select id={props.id} name={props.name} className="input" defaultValue={props.value ?? ""}>
        <option value="">{props.all}</option>
        {props.options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
      </select>
    </div>
  );
}

type ToolbarProps = {
  readonly filters: EquipmentFilters;
  readonly archived: boolean;
  readonly suppliers: readonly Option[];
  readonly types: readonly Option[];
};

const isFiltered = (f: EquipmentFilters): boolean => f.q !== "" || f.supplierId !== null || f.typeId !== null;

/** A GET form: submitting it rebuilds the query string and returns to the first page. */
export function EquipmentToolbar({ filters, archived, suppliers, types }: ToolbarProps) {
  return (
    <form className="toolbar" method="get" action="/fleet" role="search">
      {archived && <input type="hidden" name="archived" value="1" />}
      <div className="field toolbar-search">
        <label htmlFor="fleet-q">{t.searchLabel}</label>
        <input id="fleet-q" name="q" type="search" className="input" defaultValue={filters.q}
          placeholder={t.searchPlaceholder} autoComplete="off" />
      </div>
      <FilterSelect id="fleet-supplier" name="supplier" label={t.supplierFilter} all={t.allSuppliers}
        options={suppliers} value={filters.supplierId} />
      <FilterSelect id="fleet-type" name="type" label={t.typeFilter} all={t.allTypes}
        options={types} value={filters.typeId} />
      <div className="toolbar-actions">
        <button type="submit" className="btn btn-primary">{t.applyFilters}</button>
        {isFiltered(filters) && <a className="btn" href={fleetHref({ archived })}>{t.clearFilters}</a>}
      </div>
    </form>
  );
}

type LinkProps = { query: FleetQuery; target: number; current?: boolean; children: ReactNode };

function PageLink({ query, target, current, children }: LinkProps) {
  return (
    <a className="page-link" href={fleetHref({ ...query, page: target })} aria-current={current === true ? "page" : undefined}>
      {children}
    </a>
  );
}

/** "Mostrando X a Y de N" plus previous, numbered and next links that keep the other params. */
export function Pagination({ page, query }: { readonly page: Page<unknown>; readonly query: FleetQuery }) {
  return (
    <div className="pagination">
      <p className="hint" role="status">{t.showing(page.from, page.to, page.total)}</p>
      {page.pages > 1 && (
        <nav aria-label={t.paginationLabel} className="page-links">
          {page.page > 1 && <PageLink query={query} target={page.page - 1}>{t.previousPage}</PageLink>}
          {pageWindow(page.page, page.pages).map((number) => (
            <PageLink key={number} query={query} target={number} current={number === page.page}>
              <span className="visually-hidden">{t.pageLink(number)}</span>
              <span aria-hidden="true">{number}</span>
            </PageLink>
          ))}
          {page.page < page.pages && <PageLink query={query} target={page.page + 1}>{t.nextPage}</PageLink>}
        </nav>
      )}
    </div>
  );
}
