"use client";

import { useId, useState, type ReactNode } from "react";
import { fieldCls } from "@/components/ui";

// defaultValue : valeur par défaut d'une liste sans option « Tous » (période…) ; à cette valeur, la liste n'est ni surlignée ni comptée comme filtre actif
export type FilterSelect = { name: string; label: string; options: { value: string; label: string }[]; allLabel?: string; defaultValue?: string };

const labelCls = "block text-xs font-semibold text-fg-muted";
const inputCls = `mt-1 h-10 ${fieldCls}`;
// Champ actif : bordure et fond d'accent, repérable d'un coup d'œil (la valeur reste écrite dans la liste)
const activeCls = "border-primary! bg-primary-soft!";
const toggleCls =
  "inline-flex h-10 w-full items-center justify-between gap-2 rounded-control border border-line-strong bg-surface px-3 text-sm font-medium text-fg transition-colors hover:bg-surface-3 active:translate-y-px aria-expanded:bg-surface-2";
// À partir de lg, les champs partagent une ligne (flex) avec les boutons ; en dessous, grille de FilterForm
const filterItemCls = "min-w-0 lg:max-w-64 lg:flex-[1_1_10rem]";

function Chevron({ open }: { open: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

const actifs = (n: number) => (n > 0 ? ` (${n} actif${n > 1 ? "s" : ""})` : "");

// Sous 640 px, à partir de deux listes : listes et boutons repliés derrière un seul bouton « Afficher les filtres (n actifs) » ;
// avec un champ de recherche (keepActions), les boutons restent visibles pour lancer la recherche.
// Filtres secondaires derrière « Plus de filtres », ouverts d'office si l'un d'eux est actif.
// Les listes masquées restent dans le formulaire : leur valeur est toujours envoyée.
export function FilterFields({
  fields,
  values,
  advanced = [],
  actions,
  keepActions = false,
}: {
  fields: FilterSelect[];
  values: Record<string, string>;
  advanced?: string[];
  actions?: ReactNode;
  keepActions?: boolean;
}) {
  const id = useId();
  const isActive = (f: FilterSelect) => (values[f.name] ?? "") !== (f.defaultValue ?? "");
  const main = fields.filter((f) => !advanced.includes(f.name));
  const more = fields.filter((f) => advanced.includes(f.name));
  const moreActive = more.filter(isActive).length;
  const collapsible = fields.length > 1;
  const [mobileOpen, setMobileOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(moreActive > 0);
  const listsShown = !collapsible || mobileOpen;

  const select = (f: FilterSelect) => (
    <div key={f.name} className={filterItemCls}>
      <label htmlFor={`f-${f.name}`} className={labelCls}>
        {f.label}
      </label>
      <select id={`f-${f.name}`} name={f.name} defaultValue={values[f.name] ?? ""} className={`${inputCls} ${isActive(f) ? activeCls : ""}`}>
        {f.allLabel !== undefined && <option value="">{f.allLabel}</option>}
        {f.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <>
      {collapsible && (
        <div className="col-span-full sm:hidden">
          <button
            type="button"
            aria-expanded={mobileOpen}
            aria-controls={actions && !keepActions ? `${id}-listes ${id}-actions` : `${id}-listes`}
            onClick={() => setMobileOpen((o) => !o)}
            className={toggleCls}
          >
            <span>
              {mobileOpen ? "Masquer les filtres" : "Afficher les filtres"}
              {actifs(fields.filter(isActive).length)}
            </span>
            <Chevron open={mobileOpen} />
          </button>
        </div>
      )}
      <div id={`${id}-listes`} className={`${listsShown ? "grid" : "hidden"} col-span-full grid-cols-1 gap-y-3 sm:contents`}>
        {main.map(select)}
        {more.length > 0 && (
          <div className={`flex items-end ${filterItemCls}`}>
            <button type="button" aria-expanded={moreOpen} aria-controls={`${id}-plus`} onClick={() => setMoreOpen((o) => !o)} className={toggleCls}>
              <span>
                {moreOpen ? "Moins de filtres" : "Plus de filtres"}
                {actifs(moreActive)}
              </span>
              <Chevron open={moreOpen} />
            </button>
          </div>
        )}
        {more.length > 0 && (
          <div id={`${id}-plus`} className={moreOpen ? "contents" : "hidden"}>
            {more.map(select)}
          </div>
        )}
      </div>
      {actions && (
        <div id={`${id}-actions`} className={`${listsShown || keepActions ? "flex" : "hidden sm:flex"} col-span-full flex-wrap items-end justify-end gap-2 lg:ml-auto`}>
          {actions}
        </div>
      )}
    </>
  );
}
