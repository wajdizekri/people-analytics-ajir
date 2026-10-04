import { monthIndex, monthLabel, type Projection, type SeriesOut, type WorkforceState } from "./engine";
import type { MemberInfo } from "./state";

// Recommandations RH collectives tirées de la projection de référence. Fonction pure : l'étape les écrit (dedup_key stable).

export type WorkforceReco = {
  topic: "EFFECTIF" | "MASSE_SALARIALE";
  scope: "ENTREPRISE" | "DEPARTEMENT";
  departmentId: number | null;
  actionCode: string;
  title: string;
  rationale: string;
  priority: 1 | 2 | 3;
  dedupKey: string;
};

export type RecoInput = {
  asOf: string;
  proj: Projection;
  state: WorkforceState;
  members: MemberInfo[];
  budgets: Map<number, number>;
  observedMass: Map<number, { total: number; months: number }>;
};

export const WORKFORCE_ACTIONS: Record<string, string> = {
  ANTICIPER_RECRUTEMENT: "Anticiper un recrutement",
  PREPARER_SUCCESSION: "Préparer la succession des départs en retraite",
  REVOIR_CDD: "Revoir le renouvellement des CDD",
  AJUSTER_BUDGET_MASSE: "Revoir le budget de masse salariale",
};

// Sous-effectif : l'effectif projeté passe sous l'effectif actuel d'au moins max(2 postes, 3 %)
export const UNDERSTAFF_MIN = 2;
export const UNDERSTAFF_RATE = 0.03;
export const CDD_WINDOW = 3;
export const CDD_MIN = 2;
export const BUDGET_GAP = 0.02;

const MONTHS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const monthFr = (ym: string) => `${MONTHS_FR[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const num = (v: number, d = 0) => v.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (v: number, d = 1) => `${num(v * 100, d)}\u00a0%`;
const tnd = (v: number) => (Math.abs(v) >= 1e6 ? `${num(v / 1e6, 2)} million${Math.abs(v) >= 2e6 ? "s" : ""} de TND` : `${num(v)}\u00a0TND`);
const signedPct = (v: number) => `${v >= 0 ? "+" : "−"}${num(Math.abs(v) * 100, 1)}\u00a0%`;
// « de mai 2026 », « d'avril 2026 »
const fromMonth = (ym: string) => (/^[aeiouéh]/i.test(monthFr(ym)) ? `d'${monthFr(ym)}` : `de ${monthFr(ym)}`);
const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
const gradeLevel = (g: string | null) => (g && /^G\d$/.test(g) ? Number(g.slice(1)) : 0);

function exitsSentence(s: SeriesOut): string {
  const e = s.exits;
  const parts = [
    `démissions ${num(sum(e.resign), 1)}`,
    `fins de CDD non renouvelés ${num(sum(e.cdd), 1)}`,
    `retraites ${num(sum(e.retire), 1)}`,
    `autres sorties ${num(sum(e.other), 1)}`,
  ];
  if (sum(e.known) > 0) parts.push(`sorties déjà enregistrées ${num(sum(e.known), 0)}`);
  const total = sum(e.resign) + sum(e.cdd) + sum(e.retire) + sum(e.other) + sum(e.known);
  return `${num(total, 1)} sorties attendues sur 12 mois (${parts.join(" ; ")})`;
}

export function buildWorkforceRecommendations(input: RecoInput): WorkforceReco[] {
  const { asOf, proj, state, members } = input;
  const out: WorkforceReco[] = [];
  const H = proj.months.length;
  const source =
    state.resignSource === "LOGREG"
      ? "démissions estimées par les probabilités de démission publiées (modèle de risque de départ)"
      : "démissions estimées au taux historique du département (24 mois), le modèle de risque de départ publié ne fournissant pas de probabilité";
  const understaffed = new Set<number>();

  for (const d of proj.departments) {
    if (d.hc0 <= 0) continue;
    const threshold = Math.max(UNDERSTAFF_MIN, UNDERSTAFF_RATE * d.hc0);
    const gaps = d.hc.map((v) => d.hc0 - v);
    const first = gaps.findIndex((g) => g >= threshold);
    if (first < 0) continue;
    let worst = first;
    gaps.forEach((g, i) => {
      if (g > gaps[worst]) worst = i;
    });
    const n = Math.max(1, Math.round(gaps[worst]));
    const significant = d.hcUpper[worst] < d.hc0;
    understaffed.add(d.id);
    out.push({
      topic: "EFFECTIF",
      scope: "DEPARTEMENT",
      departmentId: d.id,
      actionCode: "ANTICIPER_RECRUTEMENT",
      title: `Anticiper un recrutement au département ${d.name} : sous-effectif prévu de ${n} poste${n > 1 ? "s" : ""} dans ${worst + 1} mois`,
      rationale:
        `Effectif actuel : ${num(d.hc0)} collaborateurs ; projection en ${monthFr(proj.months[worst])} : ${num(d.hc[worst], 1)} ` +
        `(fourchette probable à 80\u00a0% : ${num(d.hcLower[worst], 1)} à ${num(d.hcUpper[worst], 1)}), seuil de sous-effectif (${num(threshold, 1)} postes) franchi dès ${monthFr(proj.months[first])}. ` +
        `${exitsSentence(d)}, pour ${num(sum(d.hires), 1)} embauches au rythme des 12 derniers mois (${num(d.hires[0] ?? 0, 2)} par mois). ` +
        `${significant ? "L'écart demeure même au haut de la fourchette." : "Le haut de la fourchette couvre l'effectif actuel : à confirmer au prochain calcul."} Hypothèse : ${source}.`,
      priority: significant ? 1 : 2,
      dedupKey: `effectif:recrutement:${d.code}:${asOf}`,
    });
  }

  const byDept = new Map<number, MemberInfo[]>();
  for (const m of members) {
    if (m.department_id == null) continue;
    const list = byDept.get(m.department_id) ?? [];
    list.push(m);
    byDept.set(m.department_id, list);
  }
  const m0 = monthIndex(state.month0);

  for (const d of proj.departments) {
    const list = byDept.get(d.id) ?? [];
    const retiring = list.filter((m) => m.retK != null).sort((a, b) => a.retK! - b.retK! || gradeLevel(b.grade) - gradeLevel(a.grade));
    if (retiring.length) {
      const earliest = retiring[0].retK!;
      const senior = retiring.some((m) => gradeLevel(m.grade) >= 7);
      const items = retiring.map((m) => `${m.job_title ?? "poste non renseigné"}${m.grade ? ` (${m.grade})` : ""} en ${monthFr(monthLabel(m0 + m.retK!))}`);
      out.push({
        topic: "EFFECTIF",
        scope: "DEPARTEMENT",
        departmentId: d.id,
        actionCode: "PREPARER_SUCCESSION",
        title: `Préparer la succession des départs en retraite prévus au département ${d.name} (${retiring.length} d'ici ${monthFr(monthLabel(m0 + H))})`,
        rationale:
          `${retiring.length} collaborateur${retiring.length > 1 ? "s atteignent" : " atteint"} l'âge légal de départ (60 ans) dans les 12 mois : ${items.join(" ; ")}. ` +
          `Part des collaborateurs partis en retraite à cet âge dans l'historique : ${pct(state.qRet, 0)}. Anticipez le transfert de compétences et le recrutement ou la promotion interne.`,
        priority: earliest <= 6 || senior ? 1 : 2,
        dedupKey: `effectif:retraite:${d.code}:${asOf}`,
      });
    }
    const ending = list.filter((m) => m.cddK != null);
    const soon = ending.filter((m) => m.cddK! <= CDD_WINDOW);
    if (soon.length >= CDD_MIN) {
      out.push({
        topic: "EFFECTIF",
        scope: "DEPARTEMENT",
        departmentId: d.id,
        actionCode: "REVOIR_CDD",
        title: `Revoir le renouvellement des CDD arrivant à terme au département ${d.name} (${soon.length} d'ici ${monthFr(monthLabel(m0 + CDD_WINDOW))})`,
        rationale:
          `${soon.length} CDD arrivent à terme dans les ${CDD_WINDOW} prochains mois (${ending.length} sur 12 mois). ` +
          `Au taux de non-renouvellement observé sur 24 mois (${pct(state.qCdd)}), ${num(sum(d.exits.cdd), 1)} sorties sont attendues sur 12 mois. ` +
          `Décidez au cas par cas : renouvellement, passage en CDI ou remplacement${understaffed.has(d.id) ? " ; le département est par ailleurs en sous-effectif prévu" : ""}.`,
        priority: understaffed.has(d.id) ? 1 : 2,
        dedupKey: `effectif:cdd:${d.code}:${asOf}`,
      });
    }
  }

  const tm = proj.total.mass;
  if (tm && proj.total.massLower && proj.total.massUpper) {
    const years = [...new Set(proj.months.map((m) => Number(m.slice(0, 4))))];
    for (const y of years) {
      const budget = input.budgets.get(y);
      if (!budget || !(budget > 0)) continue;
      const idx = proj.months.map((m, i) => (Number(m.slice(0, 4)) === y ? i : -1)).filter((i) => i >= 0);
      const obs = input.observedMass.get(y) ?? { total: 0, months: 0 };
      if (obs.months + idx.length !== 12) continue;
      const projected = sum(idx.map((i) => tm[i]));
      const lo = sum(idx.map((i) => proj.total.massLower![i]));
      const hi = sum(idx.map((i) => proj.total.massUpper![i]));
      const total = obs.total + projected;
      const gap = total / budget - 1;
      if (Math.abs(gap) < BUDGET_GAP) continue;
      const first = proj.months[idx[0]];
      const last = proj.months[idx[idx.length - 1]];
      out.push({
        topic: "MASSE_SALARIALE",
        scope: "ENTREPRISE",
        departmentId: null,
        actionCode: "AJUSTER_BUDGET_MASSE",
        title: `Écart de masse salariale prévu de ${signedPct(gap)} par rapport au budget ${y}`,
        rationale:
          `Masse salariale brute ${y} projetée : ${tnd(total)} pour un budget de ${tnd(budget)} (écart ${signedPct(gap)}, soit ${tnd(total - budget)}). ` +
          `${obs.months ? `Réalisé sur ${obs.months} mois : ${tnd(obs.total)} ; ` : ""}projeté ${fromMonth(first)} à ${monthFr(last)} : ${tnd(projected)} ` +
          `(bornes à 80\u00a0% cumulées : ${tnd(obs.total + lo)} à ${tnd(obs.total + hi)} sur l'année). ` +
          `Hypothèses : embauches au rythme des 12 derniers mois, hausse de janvier ${pct(proj.raise)}, dérive mensuelle hors janvier ${pct(state.drift, 2)}.`,
        priority: gap >= 0.05 ? 1 : gap > 0 ? 2 : 3,
        dedupKey: `masse:budget:${y}:${asOf}`,
      });
    }
  }
  return out;
}
