import type Database from "better-sqlite3";
import { getSetting } from "../settings";

// Règle de démarrage à froid (docs/RESULTATS_ML.md § 5d) : sous min_events_for_model démissions observées, la
// régression logistique gagne en moyenne moins de 0,02 d'AUC sur B0 et son O/E sort de la plage dans plus de 2 essais
// sur 3 : un champion LOGREG n'est pas utilisé, le scoring retombe sur le score à règles B0. Sous
// indicative_until_events, la probabilité reste « indicative » (calibration instable).

export const COLD_START_DEFAULTS = { minEvents: 30, indicativeUntil: 150 } as const;

export type ColdStartState = {
  asOf: string;
  events: number;
  threshold: number;
  indicativeUntil: number;
  // un champion probabiliste est remplacé par B0 pour ce calcul
  active: boolean;
  // probabilité affichée, mais à présenter comme indicative
  indicative: boolean;
  message: string | null;
};

function intSetting(sqlite: Database.Database, key: string, fallback: number): number {
  const raw = getSetting(sqlite, key);
  const v = Number(raw);
  return raw !== "" && Number.isInteger(v) && v >= 0 ? v : fallback;
}

export function coldStartPolicy(sqlite: Database.Database): { threshold: number; indicativeUntil: number } {
  return {
    threshold: intSetting(sqlite, "min_events_for_model", COLD_START_DEFAULTS.minEvents),
    indicativeUntil: intSetting(sqlite, "indicative_until_events", COLD_START_DEFAULTS.indicativeUntil),
  };
}

// Démissions observées à asOf : salariés distincts ayant au moins un mois éligible (feature_snapshot) suivi d'une
// démission ou d'un abandon dans les 6 mois (définition de v_label_panel), horizon clos à asOf et sortie saisie à asOf.
export function observedResignations(sqlite: Database.Database, asOf: string, fsv: string): number {
  const r = sqlite
    .prepare(
      `SELECT COUNT(DISTINCT fs.employee_id) AS n
       FROM feature_snapshot fs
       JOIN exit_event ee ON ee.employee_id = fs.employee_id
       WHERE fs.fsv = @fsv AND date(fs.as_of, '+6 months') <= @asOf
         AND ee.reason IN ('DEMISSION', 'ABANDON') AND ee.recorded_at <= @asOf
         AND (
           (COALESCE(ee.resignation_date, date(ee.exit_date, '-1 month')) > fs.as_of
            AND COALESCE(ee.resignation_date, date(ee.exit_date, '-1 month')) <= date(fs.as_of, '+6 months'))
           OR (COALESCE(ee.resignation_date, date(ee.exit_date, '-1 month')) <= fs.as_of
            AND ee.recorded_at > fs.as_of AND ee.exit_date > fs.as_of AND ee.exit_date <= date(fs.as_of, '+6 months'))
         )`,
    )
    .get({ fsv, asOf }) as { n: number };
  return r.n;
}

const fr = (n: number) => n.toLocaleString("fr-FR");

export function coldStartState(sqlite: Database.Database, asOf: string, championKind: string, fsv: string): ColdStartState {
  const { threshold, indicativeUntil } = coldStartPolicy(sqlite);
  const events = observedResignations(sqlite, asOf, fsv);
  const probabilistic = championKind !== "B0";
  const active = probabilistic && events < threshold;
  const indicative = probabilistic && !active && events < indicativeUntil;
  const message = active
    ? `Démarrage à froid : ${fr(events)} démission${events > 1 ? "s" : ""} observée${events > 1 ? "s" : ""} (seuil ${fr(threshold)}). ` +
      "Le modèle statistique n'est pas encore fiable sur si peu d'historique : les niveaux de risque viennent du score à règles B0, une méthode simple à points."
    : indicative
      ? `Probabilité indicative : ${fr(events)} démission${events > 1 ? "s" : ""} observée${events > 1 ? "s" : ""}, sous le seuil de ${fr(indicativeUntil)} à partir duquel les pourcentages sont fiables. Utilisez-la pour classer les collaborateurs, pas comme un pourcentage exact.`
      : null;
  return { asOf, events, threshold, indicativeUntil, active, indicative, message };
}
