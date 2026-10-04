import type { ReactNode } from "react";
import Link from "next/link";
import { Icon, type Verdict } from "@/components/ui";
import { InfoTip } from "@/components/help";

// Éléments communs aux pages /absenteeism, /charge et /formations : formats français, définitions des bulles « ? », type de la réponse.

const NBSP = " ";
const MONTHS_LONG = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const MONTHS_SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

export const fr = {
  num: (v: number, digits = 1) => v.toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits }),
  // taux exprimé en fraction (0,0077) -> « 0,77 % »
  rate: (r: number | null | undefined, digits = 2) => (r == null || Number.isNaN(r) ? "—" : `${fr.num(r * 100, digits)}${NBSP}%`),
  // écart de deux taux en fraction -> « +0,12 pt »
  points: (d: number, digits = 2) => `${d > 0 ? "+" : d < 0 ? "−" : ""}${fr.num(Math.abs(d * 100), digits)}${NBSP}pt`,
  hours: (v: number | null | undefined) => (v == null || Number.isNaN(v) ? "—" : `${fr.num(v, 1)}${NBSP}h`),
  hoursDelta: (d: number) => `${d > 0 ? "+" : d < 0 ? "−" : ""}${fr.num(Math.abs(d), 1)}${NBSP}h`,
  count: (n: number, singular: string, plural = `${singular}s`) => `${n.toLocaleString("fr-FR")} ${n > 1 ? plural : singular}`,
  monthLong: (ym: string) => `${MONTHS_LONG[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`,
  monthShort: (ym: string) => `${MONTHS_SHORT[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`,
  monthOnly: (ym: string) => MONTHS_LONG[Number(ym.slice(5, 7)) - 1],
  date: (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—"),
};

export const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// Définitions courtes des bulles « ? » propres à ces trois pages (à reprendre dans src/lib/help/terms.ts)
export const DEFS = {
  fourchette: {
    label: "Fourchette probable à 80 %",
    text: "Intervalle qui contient la valeur réelle environ 8 fois sur 10. Plus la fourchette est large, plus la prévision est incertaine.",
  },
  etp: {
    label: "ETP (équivalent temps plein)",
    text: "Un collaborateur présent tous les jours ouvrés du mois compte pour 1 ETP ; présent la moitié du mois, pour 0,5. Ramener les heures à l'ETP permet de comparer des équipes de tailles différentes.",
  },
  heuresSup: {
    label: "Heures sup par ETP",
    text: "Heures supplémentaires pointées dans le mois, divisées par le nombre d'ETP du groupe. Unité : heures par ETP et par mois.",
  },
  tension: {
    label: "Équipe en tension",
    text: "Équipe dont le pic d'heures sup prévu sur les 3 prochains mois dépasse le seuil de tension. Tension probable : même le bas de la fourchette dépasse le seuil. Tension possible : seule la prévision centrale le dépasse.",
  },
  seuil: {
    label: "Seuil de tension",
    text: "Niveau atteint par les 15 % de mois les plus chargés de l'historique des équipes. Au-delà, la charge est jugée inhabituellement élevée.",
  },
  surcharge: {
    label: "Surcharge individuelle soutenue",
    text: "Collaborateur qui dépasse le seuil d'heures sup chaque mois pendant plusieurs mois consécutifs. Règle simple, sans modèle, réservée à la RH : c'est un point d'attention, pas un constat.",
  },
  risqueFormation: {
    label: "Formation à risque",
    text: "Estimation, recalculée chaque mois, du risque qu'une formation obligatoire ne soit pas terminée à son échéance. Élevé ou Moyen : une relance est conseillée. Ce n'est pas un constat.",
  },
  realisation: {
    label: "Réalisation à l'échéance",
    text: "Part des formations obligatoires arrivées à échéance sur les 12 derniers mois qui étaient terminées à temps.",
  },
  retard: {
    label: "Formation en retard",
    text: "Formation obligatoire dont l'échéance est dépassée et qui n'est pas terminée à la date des données.",
  },
} as const;

export function Def({ id, align = "end" }: { id: keyof typeof DEFS; align?: "center" | "start" | "end" }) {
  return (
    <InfoTip label={DEFS[id].label} align={align}>
      {DEFS[id].text}
    </InfoTip>
  );
}

// Réponse affichée par QuestionAnswer (@/components/ui) : verdict en mots + couleur, phrase de réponse
export type Answer = { tone: Verdict; label: string; text: ReactNode };

// Encart repliable « Comment lire ces chiffres » en bas de page (méthode, exclusions), avec lien vers l'aide
export function ReadingGuide({ children, helpHref }: { children: ReactNode; helpHref?: string }) {
  return (
    <details className="group mt-8 rounded-card border border-line bg-surface-2 text-sm text-fg-muted">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-card px-4 font-medium text-link transition-colors duration-200 hover:bg-surface-3 [&::-webkit-details-marker]:hidden">
        <Icon name="chevron-right" className="h-4 w-4 transition-transform duration-200 group-open:rotate-90" />
        Comment lire ces chiffres
      </summary>
      <div className="border-t border-line px-4 pb-4 pt-3">
        <ul className="list-disc space-y-1.5 pl-5 leading-relaxed">{children}</ul>
        {helpHref && (
          <p className="mt-3">
            <Link href={helpHref} className="font-medium text-link underline underline-offset-2 transition-[text-decoration-thickness] hover:decoration-2">
              En savoir plus dans l&apos;aide
            </Link>
          </p>
        )}
      </div>
    </details>
  );
}
