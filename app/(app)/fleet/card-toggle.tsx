"use client";

import { useRef, useState } from "react";
import { copy } from "../../_lib/copy";

const t = copy.fleet.card;

/**
 * On a phone a fleet row is a compact card; this button covers its header and shows or hides the other fields.
 * It marks its row with `data-expanded`, which the stylesheet reads. Above 640px it is not displayed.
 */
export function CardToggle({ name }: { readonly name: string }) {
  const button = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);

  const toggle = () => {
    const next = !expanded;
    button.current?.closest("tr")?.setAttribute("data-expanded", String(next));
    setExpanded(next);
  };

  return (
    <button ref={button} type="button" className="card-toggle" aria-expanded={expanded} aria-label={expanded ? t.hide(name) : t.show(name)} onClick={toggle}>
      <span className="card-toggle-icon" aria-hidden="true" />
    </button>
  );
}
