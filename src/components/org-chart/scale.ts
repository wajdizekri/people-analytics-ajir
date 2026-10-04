import { DARK_COLORS, SEMANTIC } from "@/components/charts/theme";
import { formatRate } from "@/components/pilotage/labels";
import { MIN_GROUP_SIZE } from "@/lib/dal/pilotage-metrics";
import type { OrgColorBy, OrgMask, OrgMetrics } from "@/lib/dal/org-chart";

// Échelles de couleur de l'organigramme : la couleur est toujours doublée d'un libellé (légende, infobulle, panneau, vue liste)

export const COLOR_OPTIONS: { value: OrgColorBy; label: string; measure: string }[] = [
  { value: "effectif", label: "Effectif", measure: "nombre de collaborateurs actifs rattachés (équipe directe et équipes en dessous)" },
  { value: "risque", label: "Risque de départ", measure: "part des collaborateurs évalués en risque élevé ou moyen, ensemble rattaché" },
  { value: "absenteisme", label: "Absentéisme", measure: "absentéisme hors santé et hors congés sur les 3 derniers mois, ensemble rattaché" },
];

export const RISK_TIERS = { watch: 0.1, high: 0.25 } as const;
export const ABSENTEEISM_TIERS = { ratio: 1.5, gap: 0.01 } as const;

export type TierKey = "t1" | "t2" | "t3" | "t4" | "na";
export type Tier = { key: TierKey; label: string; color: { light: string; dark: string } };
export type Reference = { absenteeism: number | null; riskShare: number | null };

const dark = (c: string) => DARK_COLORS[c.toLowerCase()] ?? c;
const sem = (c: string) => ({ light: c, dark: dark(c) });
const NA = sem(SEMANTIC.contexte);

// Effectif : une seule teinte (bleu ArabSoft), du clair au foncé en clair ; en sombre, contraste croissant sur la surface #111a2b,
// le plus petit palier à 3,6:1 (aplat porteur d'information ≥ 3:1), écart de clarté OKLCH ≥ 0,078 entre paliers
// (validateur de la compétence dataviz, mode --ordinal)
export function tiersFor(colorBy: OrgColorBy, ref: Reference): Tier[] {
  if (colorBy === "effectif")
    return [
      { key: "t1", label: "Moins de 10 personnes", color: { light: "#a9c4e8", dark: "#3572bd" } },
      { key: "t2", label: "10 à 49 personnes", color: { light: "#5b8fcf", dark: "#5b8fcf" } },
      { key: "t3", label: "50 à 199 personnes", color: { light: "#1e56a3", dark: "#7ea7dc" } },
      { key: "t4", label: "200 personnes et plus", color: { light: "#0b3a66", dark: "#a9c4e8" } },
    ];
  if (colorBy === "risque")
    return [
      { key: "t1", label: `Moins de ${pctLabel(RISK_TIERS.watch)} en risque élevé ou moyen`, color: sem(SEMANTIC.favorable) },
      { key: "t2", label: `De ${pctLabel(RISK_TIERS.watch)} à ${pctLabel(RISK_TIERS.high)} : à surveiller`, color: sem(SEMANTIC.attention) },
      { key: "t3", label: `${pctLabel(RISK_TIERS.high)} ou plus : prioritaire`, color: sem(SEMANTIC.defavorable) },
      { key: "na", label: "Non affiché ou aucun collaborateur évalué", color: NA },
    ];
  const r = ref.absenteeism;
  return [
    { key: "t1", label: `Inférieur ou égal à la référence${r != null ? ` (${formatRate(r)})` : ""}`, color: sem(SEMANTIC.favorable) },
    { key: "t2", label: "Au-dessus de la référence", color: sem(SEMANTIC.attention) },
    { key: "t3", label: `Nettement au-dessus (au moins ${String(ABSENTEEISM_TIERS.ratio).replace(".", ",")} fois la référence et 1 point de plus)`, color: sem(SEMANTIC.defavorable) },
    { key: "na", label: "Non affiché ou sans donnée", color: NA },
  ];
}

function pctLabel(v: number) {
  return `${Math.round(v * 100)} %`;
}

export function tierOf(colorBy: OrgColorBy, m: OrgMetrics, ref: Reference): TierKey {
  if (colorBy === "effectif") return m.headcount < 10 ? "t1" : m.headcount < 50 ? "t2" : m.headcount < 200 ? "t3" : "t4";
  if (colorBy === "risque") {
    if (m.riskShare == null) return "na";
    return m.riskShare >= RISK_TIERS.high ? "t3" : m.riskShare >= RISK_TIERS.watch ? "t2" : "t1";
  }
  const v = m.absenteeism;
  const r = ref.absenteeism;
  if (v == null || r == null) return "na";
  if (v >= r * ABSENTEEISM_TIERS.ratio && v - r >= ABSENTEEISM_TIERS.gap) return "t3";
  return v > r ? "t2" : "t1";
}

export const people = (n: number) => `${new Intl.NumberFormat("fr-FR").format(n)} personne${n > 1 ? "s" : ""}`;

export function maskText(mask: OrgMask): string {
  return mask === "PETIT_GROUPE" ? `non affiché (moins de ${MIN_GROUP_SIZE} personnes)` : "non affiché (permettrait de déduire une petite équipe)";
}

export function riskText(m: OrgMetrics): string {
  if (m.riskMask) return maskText(m.riskMask);
  if (!m.scored || m.riskShare == null) return "aucun collaborateur évalué";
  return `${formatRate(m.riskShare)} (${m.atRisk} sur ${m.scored} évalué${m.scored > 1 ? "s" : ""})`;
}

export function absenteeismText(m: OrgMetrics): string {
  if (m.absenteeismMask) return maskText(m.absenteeismMask);
  return m.absenteeism == null ? "sans donnée" : formatRate(m.absenteeism);
}

export function indicatorText(colorBy: OrgColorBy, m: OrgMetrics): string {
  if (colorBy === "effectif") return people(m.headcount);
  if (colorBy === "risque") return `risque élevé ou moyen : ${riskText(m)}`;
  return `absentéisme : ${absenteeismText(m)}`;
}

const strip = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("fr-FR");

export function matcher(query: string): ((name: string) => boolean) | null {
  const words = strip(query).split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  return (name) => {
    const n = strip(name);
    return words.every((w) => n.includes(w));
  };
}
