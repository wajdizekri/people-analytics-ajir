import "server-only";
import { audit } from "@/lib/audit";
import { CONTRACT_LABELS, FEEDBACK_LABELS, LEVEL_LABELS, RECO_STATUS_LABELS, actionLabel } from "@/components/pilotage/labels";
import { SEVERITY_LABEL, STATUS_LABEL, TYPE_LABEL, concernedLabel, proposedAction } from "@/app/(app)/alerts/labels";
import { buildTable, type ColumnDef, type CsvTable } from "@/lib/export/csv";
import { EXPORT_FILE_PREFIX, EXPORT_MAX_ROWS, EXPORT_ROLES, pickExportParams, type ExportKind, type RawSearchParams } from "@/lib/export/kinds";
import type { AccessContext } from "./context";
import { forbidden } from "./errors";
import { employeeListSchema, listEmployees, parseQuery, referenceDate, type EmployeeRowManager, type EmployeeRowRh, type ModelKind, type RiskLevel } from "./employees";
import { alertFiltersSchema, countAlerts, listAlerts, type AlertDTO } from "./alerts";
import { listRecommendations, recommendationListSchema, type RecommendationRow } from "./recommendations";

export type ExportResult = {
  kind: ExportKind;
  table: CsvTable;
  total: number;
  truncated: boolean;
  dataDate: string;
  filename: string;
};

type Part = { table: CsvTable; total: number; view: string; filters: Record<string, unknown>; ignored: string[] };

const ALERT_PAGE = 500;
const levelLabel = (l: RiskLevel | null) => (l ? LEVEL_LABELS[l] : LEVEL_LABELS.NON_EVALUE);

// Pages successives de la requête de la liste (mêmes filtres, même tri, même DTO), jusqu'au plafond
function collectPages<R>(first: { rows: R[]; pageCount: number }, load: (page: number) => R[]): R[] {
  const rows = [...first.rows];
  for (let p = 2; p <= first.pageCount && rows.length < EXPORT_MAX_ROWS; p++) rows.push(...load(p));
  return rows.slice(0, EXPORT_MAX_ROWS);
}

const employeeColumns: ColumnDef<EmployeeRowManager>[] = [
  { header: "Matricule", value: (r) => r.matricule },
  { header: "Nom", value: (r) => r.lastName },
  { header: "Prénom", value: (r) => r.firstName },
  { header: "Poste", value: (r) => r.jobTitle },
  { header: "Département", value: (r) => r.department },
  { header: "Contrat", value: (r) => (r.contractType ? (CONTRACT_LABELS[r.contractType] ?? r.contractType) : null) },
  { header: "Ancienneté (mois)", type: "number", decimals: 0, value: (r) => r.tenureMonths },
  { header: "Niveau de risque", value: (r) => levelLabel(r.level) },
];

// Colonnes d'estimation : RH seulement, comme la colonne « Probabilité à 6 mois » (ou « Score à règles ») de la page
function estimateColumns(kind: ModelKind | null): ColumnDef<EmployeeRowRh>[] {
  if (kind === "B0") return [{ header: "Score à règles (points)", type: "number", decimals: 0, value: (r) => (r.estimate?.type === "SCORE_REGLES" ? r.estimate.points : null) }];
  return [
    { header: "Probabilité à 6 mois (%)", type: "number", decimals: 1, value: (r) => (r.estimate?.type === "PROBABILITE" ? r.estimate.prob6 * 100 : null) },
    { header: "Rapport au risque moyen (×)", type: "number", decimals: 1, value: (r) => (r.estimate?.type === "PROBABILITE" ? r.estimate.lift : null) },
  ];
}

function exportEmployees(ctx: AccessContext, raw: RawSearchParams): Part {
  const { data: q, ignored } = parseQuery(employeeListSchema, raw, "lenient");
  const first = listEmployees(ctx, { ...q, page: 1 });
  // Texte recherché non journalisé (peut être un nom) : seulement sa présence
  const filters = { q: q.q ? true : undefined, departement: q.departement, contrat: q.contrat, niveau: q.niveau, manager: q.manager, age: q.age, anciennete: q.anciennete, tri: q.tri, ordre: q.ordre };
  if (first.view === "RH") {
    const rows = collectPages(first, (page) => {
      const l = listEmployees(ctx, { ...q, page });
      return l.view === "RH" ? l.rows : [];
    });
    return { table: buildTable<EmployeeRowRh>([...employeeColumns, ...estimateColumns(first.run?.modelKind ?? null)], rows), total: first.total, view: "RH", filters, ignored };
  }
  const rows = collectPages(first, (page) => listEmployees(ctx, { ...q, page }).rows);
  return { table: buildTable(employeeColumns, rows), total: first.total, view: "MANAGER", filters, ignored };
}

const one = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);

function exportAlerts(ctx: AccessContext, raw: RawSearchParams): Part {
  // Comme la page : un filtre invalide fait ignorer tous les filtres
  const parsed = alertFiltersSchema.safeParse({ type: one(raw.type), status: one(raw.status), severity: one(raw.severity) });
  const filters = parsed.success ? { type: parsed.data.type, status: parsed.data.status, severity: parsed.data.severity } : {};
  const total = countAlerts(ctx, filters);
  const rows: AlertDTO[] = [];
  for (let offset = 0; offset < Math.min(total, EXPORT_MAX_ROWS); offset += ALERT_PAGE) {
    rows.push(...listAlerts(ctx, { ...filters, limit: Math.min(ALERT_PAGE, EXPORT_MAX_ROWS - offset), offset }));
  }
  const columns: ColumnDef<AlertDTO>[] = [
    { header: "Gravité", value: (a) => SEVERITY_LABEL[a.severity] },
    { header: "Type", value: (a) => TYPE_LABEL[a.type] },
    { header: "Statut", value: (a) => STATUS_LABEL[a.status] },
    { header: "Créée le", type: "datetime", value: (a) => a.createdAt },
    { header: "Titre", value: (a) => a.title },
    { header: "Description", value: (a) => a.message },
    { header: "Concerne", value: (a) => concernedLabel(a) },
    { header: "Action proposée", value: (a) => proposedAction(a, ctx.role) },
  ];
  return { table: buildTable(columns, rows), total, view: ctx.role, filters, ignored: parsed.success ? [] : ["type", "status", "severity"].filter((k) => raw[k] !== undefined) };
}

const PRIORITY: Record<RiskLevel, string> = { ELEVE: "Haute", MOYEN: "Moyenne", FAIBLE: "Basse" };

const recommendationColumns: ColumnDef<RecommendationRow>[] = [
  { header: "Statut", value: (r) => RECO_STATUS_LABELS[r.superseded ? "REMPLACEE" : r.status] },
  { header: "Priorité", value: (r) => (r.status === "PROPOSEE" ? (r.level ? PRIORITY[r.level] : PRIORITY.FAIBLE) : null) },
  { header: "Émise le", type: "date", value: (r) => r.createdAt },
  { header: "Matricule", value: (r) => r.employee.matricule },
  { header: "Collaborateur", value: (r) => r.employee.name },
  { header: "Département", value: (r) => r.department },
  { header: "Niveau de risque actuel", value: (r) => levelLabel(r.level) },
  { header: "Facteur associé", value: (r) => r.triggerLabel },
  { header: "Action recommandée", value: (r) => actionLabel(r.actionCode) },
  { header: "Décidée le", type: "date", value: (r) => (r.status !== "PROPOSEE" ? r.updatedAt : null) },
  { header: "Intervention le", type: "date", value: (r) => r.interventionDate },
  { header: "Commentaire ou motif", value: (r) => (r.status !== "PROPOSEE" ? r.comment : null) },
  { header: "Avis", value: (r) => (r.status !== "PROPOSEE" && r.feedback ? FEEDBACK_LABELS[r.feedback] : null) },
];

function exportRecommendations(ctx: AccessContext, raw: RawSearchParams): Part {
  const { data: q, ignored } = parseQuery(recommendationListSchema, raw, "lenient");
  const first = listRecommendations(ctx, { ...q, page: 1 });
  const rows = collectPages(first, (page) => listRecommendations(ctx, { ...q, page }).rows);
  const filters = { statut: q.statut, action: q.action, departement: q.departement };
  return { table: buildTable(recommendationColumns, rows), total: first.total, view: "RH", filters, ignored };
}

// Export d'une liste avec les filtres de sa page et le DTO du rôle ; chaque export (ou refus) est audité « export.csv »
export function exportList(ctx: AccessContext, kind: ExportKind, raw: RawSearchParams, meta: { ip?: string } = {}): ExportResult {
  const target = { type: "export", id: kind };
  if (!EXPORT_ROLES[kind].includes(ctx.role)) {
    audit(ctx.userId, "export.csv", target, "REFUSE", { role: ctx.role }, meta.ip);
    throw forbidden();
  }
  const params = pickExportParams(kind, raw);
  const part = kind === "employees" ? exportEmployees(ctx, params) : kind === "alerts" ? exportAlerts(ctx, params) : exportRecommendations(ctx, params);
  const rows = part.table.rows.length;
  const truncated = part.total > EXPORT_MAX_ROWS;
  const dataDate = referenceDate();
  audit(
    ctx.userId,
    "export.csv",
    target,
    "OK",
    { format: "csv", rows, total: part.total, truncated, view: part.view, filters: part.filters, ...(part.ignored.length ? { ignored: part.ignored } : {}) },
    meta.ip,
  );
  return { kind, table: part.table, total: part.total, truncated, dataDate, filename: `${EXPORT_FILE_PREFIX[kind]}-${dataDate}.csv` };
}
