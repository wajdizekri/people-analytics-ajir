"use client";

import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui";

export type SettingsNavItem = { id: string; label: string; changed: number };

// Indice de la section en cours : la dernière dont le haut a passé la ligne de lecture (quart supérieur de l'écran).
// Sur le dernier écran de défilement, la ligne descend jusqu'en bas : les dernières sections, trop courtes pour
// atteindre le haut de l'écran, sont surlignées à leur tour.
export function activeIndex(tops: number[], viewport: number, remaining: number): number {
  const end = remaining < viewport ? 1 - Math.max(0, remaining) / viewport : 0;
  const line = viewport * (0.25 + 0.75 * end);
  let current = 0;
  tops.forEach((top, i) => {
    if (top <= line) current = i;
  });
  return current;
}

// Mêmes puces que le sommaire des autres pages longues (OnThisPage)
const chipCls =
  "inline-flex min-h-9 items-center gap-2 rounded-full border border-line-strong bg-surface px-3 text-fg transition-colors duration-150 hover:border-primary hover:bg-primary-soft active:translate-y-px aria-[current]:border-primary aria-[current]:bg-primary-soft aria-[current]:font-medium aria-[current]:text-link";
const rowCls =
  "flex min-h-10 items-center justify-between gap-2 rounded-control px-2.5 py-1.5 text-fg-muted transition-colors duration-150 hover:bg-surface-3 hover:text-fg aria-[current]:bg-primary-soft aria-[current]:font-semibold aria-[current]:text-link";

// Navigation des thèmes : seule navigation de sections de la page (elle remplace OnThisPage ici), pour les deux gabarits.
// Sous lg : puces en tête de page, non collantes. À partir de lg : liste verticale collante à gauche du contenu.
// Thème en cours surligné au défilement, compteur de modifications par thème.
export function SettingsNav({ items }: { items: SettingsNavItem[] }) {
  const ids = items.map((i) => i.id).join(" ");
  const [active, setActive] = useState(items[0]?.id ?? "");
  // Thème choisi au clic : il reste surligné après le saut vers l'ancre, jusqu'au défilement suivant
  const picked = useRef(false);

  useEffect(() => {
    const sections = ids
      .split(" ")
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (!sections.length) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      if (picked.current) {
        picked.current = false;
        return;
      }
      const remaining = document.documentElement.scrollHeight - window.innerHeight - window.scrollY;
      const tops = sections.map((s) => s.getBoundingClientRect().top);
      setActive(sections[activeIndex(tops, window.innerHeight, remaining)].id);
    };
    const schedule = () => {
      frame ||= requestAnimationFrame(update);
    };
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      cancelAnimationFrame(frame);
    };
  }, [ids]);

  const link = (i: SettingsNavItem, className: string) => (
    <a
      href={`#${i.id}`}
      aria-current={i.id === active ? "location" : undefined}
      onClick={() => {
        picked.current = true;
        setActive(i.id);
      }}
      className={className}
    >
      {i.label}
      {i.changed > 0 && (
        <Badge tone="warning">
          {i.changed} modifié{i.changed > 1 ? "s" : ""}
        </Badge>
      )}
    </a>
  );

  return (
    <nav
      aria-label="Thèmes des paramètres"
      className="mb-4 text-sm lg:sticky lg:top-4 lg:mb-0 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto lg:rounded-card lg:border lg:border-line lg:bg-surface lg:p-3 lg:shadow-card"
    >
      <div className="flex flex-wrap items-center gap-2 lg:hidden">
        <span className="text-xs font-semibold uppercase tracking-wide text-fg-muted">Thèmes</span>
        <ul className="flex flex-wrap gap-2">
          {items.map((i) => (
            <li key={i.id}>{link(i, chipCls)}</li>
          ))}
        </ul>
      </div>
      <div className="hidden lg:block">
        <p className="mb-2 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">Thèmes</p>
        <ul className="space-y-0.5">
          {items.map((i) => (
            <li key={i.id}>{link(i, rowCls)}</li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
