import type Database from "better-sqlite3";
import { championTopicModel, loadBundle } from "../registry";
import { excludeOpposed } from "../../privacy";
import { predictGroup, validateBundle, type GroupForecast, type WorkloadBundle } from "./model";
import { groupRows, groupSeries, loadPanel, monthLabel, type GroupRow, type GroupSeries } from "./panel";
import { detectOverloads, ruleParams, type Overload, type RuleParams } from "./rule";

// Étape du batch mensuel « charge de travail ». asOf = fin du mois calculé (YYYY-MM-DD). Idempotente pour un même asOf.
// forecast (topic CHARGE_TRAVAIL, heures sup par ETP et par mois) :
//   horizon 1..3 = prévision (bornes = intervalle conforme à 80 %) ; horizon 0 = valeur observée des 12 derniers mois
//   pour la composition du groupe à l'origine (même définition que la prévision, lue par la page /charge).
//   Portées : EQUIPE (rattachés directs d'un manager, >= 5 personnes), DEPARTEMENT, ENTREPRISE (moyenne des
//   départements pondérée par l'effectif, sans intervalle).
// insight_recommendation : collectives (équipe -> audience MANAGER, département -> RH) quand la prévision dépasse le
// seuil de tension du bundle ; individuelles (RH seulement) pour les surcharges soutenues, hors salariés opposés.

const TOPIC = "CHARGE_TRAVAIL";
const MONTHS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
export const monthFr = (ym: string) => `${MONTHS_FR[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const h1 = (v: number) => (Math.round(v * 10) / 10).toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const quarter = (ym: string) => `${ym.slice(0, 4)}-T${Math.floor((Number(ym.slice(5, 7)) - 1) / 3) + 1}`;
const LEVEL_FR: Record<string, string> = { ELEVE: "élevé", MOYEN: "moyen", FAIBLE: "faible" };

export type InsightRow = {
  scope: "EQUIPE" | "DEPARTEMENT" | "SALARIE";
  audience: "RH" | "MANAGER";
  departmentId: number | null;
  managerId: number | null;
  employeeId: number | null;
  actionCode: string;
  title: string;
  rationale: string;
  priority: number;
  dedupKey: string;
};

type Predicted = GroupRow & GroupForecast;

// Une recommandation par groupe et trimestre du pic : un groupe durablement chargé n'en reçoit pas une par mois
export function collectiveRecommendation(rows: Predicted[], threshold: number, label: { scope: "EQUIPE" | "DEPARTEMENT"; name: string }): InsightRow | null {
  const high = rows.filter((r) => r.value >= threshold);
  if (!high.length) return null;
  const peak = high.reduce((a, b) => (b.value > a.value ? b : a));
  const confident = peak.lower >= threshold;
  const team = label.scope === "EQUIPE";
  const title = team
    ? `Charge prévue élevée pour votre équipe en ${monthFr(peak.month)} : répartissez les tâches ou prévoyez un renfort temporaire`
    : `Charge prévue élevée pour le département ${label.name} en ${monthFr(peak.month)} : répartissez les tâches ou prévoyez un renfort temporaire`;
  const others = high.filter((r) => r !== peak).map((r) => `${monthFr(r.month)} ${h1(r.value)} h`);
  const rationale =
    `Prévision : ${h1(peak.value)} h supplémentaires par ETP (équivalent temps plein) en ${monthFr(peak.month)} ` +
    `(fourchette probable à 80\u00a0% : ${h1(peak.lower)} à ${h1(peak.upper)} h), ` +
    `contre ${h1(peak.I12)} h en moyenne sur les 12 derniers mois et ${Number.isNaN(peak.last) ? "—" : h1(peak.last)} h le dernier mois. ` +
    `Seuil de tension : ${h1(threshold)} h par ETP, niveau atteint seulement par les 15\u00a0% de mois les plus chargés de l'historique. ` +
    (others.length ? `Autre${others.length > 1 ? "s" : ""} mois au-dessus du seuil : ${others.join(", ")}. ` : "") +
    `${team ? "Équipe" : "Département"} de ${peak.n} collaborateurs.` +
    (confident ? " Même la borne basse de la fourchette dépasse le seuil : la tension est probable." : "");
  return {
    scope: label.scope,
    audience: team ? "MANAGER" : "RH",
    departmentId: peak.home >= 0 ? peak.home : null,
    managerId: team ? peak.key : null,
    employeeId: null,
    actionCode: "REPARTIR_CHARGE",
    title,
    rationale,
    priority: confident ? 1 : 2,
    dedupKey: `${TOPIC}:${label.scope}:${peak.key}:${quarter(peak.month)}`,
  };
}

export function individualRecommendation(
  o: Overload,
  p: RuleParams,
  who: { name: string; departmentId: number | null; managerId: number | null; level: string | null },
): InsightRow {
  const recent = o.hours.slice(-6);
  const avg = o.hours.reduce((s, x) => s + x.hours, 0) / o.hours.length;
  const detail = recent.map((x) => `${monthFr(x.month)} : ${h1(x.hours)} h`).join(" ; ");
  return {
    scope: "SALARIE",
    audience: "RH",
    departmentId: who.departmentId,
    managerId: who.managerId,
    employeeId: o.employeeId,
    actionCode: "ENTRETIEN_CHARGE",
    title: `${who.name} cumule ${o.months} mois d'heures supplémentaires au-delà de ${h1(p.thresholdH)} h par mois : proposez un entretien sur la charge`,
    rationale:
      `Heures supplémentaires pointées au-delà de ${h1(p.thresholdH)} h chaque mois depuis ${monthFr(o.start)} (${o.months} mois consécutifs, règle : ${p.months} mois). ` +
      `${o.hours.length > recent.length ? "Six derniers mois" : "Détail"} : ${detail}. Moyenne sur la période : ${h1(avg)} h par mois.` +
      (who.level ? ` Niveau de risque de départ publié ce mois : ${LEVEL_FR[who.level] ?? who.level}.` : ""),
    priority: o.months >= p.months + 1 ? 1 : 2,
    dedupKey: `${TOPIC}:SALARIE:${o.employeeId}:${o.start}`,
  };
}

function writeRecommendations(sqlite: Database.Database, rows: InsightRow[]): number {
  const upsert = sqlite.prepare(
    `INSERT INTO insight_recommendation (topic, scope, audience, department_id, manager_id, employee_id, action_code, title, rationale, priority, dedup_key)
     VALUES ('${TOPIC}', @scope, @audience, @departmentId, @managerId, @employeeId, @actionCode, @title, @rationale, @priority, @dedupKey)
     ON CONFLICT(dedup_key) DO UPDATE SET title = excluded.title, rationale = excluded.rationale, priority = excluded.priority
     WHERE insight_recommendation.status = 'PROPOSEE'`,
  );
  let n = 0;
  for (const r of rows) n += upsert.run(r).changes;
  return n;
}

export function runStep(sqlite: Database.Database, asOf: string): { summary: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error(`asOf invalide : ${asOf}`);
  const month = asOf.slice(0, 7);
  const champion = championTopicModel(sqlite, TOPIC);
  const bundle = champion ? loadBundle<WorkloadBundle>(champion) : null;
  if (bundle) validateBundle(bundle);
  const params = ruleParams(sqlite, bundle);
  const parts: string[] = [];

  let forecastRows: Record<string, unknown>[] = [];
  const collective: InsightRow[] = [];
  const panel = bundle ? loadPanel(sqlite, month) : null;
  if (!bundle) parts.push("aucun modèle CHARGE_TRAVAIL champion, prévisions non calculées");
  else if (!panel) parts.push("aucun pointage, prévisions non calculées");
  else {
    const deptNames = new Map((sqlite.prepare("SELECT id, name FROM department").all() as { id: number; name: string }[]).map((d) => [d.id, d.name]));
    const dept = groupSeries(panel, "DEPARTEMENT");
    const teams = groupRows(panel, "EQUIPE", dept);
    const depts = groupRows(panel, "DEPARTEMENT", dept);
    const predicted: Predicted[] = [...teams.rows, ...depts.rows].map((r) => ({ ...r, ...predictGroup(bundle, r.scope, r.h, r.x, r.zbar12, r.s) }));
    const base = { topic: TOPIC, asOf, modelVersion: bundle.version };
    const observed = (scope: string, g: GroupSeries, departmentId: number | null, managerId: number | null) => {
      const out: Record<string, unknown>[] = [];
      for (let m = panel.origin - 11; m <= panel.origin; m++) {
        const v = g.I[m - panel.first];
        if (m >= panel.first && !Number.isNaN(v)) out.push({ ...base, scope, departmentId, managerId, month: monthLabel(m), horizon: 0, value: v, lower: null, upper: null });
      }
      return out;
    };
    forecastRows = [
      ...groupSeries(panel, "ENTREPRISE").flatMap((g) => observed("ENTREPRISE", g, null, null)),
      ...dept.flatMap((g) => observed("DEPARTEMENT", g, g.key, null)),
      ...teams.series.filter((g) => g.n >= bundle.group.min_members).flatMap((g) => observed("EQUIPE", g, g.home >= 0 ? g.home : null, g.key)),
      ...predicted.map((r) => ({
        ...base,
        scope: r.scope,
        departmentId: r.scope === "DEPARTEMENT" ? r.key : r.home >= 0 ? r.home : null,
        managerId: r.scope === "EQUIPE" ? r.key : null,
        month: r.month,
        horizon: r.h,
        value: r.value,
        lower: r.lower,
        upper: r.upper,
      })),
    ];
    for (const h of bundle.horizons) {
      const ds = predicted.filter((r) => r.scope === "DEPARTEMENT" && r.h === h);
      const n = ds.reduce((s, r) => s + r.n, 0);
      if (n > 0)
        forecastRows.push({ ...base, scope: "ENTREPRISE", departmentId: null, managerId: null, month: ds[0].month, horizon: h, value: ds.reduce((s, r) => s + r.n * r.value, 0) / n, lower: null, upper: null });
    }
    const byGroup = new Map<string, Predicted[]>();
    for (const r of predicted) {
      const k = `${r.scope}:${r.key}`;
      const list = byGroup.get(k);
      if (list) list.push(r);
      else byGroup.set(k, [r]);
    }
    for (const rows of byGroup.values()) {
      const r0 = rows[0];
      const reco = collectiveRecommendation(rows, bundle.tension.threshold_h, { scope: r0.scope, name: deptNames.get(r0.key) ?? `n° ${r0.key}` });
      if (reco) collective.push(reco);
    }
    parts.push(`${predicted.length} prévisions (${teams.rows.length / bundle.horizons.length} équipes, ${depts.rows.length / bundle.horizons.length} départements)`);
  }

  const overloads = excludeOpposed(sqlite, detectOverloads(sqlite, month, params));
  const who = sqlite.prepare(
    `SELECT e.first_name || ' ' || e.last_name AS name, e.department_id AS departmentId, e.manager_id AS managerId,
            (SELECT p.level FROM prediction p JOIN scoring_run r ON r.id = p.run_id
              WHERE r.status = 'PUBLIE' AND r.as_of = @asOf AND p.employee_id = e.id ORDER BY r.id DESC LIMIT 1) AS level
       FROM employee e WHERE e.id = @id`,
  );
  const individual = overloads.map((o) =>
    individualRecommendation(o, params, who.get({ id: o.employeeId, asOf }) as { name: string; departmentId: number | null; managerId: number | null; level: string | null }),
  );

  let written = 0;
  sqlite.transaction(() => {
    if (bundle && panel) {
      sqlite.prepare("DELETE FROM forecast WHERE topic = ? AND as_of = ?").run(TOPIC, asOf);
      const ins = sqlite.prepare(
        `INSERT INTO forecast (topic, scope, department_id, manager_id, as_of, month, horizon, value, lower, upper, model_version)
         VALUES (@topic, @scope, @departmentId, @managerId, @asOf, @month, @horizon, @value, @lower, @upper, @modelVersion)`,
      );
      for (const r of forecastRows) ins.run(r);
    }
    written = writeRecommendations(sqlite, [...collective, ...individual]);
  })();
  parts.push(`${collective.length} recommandation(s) collective(s), ${individual.length} surcharge(s) individuelle(s) (seuil ${params.thresholdH} h, ${params.months} mois)`);
  if (written < collective.length + individual.length) parts.push(`${collective.length + individual.length - written} déjà traitée(s), inchangée(s)`);
  return { summary: parts.join(" ; ") };
}
