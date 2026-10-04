"use client";

import Link from "next/link";
import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { cardCls } from "@/components/ui";
import { useTheme } from "@/components/ui/theme";
import type { OrgChartDto, OrgColorBy } from "@/lib/dal/org-chart";
import { OrgDetailPanel } from "./org-detail-panel";
import { OrgTreeChart } from "./org-tree-chart";
import { OrgTreeList } from "./org-tree-list";
import { COLOR_OPTIONS, tiersFor } from "./scale";
import { indexTree } from "./tree-index";

const NARROW = "(max-width: 639px)";
function subscribe(cb: () => void) {
  const m = window.matchMedia(NARROW);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
}
const useNarrow = () =>
  useSyncExternalStore(
    subscribe,
    () => window.matchMedia(NARROW).matches,
    () => false,
  );

const segment = (active: boolean) =>
  `inline-flex min-h-10 items-center rounded-control px-3 text-sm font-medium transition-colors duration-150 focus-visible:relative ${
    active ? "bg-primary text-primary-fg shadow-sm" : "text-fg-muted hover:bg-surface-3 hover:text-fg"
  }`;

function Legend({ colorBy, reference, rh }: { colorBy: OrgColorBy; reference: OrgChartDto["reference"]; rh: boolean }) {
  const theme = useTheme().resolvedTheme;
  const option = COLOR_OPTIONS.find((o) => o.value === colorBy)!;
  return (
    <div className="mt-3 border-t border-line pt-3">
      <p className="text-[13px] text-fg-muted">
        <span className="font-semibold text-fg">Couleur : {option.label.toLowerCase()}</span> — {option.measure}
        {colorBy === "absenteisme" && ` ; référence = ${rh ? "ensemble de l'entreprise" : "ensemble de votre hiérarchie"}`}.
      </p>
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] text-fg">
        {tiersFor(colorBy, reference).map((t) => (
          <li key={t.key} className="inline-flex items-center gap-2">
            <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full border border-line-strong" style={{ backgroundColor: t.color[theme] }} />
            {t.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function OrgChartView({ dto, colorBy }: { dto: OrgChartDto; colorBy: OrgColorBy }) {
  const index = useMemo(() => indexTree(dto.root), [dto.root]);
  const [selectedKey, setSelectedKey] = useState(dto.root.key);
  const [mode, setMode] = useState<"graphe" | "liste" | null>(null);
  const narrow = useNarrow();
  const view = mode ?? (narrow ? "liste" : "graphe");
  const heading = useRef<HTMLHeadingElement>(null);
  const rh = dto.view === "RH";
  const selected = index.get(selectedKey)?.node ?? dto.root;
  // Retour depuis une fiche ou une liste vers l'organigramme, couleur choisie conservée (fil d'Ariane de la destination)
  const back = colorBy === "effectif" ? "/organigramme" : `/organigramme?couleur=${colorBy}`;

  const select = useCallback((key: string, focusPanel = false) => {
    setSelectedKey(key);
    if (focusPanel) requestAnimationFrame(() => heading.current?.focus());
  }, []);
  const selectFromChart = useCallback((key: string) => select(key), [select]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p id="org-color-label" className="mb-1 text-sm font-medium text-fg">
            Colorer selon
          </p>
          <div role="group" aria-labelledby="org-color-label" className="inline-flex flex-wrap gap-1 rounded-control border border-line bg-surface p-1">
            {COLOR_OPTIONS.map((o) => (
              <Link
                key={o.value}
                href={o.value === "effectif" ? "/organigramme" : `/organigramme?couleur=${o.value}`}
                scroll={false}
                replace
                aria-current={o.value === colorBy ? "true" : undefined}
                className={segment(o.value === colorBy)}
              >
                {o.label}
              </Link>
            ))}
          </div>
        </div>
        <div>
          <p id="org-view-label" className="mb-1 text-sm font-medium text-fg">
            Affichage
          </p>
          <div role="group" aria-labelledby="org-view-label" className="inline-flex gap-1 rounded-control border border-line bg-surface p-1">
            {(["graphe", "liste"] as const).map((v) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => setMode(v)} className={segment(view === v)}>
                {v === "graphe" ? "Graphique" : "Liste"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-labelledby="org-main-title" className={`${cardCls} min-w-0 p-4 sm:p-5`}>
          <h2 id="org-main-title" className="mb-2 text-base font-semibold text-heading">
            {view === "graphe" ? "Hiérarchie en graphique" : "Hiérarchie en liste"}
          </h2>
          {/* Sous lg, le panneau de détail est sous la hiérarchie : la sélection reste visible ici, avec un lien vers le panneau */}
          <p className="mb-3 text-sm text-fg-muted lg:hidden">
            Sélection : <span className="font-medium text-fg">{selected.name}</span> ·{" "}
            <a href="#org-detail-title" className="font-medium text-link underline underline-offset-2 hover:decoration-2">
              Voir son détail
            </a>
          </p>
          {view === "graphe" ? (
            <OrgTreeChart root={dto.root} colorBy={colorBy} reference={dto.reference} onSelect={selectFromChart} narrow={narrow} nodeCount={dto.stats.managers} />
          ) : (
            <OrgTreeList root={dto.root} index={index} colorBy={colorBy} reference={dto.reference} selected={selected.key} onSelect={select} back={back} />
          )}
          <Legend colorBy={colorBy} reference={dto.reference} rh={rh} />
          <p className="mt-3 text-xs text-fg-subtle">Hiérarchie du dernier import AJIR : l&apos;historique des rattachements n&apos;est pas conservé.</p>
        </section>
        <OrgDetailPanel node={selected} rh={rh} onSelect={(k) => select(k, true)} headingRef={heading} back={back} />
      </div>
    </div>
  );
}
