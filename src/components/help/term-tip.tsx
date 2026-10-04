import type { ReactNode } from "react";
import type { Role } from "@/db/schema";
import { termFor, type TermId } from "@/lib/help/terms";
import { InfoTip } from "./info-tip";

// Bulle « ? » d'un terme du vocabulaire commun (src/lib/help/terms.ts). Rien n'est rendu si le terme n'est pas destiné au rôle.
export function TermTip({ term, role, align, className }: { term: TermId; role?: Role; align?: "center" | "start" | "end"; className?: string }) {
  const t = termFor(term, role);
  if (!t) return null;
  return (
    <InfoTip label={t.label} align={align} className={className}>
      {t.text}
    </InfoTip>
  );
}

// Place une bulle dans le coin haut droit d'une carte (KpiCard, KpiTile), à côté du lien et non dedans :
// un bouton ne peut pas être imbriqué dans un lien. La marge droite de la carte laisse la place au bouton.
export function CornerTip({ tip, children }: { tip: ReactNode; children: ReactNode }) {
  return (
    <div className="relative h-full [&>a]:h-full [&>a]:pr-10 [&>div]:h-full [&>div]:pr-10">
      {children}
      <span className="absolute right-2 top-2.5">{tip}</span>
    </div>
  );
}
