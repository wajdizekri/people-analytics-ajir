import type Database from "better-sqlite3";
import { getSetting } from "@/lib/settings";
import type { Scope } from "./model";
import type { MonthCal } from "./series";

// Recommandations collectives (jamais individuelles) : unité >= min_group, figures agrégées hors santé uniquement.

export const ABS_ACTIONS = {
  ANTICIPER_REMPLACEMENTS: "Anticiper les remplacements sur la période prévue",
  ECHANGER_ORGANISATION: "Échanger avec l'équipe sur l'organisation du travail",
  PLANIFIER_CONGES_PONTS: "Vérifier la planification des congés autour des ponts",
  PREVENTION_SANTE_SECURITE: "Construire un plan de prévention santé-sécurité avec la médecine du travail",
} as const;
export type AbsAction = keyof typeof ABS_ACTIONS;

// Seuils paramétrables (app_setting) ; valeurs par défaut si la clé est absente
export const ABS_RECO_SETTINGS = {
  abs_reco_seuil_niveau: 0.5, // prévision >= (1 + x) x taux entreprise sur 12 mois
  abs_reco_seuil_hausse: 0.25, // prévision moyenne 3 mois >= (1 + x) x taux de l'unité sur 12 mois
  abs_reco_ecart_min: 0.002, // écart minimal en taux (0,2 point) pour éviter le bruit des petites équipes
  abs_reco_anomalies_min: 2, // anomalies collectives sur les 3 derniers mois
} as const;
export type AbsRecoSettings = { -readonly [K in keyof typeof ABS_RECO_SETTINGS]: number };

export function recoSettings(sqlite: Database.Database): AbsRecoSettings {
  const out: AbsRecoSettings = { ...ABS_RECO_SETTINGS };
  for (const k of Object.keys(ABS_RECO_SETTINGS) as (keyof AbsRecoSettings)[]) {
    const v = Number(getSetting(sqlite, k));
    if (getSetting(sqlite, k) !== "" && Number.isFinite(v) && v >= 0) out[k] = v;
  }
  return out;
}

export type UnitContext = {
  unit: string;
  scope: Scope;
  label: string;
  active: number;
  ma12: number;
  ma3: number;
  companyMa12: number;
  forecasts: { month: string; value: number; lower: number; upper: number; cal: MonthCal }[];
  anomalies: { count: number; lastStart: string | null };
};

export type RecoDraft = { action: AbsAction; priority: 1 | 2 | 3; rationale: string };

const pct = (x: number) => `${(Math.round(x * 10000) / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\u00a0%`;
const pts = (x: number) => `${(Math.round(x * 10000) / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} point${Math.abs(x) >= 0.0002 ? "s" : ""}`;
const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
export const monthFr = (ym: string) => `${MONTHS[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const frDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
// « de mai 2026 », « d'avril 2026 »
const fromMonth = (ym: string) => (/^[aeiouéh]/i.test(monthFr(ym)) ? `d'${monthFr(ym)}` : `de ${monthFr(ym)}`);
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
// Unité avec son article : « l'équipe de … », « le département … », « l'ensemble de l'entreprise »
const theUnit = (u: UnitContext) =>
  u.scope === "ENTREPRISE"
    ? "l'ensemble de l'entreprise"
    : u.scope === "DEPARTEMENT"
      ? u.label.startsWith("Département ")
        ? lower(u.label).replace(/^d/, "le d")
        : `le département ${u.label}`
      : `l'${lower(u.label)}`;

export function draftRecommendations(u: UnitContext, s: AbsRecoSettings): RecoDraft[] {
  const out = new Map<AbsAction, RecoDraft>();
  const add = (action: AbsAction, priority: 1 | 2 | 3, sentence: string) => {
    const cur = out.get(action);
    if (cur) out.set(action, { action, priority: Math.min(cur.priority, priority) as 1 | 2 | 3, rationale: `${cur.rationale} ${sentence}` });
    else out.set(action, { action, priority, rationale: sentence });
  };
  const fc = u.forecasts;
  const avg = fc.reduce((a, f) => a + f.value, 0) / fc.length;
  const span = fc.length > 1 ? `${fromMonth(fc[0].month)} à ${monthFr(fc[fc.length - 1].month)}` : `en ${monthFr(fc[0].month)}`;
  const intro = `${u.label} (${u.active} collaborateur${u.active > 1 ? "s" : ""} en poste)`;

  const levelBar = Math.max(u.companyMa12 * (1 + s.abs_reco_seuil_niveau), u.companyMa12 + s.abs_reco_ecart_min);
  const high = u.scope === "ENTREPRISE" ? undefined : fc.find((f) => f.value >= levelBar);
  // Hausse = tendance récente (3 derniers mois au-dessus du niveau sur 12 mois) confirmée par la prévision, sans simple retour
  // à la moyenne d'une unité habituellement peu absente (prévision au moins égale au niveau de l'entreprise).
  const rising =
    u.ma3 >= u.ma12 + s.abs_reco_ecart_min &&
    avg >= Math.max(u.ma12 * (1 + s.abs_reco_seuil_hausse), u.ma12 + s.abs_reco_ecart_min) &&
    (u.scope === "ENTREPRISE" || avg >= u.companyMa12);
  const persistent = u.scope !== "ENTREPRISE" && u.anomalies.count >= s.abs_reco_anomalies_min;

  if (high) {
    add(
      "ANTICIPER_REMPLACEMENTS",
      high.value >= 2 * u.companyMa12 ? 1 : 2,
      `${intro} : taux d'absence non planifiée (hors santé et hors congés) prévu à ${pct(high.value)} en ${monthFr(high.month)} ` +
        `(fourchette probable ${pct(high.lower)} à ${pct(high.upper)}), contre ${pct(u.companyMa12)} en moyenne dans l'entreprise sur les 12 derniers mois.`,
    );
  }
  if (rising) {
    const sentence =
      `${intro} : hausse attendue de l'absentéisme non planifié, ${pct(avg)} en moyenne prévus ${span} contre ${pct(u.ma12)} sur les 12 derniers mois ` +
      `(+${pts(avg - u.ma12)}).`;
    if (u.scope === "ENTREPRISE") {
      add("ANTICIPER_REMPLACEMENTS", 2, sentence);
      add("PREVENTION_SANTE_SECURITE", 2, `${sentence} Démarche collective de prévention à construire avec la médecine du travail, sans ciblage individuel.`);
    } else add("ECHANGER_ORGANISATION", 2, sentence);
  }
  if (persistent) {
    const sentence =
      `${u.anomalies.count} épisodes d'absentéisme collectif inhabituel détectés sur les 3 derniers mois dans ${theUnit(u)}` +
      `${u.anomalies.lastStart ? ` (le dernier à partir du ${frDate(u.anomalies.lastStart)})` : ""}.`;
    add("ECHANGER_ORGANISATION", u.anomalies.count >= 3 ? 1 : 2, sentence);
    if (u.scope === "DEPARTEMENT")
      add("PREVENTION_SANTE_SECURITE", 2, `${sentence} Démarche collective de prévention à construire avec la médecine du travail, sans ciblage individuel.`);
  }
  // Ponts : seulement si le mois le plus chargé de la prévision compte un pont et dépasse le seuil de niveau
  const peak = fc.reduce((a, f) => (f.value > a.value ? f : a), fc[0]);
  if (u.scope !== "ENTREPRISE" && peak.cal.bridge > 0 && peak.value >= levelBar)
    add(
      "PLANIFIER_CONGES_PONTS",
      3,
      `${capitalize(monthFr(peak.month))} compte ${peak.cal.bridge} jour${peak.cal.bridge > 1 ? "s" : ""} de pont ; l'absentéisme non planifié y est prévu à ${pct(peak.value)} ` +
        `pour ${theUnit(u)}. Anticipez les demandes de congés autour de ces dates.`,
    );
  return [...out.values()];
}
