import { TermTip } from "@/components/help/term-tip";
import type { CoverageCell } from "@/lib/ai/conformal";

// Ligne « fourchette calibrée » sous une prévision : couverture mesurée sur la fenêtre de test du modèle (champ `conformal`).
// Rien n'est affiché pour un modèle sans calibration conforme.

const NBSP = " ";

// Sous la cible, la valeur n'est jamais arrondie jusqu'à la cible : 79,96 % s'écrit « 79,9 % », pas « 80 % ».
export function coveragePct(coverage: number, target: number): string {
  const rounded = Math.round(coverage * 100);
  const v = coverage < target && rounded >= Math.round(target * 100) ? Math.floor(coverage * 1000) / 10 : rounded;
  return `${v.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}${NBSP}%`;
}

export function coverageSentence(cell: CoverageCell): { text: string; below: boolean } | null {
  if (cell.coverage == null || !Number.isFinite(cell.coverage) || !(cell.months > 0)) return null;
  const below = cell.coverage < cell.target;
  const pct = coveragePct(cell.coverage, cell.target);
  const target = `${Math.round(cell.target * 100)}${NBSP}%`;
  const period = cell.months === 1 ? "sur le dernier mois de test" : `sur les ${cell.months} derniers mois de test`;
  return {
    below,
    text: below
      ? `Fourchette calibrée : ${period}, ${pct} des valeurs observées y sont tombées, sous la cible de ${target}.`
      : `Fourchette calibrée : ${period}, ${pct} des valeurs observées y sont tombées (cible ${target}).`,
  };
}

export function CoverageNote({ cell, note, className = "" }: { cell: CoverageCell | null | undefined; note?: string; className?: string }) {
  const s = cell ? coverageSentence(cell) : null;
  if (!s) return null;
  return (
    <p className={`mt-2 flex items-start gap-1 text-xs leading-relaxed text-fg-muted ${className}`} data-couverture={s.below ? "sous-la-cible" : "atteinte"}>
      <span className="pt-1">
        {s.text}
        {note ? ` ${note}` : ""}
      </span>
      <TermTip term="fourchetteCalibree" align="end" />
    </p>
  );
}
