import { InfoTip } from "@/components/help/info-tip";
import { StatusBadge } from "@/components/ui";
import type { CoverageCell } from "@/lib/ai/conformal";
import { TERMS } from "@/lib/help/terms";

// Badge « Fourchette calibrée » sous une prévision : couverture mesurée sur la fenêtre de test du modèle (champ `conformal`),
// phrase complète et définition dans la bulle « ? ». Rien n'est affiché pour un modèle sans calibration conforme.

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
  if (!cell || !s) return null;
  return (
    <p className={`mt-2 flex flex-wrap items-center gap-1 text-xs text-fg-muted ${className}`} data-couverture={s.below ? "sous-la-cible" : "atteinte"}>
      <StatusBadge tone={s.below ? "warning" : "neutral"}>
        {`Fourchette calibrée · ${coveragePct(cell.coverage!, cell.target)} (cible ${Math.round(cell.target * 100)}${NBSP}%)`}
      </StatusBadge>
      <InfoTip label={TERMS.fourchetteCalibree.label} align="end">
        {`${s.text}${note ? ` ${note}` : ""} ${TERMS.fourchetteCalibree.text}`}
      </InfoTip>
    </p>
  );
}
