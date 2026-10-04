import type Database from "better-sqlite3";

export type Severity = "REJET" | "CORRECTION" | "AVERTISSEMENT";

export const RULES = {
  EN_TETE_INVALIDE: { severity: "REJET", label: "En-tête invalide (fichier ignoré)" },
  FORMAT_LIGNE: { severity: "REJET", label: "Ligne mal formée" },
  CHAMP_OBLIGATOIRE: { severity: "REJET", label: "Champ obligatoire manquant" },
  DATE_INVALIDE: { severity: "REJET", label: "Date invalide" },
  VALEUR_INVALIDE: { severity: "REJET", label: "Valeur invalide" },
  MATRICULE_DUPLIQUE: { severity: "REJET", label: "Matricule en double" },
  DOUBLON: { severity: "REJET", label: "Ligne en double" },
  MATRICULE_INCONNU: { severity: "REJET", label: "Matricule inconnu" },
  DEPARTEMENT_INCONNU: { severity: "REJET", label: "Département inconnu" },
  SORTIE_AVANT_EMBAUCHE: { severity: "REJET", label: "Sortie antérieure à l'embauche" },
  FIN_AVANT_DEBUT: { severity: "REJET", label: "Fin antérieure au début" },
  ABSENCE_HORS_EMPLOI: { severity: "REJET", label: "Absence hors de la période d'emploi" },
  SALAIRE_SOUS_SMIG: { severity: "REJET", label: "Salaire de base inférieur au SMIG (salaire minimum légal)" },
  POINTAGE_DUPLIQUE: { severity: "REJET", label: "Pointage en double" },
  POINTAGE_FUTUR: { severity: "REJET", label: "Pointage postérieur à la date d'import" },
  POINTAGE_HORS_EMPLOI: { severity: "REJET", label: "Pointage hors de la période d'emploi" },
  GRADE_INCONNU: { severity: "CORRECTION", label: "Grade inconnu (grade ignoré)" },
  MANAGER_INEXISTANT: { severity: "CORRECTION", label: "Manager inexistant (rattachement ignoré)" },
  CYCLE_HIERARCHIQUE: { severity: "CORRECTION", label: "Cycle hiérarchique (rattachement rompu)" },
  SORTIE_SANS_MOTIF: { severity: "CORRECTION", label: "Sortie sans motif valide (motif « Autre » retenu)" },
  POINTAGE_SANS_SORTIE: { severity: "AVERTISSEMENT", label: "Pointage sans heure de sortie" },
  PAIE_INCOMPLETE: { severity: "AVERTISSEMENT", label: "Collaborateur actif sans paie du mois" },
  PAIE_BRUT_INCOHERENT: { severity: "AVERTISSEMENT", label: "Brut supérieur au double de la base" },
  VARIATION_VOLUME: { severity: "AVERTISSEMENT", label: "Variation de volume supérieure à 30 %" },
  FIN_DONNEES_AVANCE: { severity: "AVERTISSEMENT", label: "Fin des données avancée de plus de 45 jours" },
} as const satisfies Record<string, { severity: Severity; label: string }>;

export type Rule = keyof typeof RULES;

export type Reject = { reject: Rule; message: string };
export const reject = (rule: Rule, message: string): Reject => ({ reject: rule, message });
export const isReject = (v: unknown): v is Reject => typeof v === "object" && v !== null && "reject" in v;

// Détail conservé par fichier et par règle ; au-delà, seul le comptage est gardé (report_json).
export const DETAIL_CAP = 1000;
const RAW_MAX = 300;

export class IssueLog {
  readonly counts = new Map<string, Map<Rule, number>>();
  private pending: [number, string, number | null, Rule, string, string | null, Severity][] = [];
  private readonly insert: Database.Statement;

  constructor(
    private readonly sqlite: Database.Database,
    private readonly batchId: number,
  ) {
    this.insert = sqlite.prepare(
      "INSERT INTO import_rejection (batch_id, file, line, rule, message, raw, severity) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
  }

  add(file: string, line: number | null, rule: Rule, message: string, raw?: string | null) {
    let byRule = this.counts.get(file);
    if (!byRule) this.counts.set(file, (byRule = new Map()));
    const n = (byRule.get(rule) ?? 0) + 1;
    byRule.set(rule, n);
    if (n > DETAIL_CAP) return;
    const r = raw ? raw.replace(/[\r\n]+$/, "").slice(0, RAW_MAX) : null;
    this.pending.push([this.batchId, file, line, rule, message.slice(0, 500), r, RULES[rule].severity]);
  }

  count(file: string, rule: Rule): number {
    return this.counts.get(file)?.get(rule) ?? 0;
  }

  // À appeler dans une transaction ouverte (ou seule)
  flush() {
    if (!this.pending.length) return;
    for (const p of this.pending) this.insert.run(...p);
    this.pending = [];
  }

  flushInTransaction() {
    if (this.pending.length) this.sqlite.transaction(() => this.flush())();
  }
}
