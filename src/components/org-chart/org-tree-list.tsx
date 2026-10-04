"use client";

import Link from "next/link";
import { useId, useState, type KeyboardEvent } from "react";
import { Icon, RiskBadge, fieldCls } from "@/components/ui";
import type { OrgColorBy, OrgNode } from "@/lib/dal/org-chart";
import { withBack } from "./org-detail-panel";
import { indicatorText, matcher, people, tierOf, tiersFor, type Reference } from "./scale";
import { useTheme } from "@/components/ui/theme";
import { pathTo, type TreeIndex } from "./tree-index";

type SearchResult = { keys: Set<string>; nodeHits: Set<string>; memberHits: Map<string, Set<number>>; count: number };

// Parcours au clavier des lignes dépliables (summary[data-tree]) : seules les lignes affichées sont dans le DOM (enfants rendus à l'ouverture).
// Haut / bas : ligne précédente / suivante ; droite : déplier, puis premier enfant ; gauche : replier, puis parent ; Début / Fin.
export function treeKeyTarget(key: string, current: HTMLElement, rows: HTMLElement[]): { focus?: HTMLElement; toggle?: { key: string; open: boolean } } | null {
  const i = rows.indexOf(current);
  if (i < 0) return null;
  const details = current.parentElement as HTMLDetailsElement | null;
  const open = !!details?.open;
  switch (key) {
    case "ArrowDown":
      return rows[i + 1] ? { focus: rows[i + 1] } : {};
    case "ArrowUp":
      return rows[i - 1] ? { focus: rows[i - 1] } : {};
    case "Home":
      return { focus: rows[0] };
    case "End":
      return { focus: rows[rows.length - 1] };
    case "ArrowRight":
      if (!open) return { toggle: { key: current.dataset.tree!, open: true } };
      return rows[i + 1] && details?.contains(rows[i + 1]) ? { focus: rows[i + 1] } : {};
    case "ArrowLeft": {
      if (open) return { toggle: { key: current.dataset.tree!, open: false } };
      const parent = details?.parentElement?.closest("details")?.querySelector<HTMLElement>(":scope > summary[data-tree]");
      return parent ? { focus: parent } : {};
    }
    default:
      return null;
  }
}

const leavesKey = (key: string) => `${key}:collaborateurs`;

function Mark({ text, on }: { text: string; on: boolean }) {
  return on ? <mark className="rounded-sm bg-warning-soft px-0.5 text-fg">{text}</mark> : <>{text}</>;
}

function search(root: OrgNode, query: string): SearchResult | null {
  const match = matcher(query);
  if (!match) return null;
  const res: SearchResult = { keys: new Set(), nodeHits: new Set(), memberHits: new Map(), count: 0 };
  const scan = (n: OrgNode): boolean => {
    const self = match(n.name);
    const leaves = n.members.filter((m) => !m.leadsTeam && match(m.name)).map((m) => m.id);
    let below = false;
    for (const c of n.children) if (scan(c)) below = true;
    if (self) res.nodeHits.add(n.key);
    if (leaves.length) res.memberHits.set(n.key, new Set(leaves));
    res.count += (self ? 1 : 0) + leaves.length;
    const hit = self || leaves.length > 0 || below;
    if (hit) res.keys.add(n.key);
    return hit;
  };
  scan(root);
  return res;
}

export function OrgTreeList({
  root,
  index,
  colorBy,
  reference,
  selected,
  onSelect,
  back = "/organigramme",
}: {
  root: OrgNode;
  index: TreeIndex;
  colorBy: OrgColorBy;
  reference: Reference;
  selected: string;
  onSelect: (key: string, focusPanel: boolean) => void;
  back?: string;
}) {
  const theme = useTheme().resolvedTheme;
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(pathTo(index, selected)));
  const [shownSelection, setShownSelection] = useState(selected);
  if (shownSelection !== selected) {
    setShownSelection(selected);
    setExpanded((prev) => new Set([...prev, ...pathTo(index, selected).slice(0, -1)]));
  }
  const inputId = useId();
  const statusId = useId();
  const keysId = useId();
  const tiers = new Map(tiersFor(colorBy, reference).map((t) => [t.key, t]));

  const onQuery = (q: string) => {
    setQuery(q);
    const r = search(root, q);
    setResult(r);
    if (!r) return;
    const withMatchesBelow = [...r.keys].filter((k) => r.memberHits.has(k) || index.get(k)?.node.children.some((c) => r.keys.has(c.key)));
    setExpanded(new Set([...withMatchesBelow, ...[...r.memberHits.keys()].map(leavesKey)]));
  };
  const setOpen = (key: string, open: boolean) =>
    setExpanded((prev) => {
      if (prev.has(key) === open) return prev;
      const next = new Set(prev);
      if (open) next.add(key);
      else next.delete(key);
      return next;
    });
  const onTreeKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const target = e.target as HTMLElement;
    if (target.tagName !== "SUMMARY" || !target.dataset.tree) return;
    const move = treeKeyTarget(e.key, target, Array.from(e.currentTarget.querySelectorAll<HTMLElement>("summary[data-tree]")));
    if (!move) return;
    e.preventDefault();
    if (move.toggle) setOpen(move.toggle.key, move.toggle.open);
    move.focus?.focus();
  };

  const renderNode = (n: OrgNode) => {
    if (result && !result.keys.has(n.key)) return null;
    const open = expanded.has(n.key);
    const tier = tiers.get(tierOf(colorBy, n.subtree, reference))!;
    const leaves = n.members.filter((m) => !m.leadsTeam);
    const hits = result?.memberHits.get(n.key);
    const shownLeaves = result ? leaves.filter((m) => hits?.has(m.id)) : leaves;
    const isSelected = n.key === selected;
    return (
      <li key={n.key}>
        <details open={open} onToggle={(e) => setOpen(n.key, e.currentTarget.open)}>
          {/* Déplier une équipe affiche aussi son détail, comme un clic sur le graphique */}
          <summary
            data-tree={n.key}
            onClick={() => {
              if (!open) onSelect(n.key, false);
            }}
            aria-current={isSelected ? "true" : undefined}
            className={`flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-control px-2 py-1.5 transition-colors duration-150 hover:bg-surface-3 [&::-webkit-details-marker]:hidden ${isSelected ? "bg-primary-soft ring-1 ring-inset ring-primary/40" : ""}`}
          >
            <Icon name="chevron-right" className={`h-4 w-4 shrink-0 text-fg-subtle transition-transform duration-200 ${open ? "rotate-90" : ""}`} />
            <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full border border-line-strong" style={{ backgroundColor: tier.color[theme] }} />
            <span className="min-w-0">
              <span className="font-medium text-fg">
                <Mark text={n.name} on={!!result?.nodeHits.has(n.key)} />
              </span>
              <span className="block text-xs text-fg-muted sm:ml-2 sm:inline">
                {colorBy === "effectif" ? people(n.subtree.headcount) : `${people(n.subtree.headcount)} · ${indicatorText(colorBy, n.subtree)}`}
                <span className="sr-only"> ; couleur : {tier.label}</span>
              </span>
            </span>
          </summary>
          {open && (
            <div className="ml-4 border-l border-line pb-1 pl-3">
              <button
                type="button"
                onClick={() => onSelect(n.key, true)}
                className="my-1 inline-flex min-h-8 items-center gap-1 rounded-control px-1 text-[13px] font-medium text-link underline-offset-2 transition-colors hover:underline"
              >
                Afficher le détail<span className="sr-only"> de {n.name}</span>
                <span aria-hidden="true">›</span>
              </button>
              {n.children.length > 0 && <ul className="space-y-0.5">{n.children.map(renderNode)}</ul>}
              {shownLeaves.length > 0 && (
                <details open={expanded.has(leavesKey(n.key))} onToggle={(e) => setOpen(leavesKey(n.key), e.currentTarget.open)} className="mt-0.5">
                  <summary data-tree={leavesKey(n.key)} className="flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-control px-2 py-1.5 text-sm text-fg-muted transition-colors duration-150 hover:bg-surface-3 [&::-webkit-details-marker]:hidden">
                    <Icon name="chevron-right" className={`h-4 w-4 shrink-0 text-fg-subtle transition-transform duration-200 ${expanded.has(leavesKey(n.key)) ? "rotate-90" : ""}`} />
                    {result
                      ? `${shownLeaves.length} collaborateur${shownLeaves.length > 1 ? "s" : ""} trouvé${shownLeaves.length > 1 ? "s" : ""}`
                      : `${leaves.length} collaborateur${leaves.length > 1 ? "s" : ""} direct${leaves.length > 1 ? "s" : ""} sans équipe`}
                  </summary>
                  {expanded.has(leavesKey(n.key)) && (
                    <ul className="ml-4 divide-y divide-line border-l border-line pl-3 text-sm">
                      {shownLeaves.map((m) => (
                        <li key={m.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1.5">
                          <span className="min-w-0">
                            <Link href={withBack(`/employees/${m.id}`, back)} className="text-link underline-offset-2 hover:underline">
                              <Mark text={m.name} on={!!hits?.has(m.id)} />
                            </Link>
                            {m.jobTitle && <span className="block text-xs text-fg-muted">{m.jobTitle}</span>}
                          </span>
                          <RiskBadge level={m.level} />
                        </li>
                      ))}
                    </ul>
                  )}
                </details>
              )}
            </div>
          )}
        </details>
      </li>
    );
  };

  return (
    <div>
      <div className="mb-3 max-w-md">
        <label htmlFor={inputId} className="mb-1 block text-sm font-medium text-fg">
          Trouver une personne
        </label>
        <div className="relative">
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-subtle" />
          <input
            id={inputId}
            type="search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Nom ou prénom"
            autoComplete="off"
            aria-describedby={statusId}
            className={`${fieldCls} pl-9`}
          />
        </div>
        <p id={statusId} role="status" className="mt-1 min-h-5 text-xs text-fg-muted">
          {result ? (result.count ? `${result.count} personne${result.count > 1 ? "s" : ""} trouvée${result.count > 1 ? "s" : ""}, chemin déplié.` : "Aucune personne ne correspond à cette recherche.") : ""}
        </p>
      </div>
      <p id={keysId} className="mb-2 text-xs text-fg-subtle">
        Au clavier : flèches haut et bas pour passer d&apos;une ligne à l&apos;autre, droite et gauche pour déplier ou replier, Entrée pour ouvrir ou fermer.
      </p>
      <ul aria-label="Organigramme en liste" aria-describedby={keysId} onKeyDown={onTreeKey} className="space-y-0.5 text-sm">
        {renderNode(root)}
      </ul>
    </div>
  );
}
