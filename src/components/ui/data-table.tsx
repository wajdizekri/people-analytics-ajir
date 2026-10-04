"use client";

import { useId, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { Icon } from "./icons";
import { cardCls, fieldCls, tableCls } from "./classes";
import { buttonClass } from "./button";

// Tableau commun (docs/qa/DESIGN_SYSTEM.md § 6) : en-tête collant, tri annoncé (aria-sort + message), pagination « 1–25 sur N »,
// nombres à droite, ligne survolée, lien réel vers le détail, vue en cartes sous 640 px (avec liste « Trier par »).
// Les cellules sont des ReactNode préparés par la page (badges, liens, nombres déjà formatés) ; `sort` porte les valeurs de tri.

export type DataTableColumn = {
  key: string;
  label: string;
  /** Bulle « ? » à côté de l'en-tête (<TermTip … />), hors du bouton de tri. */
  tip?: ReactNode;
  /** Colonne de nombres : alignée à droite, chiffres tabulaires. */
  numeric?: boolean;
  /** Tri possible (défaut : vrai si au moins une ligne fournit sort[key]). */
  sortable?: boolean;
  /** Masquée dans la vue en cartes (mobile). */
  hideOnCard?: boolean;
  /** Texte long (constat, liste de facteurs) : dans la vue en cartes, affiché sous son libellé sur toute la largeur. */
  cardBlock?: boolean;
  className?: string;
};
export type SortValue = string | number | null | undefined;
export type DataTableRow = {
  id: string | number;
  cells: Record<string, ReactNode>;
  sort?: Record<string, SortValue>;
  /** Lien vers le détail : la première cellule devient ce lien et toute la ligne est cliquable. */
  href?: string;
  /** Ligne cliquable sans envelopper la cellule (la cellule porte déjà son propre lien, ex. nom + ligne secondaire). */
  rowHref?: string;
};
type SortState = { key: string; dir: "asc" | "desc" } | null;

const collator = new Intl.Collator("fr", { sensitivity: "base", numeric: true });
function compare(a: SortValue, b: SortValue) {
  if (a == null || a === "") return b == null || b === "" ? 0 : 1;
  if (b == null || b === "") return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return collator.compare(String(a), String(b));
}
const fr = (n: number) => n.toLocaleString("fr-FR");
// Mêmes états que les boutons secondaires (survol, focus, enfoncement, désactivé)
const PAGE_BTN = buttonClass("secondary");

export function DataTable({
  columns,
  rows,
  caption,
  captionHidden = true,
  pageSize = 25,
  defaultSort = null,
  empty,
  footer,
  maxHeight = "70vh",
  className = "",
}: {
  columns: DataTableColumn[];
  rows: DataTableRow[];
  /** Titre du tableau (lu par les lecteurs d'écran ; visible avec captionHidden={false}). */
  caption: string;
  captionHidden?: boolean;
  /** Lignes par page ; 0 = tout afficher. */
  pageSize?: number;
  defaultSort?: SortState;
  /** Contenu affiché quand il n'y a aucune ligne (EmptyState). */
  empty?: ReactNode;
  /** Ligne de total, hors tri et pagination (<tfoot>, dernière carte) : { cells: { key: ReactNode } }. */
  footer?: { cells: Record<string, ReactNode> };
  /** Hauteur maximale de la zone défilante (en-tête collant) ; false = pas de limite. */
  maxHeight?: string | false;
  className?: string;
}) {
  const [sort, setSort] = useState<SortState>(defaultSort);
  const [page, setPage] = useState(0);
  const [message, setMessage] = useState("");
  const id = useId();

  const sortable = (c: DataTableColumn) => c.sortable ?? rows.some((r) => r.sort?.[c.key] != null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = a.sort?.[sort.key];
      const bv = b.sort?.[sort.key];
      // valeurs absentes toujours en fin de liste, quel que soit le sens
      if (av == null || av === "" || bv == null || bv === "") return compare(av, bv);
      return compare(av, bv) * factor;
    });
  }, [rows, sort]);

  const size = pageSize > 0 ? pageSize : Math.max(1, sorted.length);
  const pages = Math.max(1, Math.ceil(sorted.length / size));
  const current = Math.min(page, pages - 1);
  const start = current * size;
  const visible = sorted.slice(start, start + size);
  const range = sorted.length ? `${fr(start + 1)}–${fr(start + visible.length)} sur ${fr(sorted.length)}` : "0 sur 0";

  const applySort = (c: DataTableColumn, dir: "asc" | "desc") => {
    setSort({ key: c.key, dir });
    setPage(0);
    setMessage(`Tableau trié par ${c.label}, ordre ${dir === "asc" ? "croissant" : "décroissant"}.`);
  };
  const toggle = (c: DataTableColumn) =>
    applySort(c, sort?.key === c.key && sort.dir === "asc" ? "desc" : sort?.key === c.key ? "asc" : c.numeric ? "desc" : "asc");
  const sortColumns = columns.filter(sortable);
  const dirLabel = (c: DataTableColumn, dir: "asc" | "desc") => (c.numeric ? (dir === "asc" ? "croissant" : "décroissant") : dir === "asc" ? "de A à Z" : "de Z à A");
  const go = (p: number) => {
    setPage(p);
    const s = p * size;
    setMessage(`Lignes ${fr(s + 1)} à ${fr(Math.min(s + size, sorted.length))} sur ${fr(sorted.length)}.`);
  };
  const onRowClick = (e: MouseEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest("a, button, input, select, textarea, summary, label")) return;
    // Sélection de texte (copier un matricule) : pas de navigation
    if (window.getSelection()?.toString()) return;
    const link = e.currentTarget.querySelector<HTMLAnchorElement>("a[href]");
    const target = e.currentTarget.getAttribute("data-href");
    if (link) link.click();
    else if (target) window.location.assign(target);
  };
  const cell = (r: DataTableRow, c: DataTableColumn, i: number) => {
    const content = r.cells[c.key] ?? "—";
    return i === 0 && r.href ? (
      <a href={r.href} className="font-medium text-link underline-offset-2 hover:underline">
        {content}
      </a>
    ) : (
      content
    );
  };

  if (!rows.length && empty) return <>{empty}</>;
  // Repli si la page n'a pas fourni d'état vide : jamais un tableau muet
  if (!rows.length)
    return (
      <p className={`rounded-card border border-dashed border-line-strong/60 bg-surface/70 px-4 py-6 text-center text-sm text-fg-muted ${className}`}>
        {caption} : aucune ligne à afficher.
      </p>
    );
  const [first, ...rest] = columns;
  const cardFields = (cells: Record<string, ReactNode>) => (
    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
      {rest
        .filter((c) => !c.hideOnCard)
        .map((c) =>
          c.cardBlock ? (
            <div key={c.key} className="col-span-2 mt-1">
              <dt className="font-normal text-fg-muted">{c.label}</dt>
              <dd className="mt-0.5 text-left text-fg">{cells[c.key] ?? "—"}</dd>
            </div>
          ) : (
            <div key={c.key} className="contents">
              <dt className="font-normal text-fg-muted">{c.label}</dt>
              <dd className={`text-right text-fg ${c.numeric ? "tabular-nums" : ""}`}>{cells[c.key] ?? "—"}</dd>
            </div>
          ),
        )}
    </dl>
  );

  return (
    <div className={className}>
      <span role="status" className="sr-only">
        {message}
      </span>
      {/* Écran ≥ 640 px : tableau */}
      <div
        className={`${cardCls} hidden overflow-auto sm:block`}
        style={maxHeight ? { maxHeight } : undefined}
        tabIndex={0}
        role="region"
        aria-labelledby={`${id}-titre`}
      >
        <table className={tableCls.table}>
          <caption id={`${id}-titre`} className={captionHidden ? "sr-only" : "px-3 pt-3 text-left text-base font-semibold text-heading"}>
            {caption}
            {pages > 1 && <span className="sr-only">, lignes {range}</span>}
          </caption>
          <thead className={tableCls.thead}>
            <tr>
              {columns.map((c) => {
                const active = sort?.key === c.key;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined}
                    className={`${tableCls.th} ${c.numeric ? "text-right" : ""} ${c.className ?? ""}`}
                  >
                    <span className={`inline-flex items-center gap-0.5 ${c.numeric ? "flex-row-reverse" : ""}`}>
                    {sortable(c) ? (
                      <button
                        type="button"
                        onClick={() => toggle(c)}
                        className={`-mx-1.5 inline-flex min-h-8 items-center gap-1 rounded-[6px] px-1.5 font-semibold transition-colors duration-150 hover:bg-surface-3 hover:text-fg ${active ? "text-fg" : ""} ${c.numeric ? "flex-row-reverse" : ""}`}
                      >
                        {c.label}
                        <Icon name={active ? (sort!.dir === "asc" ? "arrow-up" : "arrow-down") : "arrow-up-down"} className={`h-3.5 w-3.5 ${active ? "text-link" : "text-fg-subtle"}`} />
                        <span className="sr-only">{active ? `, trié ${sort!.dir === "asc" ? "croissant" : "décroissant"}` : ", trier"}</span>
                      </button>
                    ) : (
                      c.label
                    )}
                    {c.tip}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr
                key={r.id}
                data-href={r.rowHref}
                className={`${tableCls.tr} ${r.href || r.rowHref ? "cursor-pointer" : ""}`}
                onClick={r.href || r.rowHref ? onRowClick : undefined}
              >
                {columns.map((c, i) =>
                  i === 0 ? (
                    <th key={c.key} scope="row" className={`${tableCls.td} text-left font-normal ${c.className ?? ""}`}>
                      {cell(r, c, i)}
                    </th>
                  ) : (
                    <td key={c.key} className={`${tableCls.td} ${c.numeric ? tableCls.num : ""} ${c.className ?? ""}`}>
                      {cell(r, c, i)}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
          {footer && (
            <tfoot className="border-t-2 border-line bg-surface-2 font-semibold">
              <tr>
                {columns.map((c, i) =>
                  i === 0 ? (
                    <th key={c.key} scope="row" className={`${tableCls.td} text-left ${c.className ?? ""}`}>
                      {footer.cells[c.key] ?? ""}
                    </th>
                  ) : (
                    <td key={c.key} className={`${tableCls.td} ${c.numeric ? tableCls.num : ""} ${c.className ?? ""}`}>
                      {footer.cells[c.key] ?? ""}
                    </td>
                  ),
                )}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {/* Écran < 640 px : cartes (première colonne en titre), tri par une liste (les en-têtes ne sont pas affichés) */}
      {sortColumns.length > 0 && sorted.length > 1 && (
        <div className="mb-2 flex items-center gap-2 sm:hidden">
          <label htmlFor={`${id}-tri`} className="shrink-0 text-sm text-fg-muted">
            Trier par
          </label>
          <select
            id={`${id}-tri`}
            value={sort ? `${sort.key}:${sort.dir}` : ""}
            onChange={(e) => {
              const [key, dir] = e.target.value.split(":");
              const c = sortColumns.find((x) => x.key === key);
              if (c && (dir === "asc" || dir === "desc")) applySort(c, dir);
            }}
            className={`${fieldCls} min-w-0 flex-1`}
          >
            {!sort && <option value="">Ordre initial</option>}
            {sortColumns.flatMap((c) =>
              (c.numeric ? (["desc", "asc"] as const) : (["asc", "desc"] as const)).map((dir) => (
                <option key={`${c.key}:${dir}`} value={`${c.key}:${dir}`}>
                  {c.label}, {dirLabel(c, dir)}
                </option>
              )),
            )}
          </select>
        </div>
      )}
      <ul aria-label={caption} className="space-y-2 sm:hidden">
        {visible.map((r) => (
          <li
            key={r.id}
            data-href={r.rowHref}
            className={`${cardCls} p-3 ${r.href || r.rowHref ? "cursor-pointer transition-colors duration-150 active:bg-surface-3" : ""}`}
            onClick={r.href || r.rowHref ? onRowClick : undefined}
          >
            <p className="text-sm">{cell(r, first, 0)}</p>
            {cardFields(r.cells)}
          </li>
        ))}
        {footer && (
          <li className={`${cardCls} bg-surface-2 p-3 font-semibold`}>
            <p className="text-sm">{footer.cells[first.key]}</p>
            {cardFields(footer.cells)}
          </li>
        )}
      </ul>
      {pages > 1 && (
        <nav aria-label={`Pagination : ${caption}`} className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-fg-muted">
          <p className="tabular-nums">{range}</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={current === 0}
              onClick={() => go(current - 1)}
              className={PAGE_BTN}
            >
              <Icon name="chevron-left" />
              Page précédente
            </button>
            <span className="hidden tabular-nums md:inline">
              Page {fr(current + 1)} sur {fr(pages)}
            </span>
            <button
              type="button"
              disabled={current >= pages - 1}
              onClick={() => go(current + 1)}
              className={PAGE_BTN}
            >
              Page suivante
              <Icon name="chevron-right" />
            </button>
          </div>
        </nav>
      )}
    </div>
  );
}
