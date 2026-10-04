import type { Delta } from "@/components/charts/pbi";
import { frRate, type RiskTotals } from "@/components/pilotage/chart-options";

// Titres-messages des visuels (charte § 5 : le titre dit ce qu'il faut retenir) et variations des cartes KPI.
// Écarts de taux calculés sur les valeurs affichées (arrondies au dixième de point) : jamais « 0,6 % contre 0,7 % : 0,0 pt ».

const int = (n: number) => n.toLocaleString("fr-FR");
const plural = (n: number, one: string, many: string) => `${int(n)} ${n > 1 ? many : one}`;
// Signe moins typographique (−), comme dans les constats de la synthèse
export const signed = (n: number, digits = 0) =>
  n.toLocaleString("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits, signDisplay: "exceptZero" }).replace("-", "−");
export const pointsDiff = (a: number, b: number) => (Math.round(a * 1000) - Math.round(b * 1000)) / 10;

// Variations des cartes KPI : KpiCard ajoute la flèche et le jugement écrit (« favorable », « à surveiller », « stable »)
export function rateDelta(from: number | null, to: number | null, since: string, good: "up" | "down"): Delta | null {
  if (from == null || to == null) return null;
  const value = pointsDiff(to, from);
  return { value, label: `${signed(value, 1)} pt ${since}`, good };
}

// Variation d'un nombre (collaborateurs, heures) arrondi à `digits` décimales ; good « neutral » : sans jugement (effectif)
export function countDelta(from: number, to: number, since: string, good: Delta["good"], unit = "", digits = 0): Delta {
  const f = 10 ** digits;
  const value = (Math.round(to * f) - Math.round(from * f)) / f;
  return { value, label: `${signed(value, digits)}${unit} ${since}`, good };
}

export function headcountTitle(first: number, last: number, since: string): string {
  const d = last - first;
  if (d === 0) return `L'effectif est stable ${since} : ${plural(last, "collaborateur", "collaborateurs")}`;
  return `L'effectif ${d > 0 ? "progresse" : "recule"} de ${plural(Math.abs(d), "personne", "personnes")} ${since}`;
}

export function turnoverTitle(first: number | null, last: number | null, sinceMonth: string): string {
  if (last == null) return "Turnover glissant 12 mois non disponible";
  if (first == null) return `Turnover sur 12 mois glissants : ${frRate(last)}`;
  const d = pointsDiff(last, first);
  if (Math.abs(d) < 0.5) return `Le turnover reste stable, autour de ${frRate(last)}`;
  return `Le turnover ${d > 0 ? "augmente" : "baisse"} : ${frRate(last)} contre ${frRate(first)} en ${sinceMonth}`;
}

export function absenteeismTitle(last: number | null, average: number | null, month: string): string {
  if (last == null || average == null) return "Absentéisme mensuel non disponible";
  const d = pointsDiff(last, average);
  const where = Math.abs(d) < 0.1 ? "proche de" : d > 0 ? "au-dessus de" : "sous";
  return `En ${month}, l'absentéisme (${frRate(last)}) est ${where} la moyenne de la période`;
}

export function riskTitle(t: RiskTotals): string {
  const evaluated = t.ELEVE + t.MOYEN + t.FAIBLE;
  if (evaluated === 0) return "Aucun collaborateur évalué";
  if (t.ELEVE === 0) return "Aucun collaborateur en risque élevé";
  return `${plural(t.ELEVE, "collaborateur", "collaborateurs")} en risque élevé, soit ${frRate(t.ELEVE / evaluated)} des évalués`;
}

// rows triées par nombre d'« Élevé » décroissant
export function riskByDepartmentTitle(rows: { name: string; ELEVE: number }[]): string {
  const total = rows.reduce((n, r) => n + r.ELEVE, 0);
  const [a, b] = rows;
  if (total === 0) return rows.length === 1 ? `${a.name} : aucun risque élevé` : "Aucun département ne compte de risque élevé";
  if (a.ELEVE === total) return `${a.name} concentre ${total === 1 ? "le seul risque élevé" : `les ${int(total)} risques élevés`}`;
  if (b && b.ELEVE === a.ELEVE) return `${a.name} et ${b.name} comptent le plus de risques élevés (${int(a.ELEVE)} chacun)`;
  return `${a.name} compte le plus de risques élevés : ${int(a.ELEVE)} sur ${int(total)}`;
}

export function headcountByDepartmentTitle(rows: { name: string; headcount: number }[], total: number): string {
  const top = [...rows].sort((x, y) => y.headcount - x.headcount)[0];
  if (!top || total === 0) return "Aucun effectif sur la période";
  return `${top.name} regroupe ${frRate(top.headcount / total, 0)} de l'effectif`;
}

export function absenteeismByDepartmentTitle(rows: { name: string; absenteeismRate: number | null }[], average: number | null): string {
  const top = rows.filter((r) => r.absenteeismRate != null).sort((x, y) => y.absenteeismRate! - x.absenteeismRate!)[0];
  if (!top) return "Absentéisme par département non disponible";
  const avg = average == null ? "" : ` contre ${frRate(average)} en moyenne`;
  return `${top.name} : absentéisme le plus élevé (${frRate(top.absenteeismRate!)}${avg})`;
}
