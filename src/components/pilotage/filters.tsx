import Form from "next/form";
import Link from "next/link";
import { Icon, Notice, buttonCls, cardCls, fieldCls, fmt } from "@/components/ui";
import { FilterFields, type FilterSelect } from "./filter-fields";

export type SelectField = FilterSelect;

const labelCls = "block text-xs font-semibold text-fg-muted";
const inputCls = `mt-1 h-10 ${fieldCls}`;

// showReset : « Réinitialiser » seulement quand un filtre diffère des valeurs par défaut.
// advanced : noms des listes secondaires, regroupées derrière « Plus de filtres ».
// À partir de lg : champs et boutons sur une ligne (retour à la ligne si la place manque).
// Sous 640 px : listes et boutons repliés derrière « Afficher les filtres (n actifs) » ; avec une recherche, elle et les boutons restent visibles.
export function FilterForm({
  action,
  fields,
  values,
  search,
  hidden,
  resetHref,
  showReset = true,
  advanced,
}: {
  action: string;
  fields: SelectField[];
  values: Record<string, string | number | undefined>;
  search?: { name: string; label: string; placeholder?: string };
  hidden?: Record<string, string | undefined>;
  resetHref?: string;
  showReset?: boolean;
  advanced?: string[];
}) {
  const selected = Object.fromEntries(fields.map((f) => [f.name, values[f.name] != null ? String(values[f.name]) : ""]));
  return (
    <Form action={action} className={`${cardCls} mb-4 p-3 sm:p-4`} aria-label="Filtres">
      {hidden && Object.entries(hidden).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-end">
        {search && (
          <div className="min-w-0 sm:col-span-2 lg:flex-[2_1_18rem]">
            <label htmlFor={`f-${search.name}`} className={labelCls}>
              {search.label}
            </label>
            <div className="relative">
              <span aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 mt-0.5 -translate-y-1/2 text-fg-subtle">
                <Icon name="search" />
              </span>
              <input
                id={`f-${search.name}`}
                type="search"
                name={search.name}
                defaultValue={values[search.name] ?? ""}
                placeholder={search.placeholder}
                maxLength={100}
                className={`${inputCls} pl-9`}
              />
            </div>
          </div>
        )}
        <FilterFields
          fields={fields}
          values={selected}
          advanced={advanced}
          keepActions={!!search}
          actions={
            <>
              {showReset && (
                <Link href={resetHref ?? action} className={buttonCls.secondary}>
                  <Icon name="refresh" />
                  Réinitialiser les filtres
                </Link>
              )}
              <button type="submit" className={buttonCls.primary}>
                <Icon name="filter" />
                Appliquer les filtres
              </button>
            </>
          }
        />
      </div>
    </Form>
  );
}

const PARAM_LABELS: Record<string, string> = {
  contrat: "contrat",
  age: "tranche d'âge",
  anciennete: "ancienneté",
  departement: "département",
  niveau: "niveau de risque",
  periode: "période",
  manager: "manager",
  q: "recherche",
  tri: "tri",
  ordre: "ordre",
  page: "page",
  granularite: "granularité",
  axe: "axe",
  statut: "statut",
  action: "action",
  mois: "mois",
  type: "type",
  status: "statut",
  severity: "gravité",
};
const paramLabel = (k: string) => PARAM_LABELS[k] ?? k;

function listFr(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} et ${items.at(-1)}`;
}

export type ActiveFilter = { label: string; value: string; removeHref?: string };

// restricted : filtres valides mais non applicables au rôle (vue manager), distingués des valeurs invalides
export function ActiveFilters({
  period,
  filters,
  ignored,
  restricted,
  note,
}: {
  period?: string;
  filters: ActiveFilter[];
  ignored?: string[];
  restricted?: string[];
  note?: string;
}) {
  const invalid = (ignored ?? []).filter((k) => !restricted?.includes(k));
  return (
    <div className="mb-4 space-y-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-sm text-fg-muted" aria-live="polite">
        {period && (
          <p className="mr-3">
            <span className="font-semibold text-fg">Période :</span> {period}
          </p>
        )}
        <span className="font-semibold text-fg">Filtres actifs :</span>
        {filters.length ? (
          <ul className="flex flex-wrap gap-1.5">
            {filters.map((f) => (
              <li
                key={`${f.label}-${f.value}`}
                className="inline-flex min-h-8 animate-pop-in items-center gap-1 rounded-full bg-primary-soft py-0.5 pl-3 pr-1 text-xs text-fg ring-1 ring-inset ring-primary/40"
              >
                <span className="text-fg-muted">{f.label} :</span> <span className="font-semibold">{f.value}</span>
                {f.removeHref ? (
                  <Link
                    href={f.removeHref}
                    className="ml-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full text-link transition-colors hover:bg-primary hover:text-primary-fg active:scale-95"
                  >
                    <Icon name="x" className="h-3.5 w-3.5" />
                    <span className="sr-only">Retirer le filtre {f.label}</span>
                  </Link>
                ) : (
                  <span className="pr-1.5" />
                )}
              </li>
            ))}
          </ul>
        ) : (
          <span>aucun</span>
        )}
        {note && <span className="text-xs">— {note}</span>}
      </div>
      {restricted && restricted.length > 0 && (
        <Notice>
          Filtre{restricted.length > 1 ? "s" : ""} {listFr(restricted.map(paramLabel))} non disponible{restricted.length > 1 ? "s" : ""} dans la vue manager :{" "}
          {restricted.length > 1 ? "ignorés" : "ignoré"} (protection des petits groupes).
        </Notice>
      )}
      {invalid.length > 0 && <Notice tone="warning">Paramètre(s) invalide(s) ignoré(s) : {invalid.map(paramLabel).join(", ")}.</Notice>}
    </div>
  );
}

export function buildHref(path: string, params: Record<string, string | number | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") sp.set(k, String(v));
  const s = sp.toString();
  return s ? `${path}?${s}` : path;
}

function Chevron({ dir }: { dir: "prev" | "next" | "first" | "last" }) {
  const d = { prev: "M10 12 6 8l4-4", next: "m6 12 4-4-4-4", first: "M12 12 8 8l4-4 M6 4v8", last: "m4 12 4-4-4-4 M10 4v8" }[dir];
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

// embedded : pied de carte d'un tableau dont l'en-tête affiche déjà le nombre de résultats
export function Pagination({
  path,
  params,
  page,
  pageCount,
  total,
  embedded = false,
  pageSize,
}: {
  path: string;
  params: Record<string, string | number | undefined>;
  page: number;
  pageCount: number;
  total: number;
  embedded?: boolean;
  // pageSize : affiche la plage « 26–50 sur 1 168 » en plus du numéro de page
  pageSize?: number;
}) {
  const count = (
    <>
      <span className="font-semibold tabular-nums text-fg">{fmt.int(total)}</span> résultat{total > 1 ? "s" : ""}
    </>
  );
  if (pageCount <= 1) return embedded ? null : <p className="mt-3 text-sm text-fg-muted">{count}</p>;
  const LABELS = { first: "Première", prev: "Précédent", next: "Suivant", last: "Dernière" } as const;
  const link = (p: number, dir: keyof typeof LABELS, disabled: boolean) => {
    const label = LABELS[dir];
    const content = dir === "prev" || dir === "first" ? <><Chevron dir={dir} />{label}</> : <>{label}<Chevron dir={dir} /></>;
    return disabled ? (
      <span className={`${buttonCls.secondary} cursor-not-allowed opacity-60`} aria-disabled="true">
        {content}
      </span>
    ) : (
      <Link href={buildHref(path, { ...params, page: p })} className={buttonCls.secondary}>
        {content}
        <span className="sr-only">{dir === "first" || dir === "last" ? " page" : ""} : page {p}</span>
      </Link>
    );
  };
  const ends = pageCount > 3;
  return (
    <nav className={`flex flex-wrap items-center justify-between gap-2 ${embedded ? "" : "mt-3"}`} aria-label="Pagination">
      <p className="text-sm text-fg-muted">
        {!embedded && (
          <>
            {count}
            <span aria-hidden="true" className="mx-1.5 text-fg-subtle">·</span>
          </>
        )}
        {pageSize && (
          <>
            <span className="font-semibold tabular-nums text-fg">
              {fmt.int((page - 1) * pageSize + 1)}–{fmt.int(Math.min(page * pageSize, total))}
            </span>{" "}
            sur <span className="tabular-nums">{fmt.int(total)}</span>
            <span aria-hidden="true" className="mx-1.5 text-fg-subtle">·</span>
          </>
        )}
        Page <span className="font-semibold tabular-nums text-fg">{fmt.int(page)}</span> sur <span className="tabular-nums">{fmt.int(pageCount)}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        {ends && link(1, "first", page <= 1)}
        {link(page - 1, "prev", page <= 1)}
        {link(page + 1, "next", page >= pageCount)}
        {ends && link(pageCount, "last", page >= pageCount)}
      </div>
    </nav>
  );
}
