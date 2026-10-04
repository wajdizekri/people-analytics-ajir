// Masquage des messages de rejet d'import montrés à l'ADMIN (séparation des tâches : aucune donnée RH).
// Règle (arbitrage du 30/09/2026, docs/conformite/registre-traitements.md) :
// - le matricule reste visible : il est nécessaire pour retrouver et corriger la ligne dans AJIR ;
// - montants (TND) et valeurs brutes des champs sensibles masqués, quel que soit le fichier ;
// - absences.csv : toutes les dates, catégories, durées et autres valeurs d'absence masquées (seul le matricule reste),
//   la RH garde le détail. Dans les autres fichiers, dates d'événement et codes restent visibles.

import { ABSENCE_CATEGORIES } from "@/db/schema";

export const MASK = "•••";

// Champs dont la valeur brute reste affichée dans « valeur invalide pour <champ> : « … » »
const VISIBLE_FIELDS = new Set([
  "matricule",
  "manager_matricule",
  "department_code",
  "code",
  "login",
  "role",
  "active",
  "month",
  "date",
  "start_date",
  "end_date",
  "hire_date",
  "exit_date",
  "resignation_date",
  "eval_date",
  "due_date",
  "recorded_at",
  "contract_type",
  "event_type",
  "training_code",
  "mandatory",
  "status",
]);

const FIELD_VALUE = /(pour ([A-Za-z_]+) : « )([^»]*)( »)/g;
const AMOUNT = /(SMIG \()?(\d+(?:[.,]\d+)?)(\s*TND)/g;
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/g;
const ABSENCE_CATEGORY = new RegExp(`\\b(?:${ABSENCE_CATEGORIES.join("|")})\\b`, "g");
const ABSENCE_FILE = "absences.csv";

function maskAbsence(message: string): string {
  return message
    .replace(FIELD_VALUE, (all, head: string, field: string, _value: string, tail: string) => (field === "matricule" ? all : `${head}${MASK}${tail}`))
    .replace(ISO_DATE, MASK)
    .replace(ABSENCE_CATEGORY, MASK);
}

export function maskRejectionMessage(message: string, file?: string | null): string {
  const masked = message
    .replace(FIELD_VALUE, (all, head: string, field: string, _value: string, tail: string) =>
      VISIBLE_FIELDS.has(field) ? all : `${head}${MASK}${tail}`,
    )
    .replace(AMOUNT, (all, smig: string | undefined, _n: string, unit: string) => (smig ? all : `${MASK}${unit}`));
  return file && file.split(/[\\/]/).pop() === ABSENCE_FILE ? maskAbsence(masked) : masked;
}
