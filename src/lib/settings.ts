import type Database from "better-sqlite3";

export const DEFAULT_SETTINGS: Record<string, string> = {
  // part de l'effectif scoré classée ÉLEVÉ (capacité d'entretiens RH du mois)
  capacity_rate: "0.02",
  // niveau MOYEN : lift >= ce seuil (risque >= 2x la moyenne)
  medium_lift: "2",
  // un import dont le score qualité est sous ce seuil bloque le scoring
  quality_threshold: "0.95",
  // pointeur vers le dernier calcul publié (vide = aucun)
  current_run_id: "",
  // délai de disponibilité par source quand AJIR ne stocke pas de date de saisie (jours)
  lag_absence_days: "10",
  lag_evaluation_days: "90",
  // SMIG mensuel (régime 48 h, TND) : valeur de repli du contrôle « salaire >= SMIG » si smig_schedule est absent ou invalide
  smig_monthly: "528.320",
  // Barème SMIG daté (JSON), appliqué selon le mois de paie : valeur en vigueur le 1er du mois. « from » null = sans borne.
  // 528,320 TND jusqu'au 31/12/2025, 554,736 TND à partir du 01/01/2026 (décret 2026-67) : valeurs À CONFIRMER.
  smig_schedule: '[{"from":null,"value":528.32},{"from":"2026-01-01","value":554.736}]',
  // facteur de Bradford hors santé (S² x D sur 12 mois) déclenchant un signal individuel RH « à vérifier »
  bradford_threshold: "250",

  // Démarrage à froid du modèle turnover (docs/RESULTATS_ML.md § 5d) : démissions ou abandons distincts observés
  // (horizon de 6 mois clos à la date de calcul). Sous min_events_for_model, un champion LOGREG n'est pas utilisé :
  // le scoring retombe sur le score à règles B0 (0 = règle désactivée). Sous indicative_until_events, la probabilité
  // est présentée comme « indicative » (calibration encore instable).
  min_events_for_model: "30",
  indicative_until_events: "150",

  // Rétention (scripts/retention.ts) : exports AJIR déposés (jours) ; prédictions et facteurs hors calcul publié (mois).
  retention_inbox_days: "90",
  retention_prediction_months: "24",

  // IA charge de travail : surcharge individuelle soutenue = heures sup pointées > seuil (h/mois) pendant N mois consécutifs
  workload_ot_threshold_h: "20",
  workload_ot_months: "3",

  // IA absentéisme, recommandations collectives (src/lib/ai/absenteeism/recommendations.ts, ABS_RECO_SETTINGS) :
  // niveau prévu >= (1 + x) × taux entreprise 12 mois ; hausse = prévision >= (1 + x) × taux 12 mois de l'unité ;
  // écart minimal en taux (0,002 = 0,2 point) ; nombre d'anomalies collectives sur 3 mois.
  abs_reco_seuil_niveau: "0.5",
  abs_reco_seuil_hausse: "0.25",
  abs_reco_ecart_min: "0.002",
  abs_reco_anomalies_min: "2",

  // Budget annuel de masse salariale brute (TND) : clé datée budget_masse_salariale_<AAAA> (ex. budget_masse_salariale_2027),
  // sans valeur par défaut. Absente = pas de recommandation budgétaire (src/lib/ai/workforce/compute.ts, BUDGET_KEY_PREFIX).
};

export function seedDefaultSettings(sqlite: Database.Database) {
  const stmt = sqlite.prepare("INSERT OR IGNORE INTO app_setting (key, value) VALUES (?, ?)");
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) stmt.run(k, v);
}

export function getSetting(sqlite: Database.Database, key: string): string {
  const row = sqlite.prepare("SELECT value FROM app_setting WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? DEFAULT_SETTINGS[key] ?? "";
}

// Dernier jour couvert par les données importées (posé par l'import ; à défaut, dernier pointage)
export function dataEndDate(sqlite: Database.Database): string | null {
  const s = getSetting(sqlite, "data_end_date");
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const r = sqlite.prepare("SELECT max(date) AS d FROM attendance_daily").get() as { d: string | null };
  return r.d;
}

export type SmigPeriod = { from: string | null; value: number };

// Barème validé et trié ; null si absent ou invalide (le contrôle retombe alors sur smig_monthly).
export function smigSchedule(sqlite: Database.Database): SmigPeriod[] | null {
  let raw: unknown;
  try {
    raw = JSON.parse(getSetting(sqlite, "smig_schedule"));
  } catch {
    return null;
  }
  if (!Array.isArray(raw) || !raw.length) return null;
  const out: SmigPeriod[] = [];
  for (const p of raw as { from?: unknown; value?: unknown }[]) {
    const from = p?.from ?? null;
    if (from !== null && (typeof from !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(from))) return null;
    if (typeof p.value !== "number" || !Number.isFinite(p.value) || p.value <= 0) return null;
    out.push({ from, value: p.value });
  }
  return out.sort((a, b) => (a.from ?? "").localeCompare(b.from ?? ""));
}

// SMIG applicable à un mois de paie (YYYY-MM) : valeur en vigueur le premier jour du mois.
export function smigResolver(sqlite: Database.Database): (month: string) => number {
  const schedule = smigSchedule(sqlite);
  const fallback = Number(getSetting(sqlite, "smig_monthly")) || 0;
  if (!schedule) return () => fallback;
  return (month) => {
    const day = `${month}-01`;
    let value: number | null = null;
    for (const p of schedule) if (p.from === null || p.from <= day) value = p.value;
    return value ?? fallback;
  };
}

export function setSetting(sqlite: Database.Database, key: string, value: string, userId?: number) {
  sqlite
    .prepare(
      "INSERT INTO app_setting (key, value, updated_by) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')",
    )
    .run(key, value, userId ?? null);
}
