import type Database from "better-sqlite3";
import { frDate } from "../../features/dates";
import { excludeOpposed } from "../../privacy";
import { championTopicModel, loadBundle, loadGolden } from "../registry";
import { openTrainingsAt } from "./features";
import { checkGolden, explainTraining, levelOf, parseTrainingBundle, predictTraining, toVector, type TrainingLevel } from "./model";

export const TEAM_RECO_MIN = 3;
const INDIVIDUAL_PRIORITY_DAYS = 30;

export const relanceKey = (trainingId: number) => `FORMATION:RELANCE:${trainingId}`;
export const teamKey = (managerId: number, asOf: string) => `FORMATION:EQUIPE:${managerId}:${asOf.slice(0, 7)}`;

// Étape du batch mensuel : risque de non-réalisation à l'échéance des formations obligatoires ouvertes à asOf,
// relances individuelles (RH) et recommandations collectives (manager). Rejouable : même asOf => même état.
export function runStep(sqlite: Database.Database, asOf: string): { summary: string } {
  const row = championTopicModel(sqlite, "FORMATION");
  if (!row) return { summary: "aucun modèle FORMATION champion, étape ignorée" };
  const bundle = parseTrainingBundle(loadBundle(row));
  const golden = loadGolden<unknown>(row);
  if (golden) checkGolden(bundle, golden);

  // Salariés opposés au traitement prédictif : ni risque, ni facteur, ni recommandation individuelle
  const open = excludeOpposed(sqlite, openTrainingsAt(sqlite, asOf));
  const scored = open.map((tr) => {
    const x = toVector(bundle, tr.features);
    const prob = predictTraining(bundle, x);
    return { tr, prob, level: levelOf(bundle, prob), factors: explainTraining(bundle, tr.features, x, tr.lateCount) };
  });

  const names = new Map<number, { name: string; departmentId: number | null }>();
  const empStmt = sqlite.prepare("SELECT first_name || ' ' || last_name AS name, department_id AS departmentId FROM employee WHERE id = ?");
  const person = (id: number) => {
    let p = names.get(id);
    if (!p) names.set(id, (p = empStmt.get(id) as { name: string; departmentId: number | null }));
    return p;
  };

  const insRisk = sqlite.prepare(
    "INSERT INTO training_risk (training_id, employee_id, as_of, prob, level, factors_json, model_version) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const upsertReco = sqlite.prepare(
    `INSERT INTO insight_recommendation (topic, scope, audience, department_id, manager_id, employee_id, action_code, title, rationale, priority, dedup_key)
     VALUES ('FORMATION', @scope, @audience, @departmentId, @managerId, @employeeId, @actionCode, @title, @rationale, @priority, @dedupKey)
     ON CONFLICT(dedup_key) DO UPDATE SET title = excluded.title, rationale = excluded.rationale, priority = excluded.priority
       WHERE insight_recommendation.status = 'PROPOSEE'`,
  );

  let individual = 0;
  let collective = 0;
  const count: Record<TrainingLevel, number> = { ELEVE: 0, MOYEN: 0, FAIBLE: 0 };
  sqlite
    .transaction(() => {
      sqlite.prepare("DELETE FROM training_risk WHERE as_of = ?").run(asOf);
      const teams = new Map<number, number>();
      for (const s of scored) {
        count[s.level]++;
        insRisk.run(s.tr.id, s.tr.employeeId, asOf, s.prob, s.level, JSON.stringify(s.factors), bundle.version);
        if (s.level !== "FAIBLE" && s.tr.managerId != null) teams.set(s.tr.managerId, (teams.get(s.tr.managerId) ?? 0) + 1);
        if (s.level !== "ELEVE") continue;
        const days = s.tr.features.days_to_due ?? 0;
        const p = person(s.tr.employeeId);
        const why = s.factors.map((f) => f.phraseRh).join(" ; ");
        upsertReco.run({
          scope: "SALARIE",
          audience: "RH",
          departmentId: p.departmentId,
          managerId: s.tr.managerId,
          employeeId: s.tr.employeeId,
          actionCode: "RELANCE_FORMATION",
          title: `Relancer ${p.name} pour la formation « ${s.tr.title} », échéance dans ${days} jour${days > 1 ? "s" : ""}`,
          rationale: `Estimation au ${frDate(asOf)} : risque élevé que la formation obligatoire « ${s.tr.title} » (${s.tr.code}) ne soit pas terminée à l'échéance du ${frDate(s.tr.due)}.${why ? ` Facteurs : ${why}.` : ""}`,
          priority: days <= INDIVIDUAL_PRIORITY_DAYS ? 1 : 2,
          dedupKey: relanceKey(s.tr.id),
        });
        individual++;
      }
      for (const [managerId, n] of teams) {
        if (n < TEAM_RECO_MIN) continue;
        upsertReco.run({
          scope: "EQUIPE",
          audience: "MANAGER",
          departmentId: person(managerId)?.departmentId ?? null,
          managerId,
          employeeId: null,
          actionCode: "PLANIFIER_TEMPS_FORMATION",
          title: `${n} formations obligatoires de votre équipe risquent de dépasser l'échéance : planifiez du temps de formation`,
          rationale: `Estimation au ${frDate(asOf)} : ${n} formations obligatoires de vos collaborateurs directs, à échéance dans les ${
            bundle.feature_params.horizon_days
          } prochains jours, présentent un risque moyen ou élevé de ne pas être terminées à temps. Réservez des créneaux de formation avant les échéances.`,
          priority: n >= 2 * TEAM_RECO_MIN ? 1 : 2,
          dedupKey: teamKey(managerId, asOf),
        });
        collective++;
      }
    })
    .immediate();

  return {
    summary: `${scored.length} formations obligatoires ouvertes évaluées (${count.ELEVE} risque élevé, ${count.MOYEN} moyen) ; ${individual} relances RH, ${collective} recommandations d'équipe (modèle ${bundle.version})`,
  };
}

