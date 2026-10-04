import type Database from "better-sqlite3";
import { FEATURES, GROUPS } from "../features/spec";
import { OPPOSITION_LABEL, getOpposition } from "./index";
import { createZip } from "./zip";

// Export du droit d'accès (loi organique n° 2004-63, art. 32 : copie intelligible des données traitées).
// Une rubrique = un tableau à plat, libellés en français ; même contenu en JSON et en CSV (un fichier par rubrique).

type Cell = string | number | boolean | null;
export type Row = Record<string, Cell>;
export type Rubrique = { key: string; title: string; description: string; rows: Row[] };
export type AccessExport = {
  format: "people-analytics/acces-v1";
  generatedAt: string;
  employee: { id: number; matricule: string; lastName: string; firstName: string };
  notice: string[];
  rubriques: Rubrique[];
};

const ABSENCE_LABEL: Record<string, string> = {
  CONGE_ANNUEL: "Congé annuel",
  MALADIE: "Maladie",
  MATERNITE: "Maternité",
  ABSENCE_INJUSTIFIEE: "Absence injustifiée",
  CONGE_SANS_SOLDE: "Congé sans solde",
  AUTRE: "Autre",
};
const LEVEL_LABEL: Record<string, string> = { ELEVE: "Élevé", MOYEN: "Moyen", FAIBLE: "Faible" };
const REQUEST_LABEL: Record<string, string> = { ACCES: "Accès", OPPOSITION: "Opposition", RECTIFICATION: "Rectification" };
const REQUEST_STATUS: Record<string, string> = { OUVERTE: "Ouverte", TRAITEE: "Traitée", REFUSEE: "Refusée" };
const ACTION_LABEL: Record<string, string> = {
  "employee.view": "Consultation de la fiche",
  "whatif.run": "Simulation what-if",
  "whatif.search": "Recherche des leviers les plus efficaces (what-if)",
  "recommendation.decide": "Décision sur une recommandation",
  "recommendation.feedback": "Avis sur une recommandation",
  "alert.update": "Traitement d'une alerte",
  "privacy.view": "Consultation du dossier « droits des personnes »",
  "privacy.request.create": "Enregistrement d'une demande",
  "privacy.request.close": "Clôture d'une demande",
  "privacy.opposition.record": "Enregistrement de l'opposition",
  "privacy.opposition.lift": "Levée de l'opposition",
  "privacy.export": "Export du droit d'accès",
  "assistant.ask": "Question posée à l'assistant d'aide",
};

const groupLabel = (code: string) => GROUPS[code]?.label_rh ?? code;
const yesNo = (v: unknown) => (v ? "oui" : "non");

function all<T>(sqlite: Database.Database, sql: string, ...params: unknown[]): T[] {
  return sqlite.prepare(sql).all(...params) as T[];
}

export function buildAccessExport(sqlite: Database.Database, employeeId: number, now = new Date()): AccessExport | null {
  const e = sqlite
    .prepare(
      `SELECT e.*, d.code AS dept_code, d.name AS dept_name, m.matricule AS mgr_matricule, m.last_name || ' ' || m.first_name AS mgr_name
       FROM employee e LEFT JOIN department d ON d.id = e.department_id LEFT JOIN employee m ON m.id = e.manager_id WHERE e.id = ?`,
    )
    .get(employeeId) as Record<string, string | number | null> | undefined;
  if (!e) return null;
  const id = employeeId;
  const R: Rubrique[] = [];
  const add = (key: string, title: string, description: string, rows: Row[]) => R.push({ key, title, description, rows });

  add("identite", "Identité et poste", "Données d'identification et d'affectation importées depuis AJIR.", [
    {
      Matricule: e.matricule,
      Nom: e.last_name,
      Prénom: e.first_name,
      Sexe: e.sex,
      "Date de naissance": e.birth_date,
      "Date d'embauche": e.hire_date,
      "Code département": e.dept_code,
      Département: e.dept_name,
      "Famille de métier": e.job_family,
      Poste: e.job_title,
      Grade: e.grade,
      "Matricule du manager": e.mgr_matricule,
      Manager: e.mgr_name,
      Gouvernorat: e.governorate,
      "Situation familiale": e.marital_status,
      Statut: e.status,
      "Date de sortie": e.exit_date,
    },
  ]);

  add(
    "contrats",
    "Contrats",
    "Historique des contrats.",
    all<{ type: string; s: string; e: string | null }>(sqlite, "SELECT type, start_date AS s, end_date AS e FROM contract WHERE employee_id = ? ORDER BY start_date", id).map(
      (c) => ({ Type: c.type, Début: c.s, Fin: c.e }),
    ),
  );

  add(
    "sorties",
    "Sortie",
    "Sortie de l'entreprise, le cas échéant.",
    all<{ d: string; r: string; rd: string | null; at: string }>(
      sqlite,
      "SELECT exit_date AS d, reason AS r, resignation_date AS rd, recorded_at AS at FROM exit_event WHERE employee_id = ? ORDER BY exit_date",
      id,
    ).map((x) => ({ "Date de sortie": x.d, Motif: x.r, "Date de démission": x.rd, "Saisie le": x.at })),
  );

  add(
    "carriere",
    "Événements de carrière",
    "Promotions, augmentations (salaire de base), mutations, changements de manager ou de poste.",
    all<{ d: string; t: string; o: string | null; n: string | null; at: string }>(
      sqlite,
      "SELECT date AS d, type AS t, old_value AS o, new_value AS n, recorded_at AS at FROM career_event WHERE employee_id = ? ORDER BY date",
      id,
    ).map((c) => ({ Date: c.d, Type: c.t, "Ancienne valeur": c.o, "Nouvelle valeur": c.n, "Saisie le": c.at })),
  );

  add(
    "paie",
    "Paie",
    "Rémunération mensuelle (TND) et heures supplémentaires payées.",
    all<{ m: string; b: number; g: number; h: number; at: string }>(
      sqlite,
      "SELECT month AS m, base_salary AS b, gross_salary AS g, overtime_hours AS h, recorded_at AS at FROM payroll_monthly WHERE employee_id = ? ORDER BY month",
      id,
    ).map((p) => ({ Mois: p.m, "Salaire de base (TND)": p.b, "Salaire brut (TND)": p.g, "Heures supplémentaires": p.h, "Saisie le": p.at })),
  );

  add(
    "pointages",
    "Pointages",
    "Un enregistrement par jour pointé (heures d'arrivée et de départ, minutes travaillées, supplémentaires et de retard).",
    all<{ d: string; i: string | null; o: string | null; w: number; ot: number; l: number }>(
      sqlite,
      `SELECT date AS d, check_in AS i, check_out AS o, worked_minutes AS w, overtime_minutes AS ot, late_minutes AS l
       FROM attendance_daily WHERE employee_id = ? ORDER BY date`,
      id,
    ).map((a) => ({ Date: a.d, Arrivée: a.i, Départ: a.o, "Minutes travaillées": a.w, "Minutes supplémentaires": a.ot, "Minutes de retard": a.l })),
  );

  const absences = all<{ s: string; e: string; days: number; c: string; h: number; at: string }>(
    sqlite,
    "SELECT start_date AS s, end_date AS e, days, category AS c, is_health AS h, recorded_at AS at FROM absence_episode WHERE employee_id = ? ORDER BY start_date",
    id,
  );
  add(
    "absences",
    "Absences",
    "Épisodes d'absence. Seule la catégorie est connue du module ; maladie et maternité n'entrent dans aucun calcul individuel.",
    absences.map((a) => ({
      Début: a.s,
      Fin: a.e,
      Jours: a.days,
      Catégorie: ABSENCE_LABEL[a.c] ?? a.c,
      "Exclue des calculs (santé)": yesNo(a.h),
      "Saisie le": a.at,
    })),
  );
  const byCat = new Map<string, { n: number; days: number }>();
  for (const a of absences) {
    const c = byCat.get(a.c) ?? { n: 0, days: 0 };
    byCat.set(a.c, { n: c.n + 1, days: c.days + a.days });
  }
  add(
    "absences_par_categorie",
    "Absences par catégorie",
    "Totaux sur tout l'historique importé.",
    [...byCat].map(([c, v]) => ({ Catégorie: ABSENCE_LABEL[c] ?? c, Épisodes: v.n, Jours: Math.round(v.days * 100) / 100 })),
  );

  add(
    "formations",
    "Formations",
    "Formations suivies ou planifiées.",
    all<{ code: string; title: string; m: number; s: string | null; e: string | null; due: string | null; h: number; st: string }>(
      sqlite,
      `SELECT code, title, mandatory AS m, start_date AS s, end_date AS e, due_date AS due, hours AS h, status AS st
       FROM training WHERE employee_id = ? ORDER BY COALESCE(start_date, due_date)`,
      id,
    ).map((t) => ({ Code: t.code, Intitulé: t.title, Obligatoire: yesNo(t.m), Début: t.s, Fin: t.e, Échéance: t.due, Heures: t.h, Statut: t.st })),
  );

  add(
    "evaluations",
    "Évaluations",
    "Notes d'évaluation annuelle (1 à 5).",
    all<{ d: string; s: number; at: string }>(sqlite, "SELECT eval_date AS d, score AS s, recorded_at AS at FROM evaluation WHERE employee_id = ? ORDER BY eval_date", id).map(
      (v) => ({ Date: v.d, Note: v.s, "Saisie le": v.at }),
    ),
  );

  add(
    "variables",
    "Variables calculées",
    "Variables dérivées des données ci-dessus et utilisées par le modèle, par fin de mois (valeur après imputation).",
    all<{ asOf: string; fsv: string; v: string; p: number }>(
      sqlite,
      "SELECT as_of AS asOf, fsv, values_json AS v, partial_history AS p FROM feature_snapshot WHERE employee_id = ? ORDER BY as_of, fsv",
      id,
    ).flatMap((s) => {
      const values = JSON.parse(s.v) as number[];
      return FEATURES.map((f, i) => ({
        "Fin de mois": s.asOf,
        "Version des variables": s.fsv,
        Variable: f.name,
        Libellé: f.label.replace("{v}", String(values[i])),
        Groupe: groupLabel(f.group),
        Valeur: values[i] ?? null,
        Unité: f.unit,
        "Historique partiel": yesNo(s.p),
      }));
    }),
  );

  const preds = all<{ pid: number; asOf: string; runId: number; runStatus: string; version: string; kind: string; prob6: number; level: string; rank: number; lift: number }>(
    sqlite,
    `SELECT p.id AS pid, p.as_of AS asOf, p.run_id AS runId, r.status AS runStatus, m.version, m.kind, p.prob6, p.level, p.rank, p.lift
     FROM prediction p JOIN scoring_run r ON r.id = p.run_id JOIN model_version m ON m.id = p.model_version_id
     WHERE p.employee_id = ? ORDER BY p.as_of, p.run_id`,
    id,
  );
  const currentRun = Number((sqlite.prepare("SELECT value FROM app_setting WHERE key = 'current_run_id'").get() as { value: string } | undefined)?.value);
  add(
    "predictions",
    "Estimations du risque de départ",
    "Estimation à 6 mois par calcul mensuel. Un modèle à règles (B0) produit un nombre de points, pas une probabilité. Une estimation n'est pas une décision.",
    preds.map((p) => ({
      "Fin de mois": p.asOf,
      Calcul: p.runId,
      "Calcul affiché actuellement": yesNo(p.runId === currentRun),
      Modèle: p.version,
      "Type d'estimation": p.kind === "B0" ? "Score à règles (points)" : "Probabilité à 6 mois",
      Valeur: p.prob6,
      Niveau: LEVEL_LABEL[p.level] ?? p.level,
      Rang: p.rank,
      "Rapport à la moyenne (lift)": p.lift,
    })),
  );
  const predById = new Map(preds.map((p) => [p.pid, p]));
  add(
    "facteurs",
    "Facteurs associés aux estimations",
    "Contribution de chaque groupe de variables à l'estimation (en log-odds, par rapport au profil moyen) ; association statistique, pas une cause.",
    all<{ pid: number; g: string; c: number; rank: number; dir: string; tf: string | null; tv: number | null; rh: string | null; mg: string | null }>(
      sqlite,
      `SELECT f.prediction_id AS pid, f.group_code AS g, f.contribution AS c, f.rank, f.direction AS dir, f.top_feature AS tf, f.top_feature_value AS tv,
              f.phrase_rh AS rh, f.phrase_manager AS mg
       FROM prediction_factor f JOIN prediction p ON p.id = f.prediction_id WHERE p.employee_id = ? ORDER BY p.as_of, p.run_id, f.rank`,
      id,
    ).map((f) => ({
      "Fin de mois": predById.get(f.pid)?.asOf ?? null,
      Calcul: predById.get(f.pid)?.runId ?? null,
      Rang: f.rank,
      Groupe: groupLabel(f.g),
      Sens: f.dir === "HAUSSE" ? "augmente le risque" : "diminue le risque",
      Contribution: f.c,
      "Variable principale": f.tf,
      "Valeur de la variable": f.tv,
      "Explication (RH)": f.rh,
      "Explication (manager)": f.mg,
    })),
  );

  const recos = all<{ id: number; a: string; g: string; st: string; fb: string | null; cm: string | null; c: string; u: string | null }>(
    sqlite,
    `SELECT id, action_code AS a, trigger_group AS g, status AS st, feedback AS fb, comment AS cm, created_at AS c, updated_at AS u
     FROM recommendation WHERE employee_id = ? ORDER BY created_at, id`,
    id,
  );
  add(
    "recommandations",
    "Recommandations",
    "Actions proposées à la RH à partir des estimations, et suite donnée.",
    recos.map((r) => ({
      Numéro: r.id,
      "Proposée le": r.c,
      Action: r.a,
      Déclencheur: r.g === "NIVEAU_ELEVE" ? "Niveau de risque élevé" : groupLabel(r.g),
      Statut: r.st,
      Avis: r.fb,
      Commentaire: r.cm,
      "Mise à jour le": r.u,
    })),
  );
  add(
    "interventions",
    "Interventions",
    "Actions RH réalisées.",
    all<{ d: string; a: string; r: number | null }>(sqlite, "SELECT date AS d, action_code AS a, recommendation_id AS r FROM intervention WHERE employee_id = ? ORDER BY date", id).map(
      (i) => ({ Date: i.d, Action: i.a, Recommandation: i.r }),
    ),
  );

  const alerts = all<{ id: number; c: string; t: string; sev: string; st: string; ti: string; msg: string; cm: string | null }>(
    sqlite,
    "SELECT id, created_at AS c, type AS t, severity AS sev, status AS st, title AS ti, message AS msg, comment AS cm FROM alert WHERE employee_id = ? ORDER BY created_at, id",
    id,
  );
  add(
    "alertes",
    "Alertes",
    "Alertes adressées à la RH ou au manager qui concernent la personne.",
    alerts.map((a) => ({ Numéro: a.id, "Créée le": a.c, Type: a.t, Gravité: a.sev, Statut: a.st, Titre: a.ti, Message: a.msg, Commentaire: a.cm })),
  );

  add(
    "risques_formation",
    "Risque de non-achèvement des formations obligatoires",
    "Estimations individuelles calculées pour le suivi des formations obligatoires.",
    all<{ asOf: string; code: string | null; title: string | null; p: number; l: string; v: string }>(
      sqlite,
      `SELECT r.as_of AS asOf, t.code, t.title, r.prob AS p, r.level AS l, r.model_version AS v
       FROM training_risk r LEFT JOIN training t ON t.id = r.training_id WHERE r.employee_id = ? ORDER BY r.as_of`,
      id,
    ).map((r) => ({ "Fin de mois": r.asOf, Formation: r.code, Intitulé: r.title, Probabilité: r.p, Niveau: LEVEL_LABEL[r.l] ?? r.l, Modèle: r.v })),
  );
  add(
    "recommandations_thematiques",
    "Recommandations thématiques individuelles",
    "Recommandations des sujets absentéisme, formation ou charge de travail qui visent la personne.",
    all<{ c: string; t: string; a: string; ti: string; ra: string; st: string }>(
      sqlite,
      "SELECT created_at AS c, topic AS t, action_code AS a, title AS ti, rationale AS ra, status AS st FROM insight_recommendation WHERE employee_id = ? ORDER BY created_at",
      id,
    ).map((r) => ({ "Créée le": r.c, Sujet: r.t, Action: r.a, Titre: r.ti, Justification: r.ra, Statut: r.st })),
  );
  add(
    "signaux_absenteisme",
    "Signaux d'absentéisme",
    "Signaux individuels hors santé, à vérifier avec la personne sans présumer de leur cause.",
    all<{ s: string; e: string; m: string; o: number; x: number | null; msg: string }>(
      sqlite,
      "SELECT period_start AS s, period_end AS e, metric AS m, observed AS o, expected AS x, message AS msg FROM anomaly WHERE employee_id = ? ORDER BY period_start",
      id,
    ).map((a) => ({ Début: a.s, Fin: a.e, Indicateur: a.m, Observé: a.o, Attendu: a.x, Message: a.msg })),
  );

  add(
    "compte",
    "Compte applicatif",
    "Compte d'accès à l'application rattaché à la personne (sans mot de passe).",
    all<{ login: string; role: string; email: string | null; active: number; c: string }>(
      sqlite,
      "SELECT login, role, email, active, created_at AS c FROM app_user WHERE employee_id = ?",
      id,
    ).map((u) => ({ Identifiant: u.login, Rôle: u.role, "Adresse électronique": u.email, Actif: yesNo(u.active), "Créé le": u.c })),
  );

  const requests = all<{ id: number; t: string; st: string; note: string | null; c: string; cl: string | null }>(
    sqlite,
    "SELECT id, type AS t, status AS st, note, created_at AS c, closed_at AS cl FROM privacy_request WHERE employee_id = ? ORDER BY created_at, id",
    id,
  );
  add(
    "demandes",
    "Demandes d'exercice des droits",
    "Demandes d'accès, d'opposition et de rectification enregistrées.",
    requests.map((r) => ({ Numéro: r.id, Type: REQUEST_LABEL[r.t] ?? r.t, Statut: REQUEST_STATUS[r.st] ?? r.st, "Reçue le": r.c, "Clôturée le": r.cl, Note: r.note })),
  );
  const opp = getOpposition(sqlite, id);
  add(
    "opposition",
    "Opposition au traitement prédictif",
    "État actuel de l'opposition.",
    [{ État: opp ? OPPOSITION_LABEL : "Aucune opposition en cours", Depuis: opp?.since ?? null }],
  );

  // Journal : l'auteur est désigné par son rôle, jamais par son identifiant ; ni adresse IP ni détail technique
  const inList = (xs: number[]) => (xs.length ? xs.join(",") : "NULL");
  add(
    "journal",
    "Journal des accès et opérations",
    "Entrées du journal d'audit visant la personne, ses recommandations, alertes et demandes. L'auteur est indiqué par son rôle.",
    all<{ at: string; a: string; o: string; role: string | null }>(
      sqlite,
      `SELECT l.at, l.action AS a, l.outcome AS o, u.role FROM audit_log l LEFT JOIN app_user u ON u.id = l.user_id
       WHERE (l.target_type = 'employee' AND l.target_id = @sid)
          OR (l.target_type = 'recommendation' AND CAST(l.target_id AS INTEGER) IN (${inList(recos.map((r) => r.id))}))
          OR (l.target_type = 'alert' AND CAST(l.target_id AS INTEGER) IN (${inList(alerts.map((a) => a.id))}))
          OR (l.target_type = 'privacy_request' AND CAST(l.target_id AS INTEGER) IN (${inList(requests.map((r) => r.id))}))
          OR (CASE WHEN json_valid(l.detail_json) THEN json_extract(l.detail_json, '$.employeeId') END = @id)
       ORDER BY l.id`,
      { sid: String(id), id },
    ).map((l) => ({ Date: l.at, Opération: ACTION_LABEL[l.a] ?? l.a, Résultat: l.o === "OK" ? "effectuée" : l.o === "REFUSE" ? "refusée" : "échec", "Rôle de l'auteur": l.role ?? "système" })),
  );

  return {
    format: "people-analytics/acces-v1",
    generatedAt: now.toISOString(),
    employee: { id, matricule: String(e.matricule), lastName: String(e.last_name), firstName: String(e.first_name) },
    notice: [
      "Copie des données personnelles traitées par le module People Analytics d'AJIR (loi organique n° 2004-63, art. 32).",
      "Les données sources (identité, contrats, paie, absences, formations, évaluations) proviennent d'AJIR, qui reste la référence : toute rectification se fait dans AJIR.",
      "Les estimations du risque de départ sont des aides à la décision, jamais des décisions ; elles décrivent des associations statistiques, pas des causes.",
      "Les absences pour maladie ou maternité ne sont utilisées dans aucun calcul individuel.",
      "Document personnel : à remettre à la seule personne concernée.",
    ],
    rubriques: R,
  };
}

export function exportToJson(x: AccessExport): string {
  return JSON.stringify(
    {
      format: x.format,
      genereLe: x.generatedAt,
      salarie: { matricule: x.employee.matricule, nom: x.employee.lastName, prenom: x.employee.firstName },
      avertissements: x.notice,
      rubriques: Object.fromEntries(x.rubriques.map((r) => [r.key, { titre: r.title, description: r.description, lignes: r.rows }])),
    },
    null,
    2,
  );
}

const BOM = String.fromCharCode(0xfeff);
const CRLF = String.fromCharCode(13, 10);

// CSV : « ; », UTF-8 avec BOM (Excel), décimales avec « . » ; neutralise les formules (=, +, -, @) des champs texte
function csvCell(v: Cell): string {
  if (v == null) return "";
  if (typeof v === "boolean") return v ? "oui" : "non";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Row[], columns?: string[]): string {
  const cols = columns ?? [...new Set(rows.flatMap((r) => Object.keys(r)))];
  if (!cols.length) return `${BOM}Aucune donnée pour cette rubrique.${CRLF}`;
  const lines = [cols.map((c) => csvCell(c)).join(";"), ...rows.map((r) => cols.map((c) => csvCell(r[c] ?? null)).join(";"))];
  return BOM + lines.join("\r\n") + "\r\n";
}

export function exportToZip(x: AccessExport): Buffer {
  const readme = [
    `Droit d'accès — ${x.employee.lastName} ${x.employee.firstName} (matricule ${x.employee.matricule})`,
    `Généré le ${x.generatedAt}`,
    "",
    ...x.notice,
    "",
    "Contenu :",
    "- donnees.json : l'ensemble des rubriques dans un seul fichier ;",
    "- un fichier CSV par rubrique (séparateur « ; », UTF-8) :",
    ...x.rubriques.map((r, i) => `  ${String(i + 1).padStart(2, "0")}-${r.key}.csv — ${r.title} (${r.rows.length} ligne(s)) : ${r.description}`),
    "",
  ].join("\r\n");
  return createZip([
    { name: "LISEZMOI.txt", data: BOM + readme },
    { name: "donnees.json", data: exportToJson(x) },
    ...x.rubriques.map((r, i) => ({ name: `${String(i + 1).padStart(2, "0")}-${r.key}.csv`, data: toCsv(r.rows) })),
  ]);
}
