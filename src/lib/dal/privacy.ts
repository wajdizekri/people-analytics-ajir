import "server-only";
import { z } from "zod";
import { getDb } from "@/db/client";
import { audit, type AuditTarget } from "@/lib/audit";
import { OPPOSITION_LABEL, getOpposition, liftOpposition, recordOpposition } from "@/lib/privacy";
import { buildAccessExport, exportToJson, exportToZip } from "@/lib/privacy/export";
import type { AccessContext } from "./context";
import { HttpError, forbidden, notFound } from "./errors";
import type { AuditMeta } from "./employees";

// Droits des personnes (loi organique n° 2004-63, art. 32 à 42) : registre des demandes, export du droit d'accès,
// opposition au traitement prédictif, suivi des rectifications (faites dans AJIR). RH seule ; tout est audité.

export const PRIVACY_TYPES = ["ACCES", "OPPOSITION", "RECTIFICATION"] as const;
export const PRIVACY_STATUSES = ["OUVERTE", "TRAITEE", "REFUSEE"] as const;
export type PrivacyType = (typeof PRIVACY_TYPES)[number];
export type PrivacyStatus = (typeof PRIVACY_STATUSES)[number];
export const EXPORT_FORMATS = ["json", "zip"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

// Délai de réponse : un mois (art. 38)
export const RESPONSE_DELAY_MONTHS = 1;

function ensureRh(ctx: AccessContext, action: string, target?: AuditTarget, meta?: Partial<AuditMeta>): void {
  if (ctx.role === "RH") return;
  audit(ctx.userId, action, target, "REFUSE", { role: ctx.role, ...(meta?.source ? { source: meta.source } : {}) }, meta?.ip);
  throw forbidden();
}

const employeeExists = (id: number) => !!getDb().sqlite.prepare("SELECT 1 AS ok FROM employee WHERE id = ?").get(id);

// ---------- Recherche ----------

export const privacySearchSchema = z
  .string()
  .trim()
  .min(2, "Saisissez au moins 2 caractères : nom, prénom ou matricule.")
  .max(100, "Recherche trop longue : 100 caractères au plus.");

export type PrivacySubjectRow = {
  id: number;
  matricule: string;
  lastName: string;
  firstName: string;
  department: string | null;
  status: "ACTIF" | "SORTI";
  opposed: boolean;
  openRequests: number;
};

export function searchPrivacySubjects(ctx: AccessContext, q: string): PrivacySubjectRow[] {
  ensureRh(ctx, "privacy.search");
  const term = privacySearchSchema.parse(q);
  const like = `%${term.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
  const rows = getDb()
    .sqlite.prepare(
      `SELECT e.id, e.matricule, e.last_name AS lastName, e.first_name AS firstName, d.name AS department, e.status,
              EXISTS (SELECT 1 FROM employee_opposition o WHERE o.employee_id = e.id) AS opposed,
              (SELECT COUNT(*) FROM privacy_request r WHERE r.employee_id = e.id AND r.status = 'OUVERTE') AS openRequests
       FROM employee e LEFT JOIN department d ON d.id = e.department_id
       WHERE e.matricule LIKE @q ESCAPE '\\' OR e.last_name || ' ' || e.first_name LIKE @q ESCAPE '\\' OR e.first_name || ' ' || e.last_name LIKE @q ESCAPE '\\'
       ORDER BY e.matricule = @exact DESC, e.last_name COLLATE NOCASE, e.first_name COLLATE NOCASE LIMIT 20`,
    )
    .all({ q: like, exact: term }) as (Omit<PrivacySubjectRow, "opposed"> & { opposed: number })[];
  return rows.map((r) => ({ ...r, opposed: !!r.opposed }));
}

// ---------- Registre ----------

export type PrivacyRequestDto = {
  id: number;
  employee: { id: number; matricule: string; name: string };
  type: PrivacyType;
  status: PrivacyStatus;
  note: string | null;
  createdAt: string;
  createdBy: string | null;
  closedAt: string | null;
  closedBy: string | null;
  dueDate: string;
  overdue: boolean;
};

export const requestListSchema = z.object({
  statut: z.enum(PRIVACY_STATUSES).optional(),
  type: z.enum(PRIVACY_TYPES).optional(),
});

const REQUEST_SELECT = `
  SELECT r.id, r.employee_id AS employeeId, e.matricule, e.last_name || ' ' || e.first_name AS name, r.type, r.status, r.note,
         r.created_at AS createdAt, cu.login AS createdBy, r.closed_at AS closedAt, xu.login AS closedBy,
         date(r.created_at, '+${RESPONSE_DELAY_MONTHS} months') AS dueDate
  FROM privacy_request r JOIN employee e ON e.id = r.employee_id
  LEFT JOIN app_user cu ON cu.id = r.created_by LEFT JOIN app_user xu ON xu.id = r.closed_by`;

type RequestRaw = Omit<PrivacyRequestDto, "employee" | "overdue"> & { employeeId: number; matricule: string; name: string };

const toRequestDto = (r: RequestRaw, today: string): PrivacyRequestDto => ({
  id: r.id,
  employee: { id: r.employeeId, matricule: r.matricule, name: r.name },
  type: r.type,
  status: r.status,
  note: r.note,
  createdAt: r.createdAt,
  createdBy: r.createdBy,
  closedAt: r.closedAt,
  closedBy: r.closedBy,
  dueDate: r.dueDate,
  overdue: r.status === "OUVERTE" && r.dueDate < today,
});

export type PrivacyRegisterDto = {
  rows: PrivacyRequestDto[];
  counts: { open: number; overdue: number; oppositions: number; total: number };
};

export function listPrivacyRequests(ctx: AccessContext, filters: z.input<typeof requestListSchema> = {}): PrivacyRegisterDto {
  ensureRh(ctx, "privacy.list");
  const f = requestListSchema.parse(filters);
  const { sqlite } = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const where: string[] = [];
  if (f.statut) where.push("r.status = @statut");
  if (f.type) where.push("r.type = @type");
  const rows = sqlite
    .prepare(`${REQUEST_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY r.status = 'OUVERTE' DESC, r.created_at DESC, r.id DESC LIMIT 200`)
    .all({ statut: f.statut, type: f.type }) as RequestRaw[];
  const c = sqlite
    .prepare(
      `SELECT COUNT(*) AS total, COALESCE(SUM(status = 'OUVERTE'), 0) AS open,
              COALESCE(SUM(status = 'OUVERTE' AND date(created_at, '+${RESPONSE_DELAY_MONTHS} months') < @today), 0) AS overdue,
              (SELECT COUNT(*) FROM employee_opposition) AS oppositions
       FROM privacy_request`,
    )
    .get({ today }) as PrivacyRegisterDto["counts"];
  return { rows: rows.map((r) => toRequestDto(r, today)), counts: c };
}

// ---------- Dossier d'un salarié ----------

export type PrivacySubjectDto = {
  employee: { id: number; matricule: string; lastName: string; firstName: string; department: string | null; jobTitle: string | null; status: "ACTIF" | "SORTI"; hireDate: string; exitDate: string | null };
  opposition: { label: string; since: string; requestId: number | null; recordedBy: string | null } | null;
  requests: PrivacyRequestDto[];
  inventory: { label: string; count: number }[];
};

const INVENTORY: [string, string][] = [
  ["Contrats", "SELECT COUNT(*) AS n FROM contract WHERE employee_id = ?"],
  ["Mois de paie", "SELECT COUNT(*) AS n FROM payroll_monthly WHERE employee_id = ?"],
  ["Jours pointés", "SELECT COUNT(*) AS n FROM attendance_daily WHERE employee_id = ?"],
  ["Absences", "SELECT COUNT(*) AS n FROM absence_episode WHERE employee_id = ?"],
  ["Formations", "SELECT COUNT(*) AS n FROM training WHERE employee_id = ?"],
  ["Évaluations", "SELECT COUNT(*) AS n FROM evaluation WHERE employee_id = ?"],
  ["Mois de variables calculées", "SELECT COUNT(*) AS n FROM feature_snapshot WHERE employee_id = ?"],
  ["Estimations du risque de départ", "SELECT COUNT(*) AS n FROM prediction WHERE employee_id = ?"],
  ["Recommandations", "SELECT COUNT(*) AS n FROM recommendation WHERE employee_id = ?"],
  ["Alertes", "SELECT COUNT(*) AS n FROM alert WHERE employee_id = ?"],
  ["Entrées du journal d'audit (fiche)", "SELECT COUNT(*) AS n FROM audit_log WHERE target_type = 'employee' AND target_id = CAST(? AS TEXT)"],
];

export function getPrivacySubject(ctx: AccessContext, employeeId: number): PrivacySubjectDto {
  const target = { type: "employee", id: employeeId };
  ensureRh(ctx, "privacy.view", target);
  const { sqlite } = getDb();
  const employee = sqlite
    .prepare(
      `SELECT e.id, e.matricule, e.last_name AS lastName, e.first_name AS firstName, d.name AS department, e.job_title AS jobTitle,
              e.status, e.hire_date AS hireDate, e.exit_date AS exitDate
       FROM employee e LEFT JOIN department d ON d.id = e.department_id WHERE e.id = ?`,
    )
    .get(employeeId) as PrivacySubjectDto["employee"] | undefined;
  if (!employee) throw notFound("Collaborateur");
  const opp = getOpposition(sqlite, employeeId);
  const today = new Date().toISOString().slice(0, 10);
  const requests = (sqlite.prepare(`${REQUEST_SELECT} WHERE r.employee_id = ? ORDER BY r.created_at DESC, r.id DESC`).all(employeeId) as RequestRaw[]).map((r) =>
    toRequestDto(r, today),
  );
  const recordedBy = opp?.recordedBy != null ? ((sqlite.prepare("SELECT login FROM app_user WHERE id = ?").get(opp.recordedBy) as { login: string } | undefined)?.login ?? null) : null;
  audit(ctx.userId, "privacy.view", target, "OK");
  return {
    employee,
    opposition: opp ? { label: OPPOSITION_LABEL, since: opp.since, requestId: opp.requestId, recordedBy } : null,
    requests,
    inventory: INVENTORY.map(([label, sql]) => ({ label, count: (sqlite.prepare(sql).get(employeeId) as { n: number }).n })),
  };
}

// Pour la fiche salarié : mention « Opposition au traitement prédictif ». RH seule ; le manager ne reçoit rien
// (minimisation : il voit seulement l'absence d'estimation, sans en connaître la raison).
export function getOppositionFlag(ctx: AccessContext, employeeId: number): { label: string; since: string } | null {
  if (ctx.role !== "RH") return null;
  const opp = getOpposition(getDb().sqlite, employeeId);
  return opp ? { label: OPPOSITION_LABEL, since: opp.since } : null;
}

// ---------- Demandes ----------

const note = z.string().trim().max(1000, "Note trop longue : 1\u00a0000 caractères au plus.");

export const createRequestSchema = z
  .object({
    employeeId: z.coerce
      .number({ error: "Collaborateur non précisé : recherchez-le puis ouvrez son dossier avant d'enregistrer la demande." })
      .int()
      .positive("Collaborateur non précisé : recherchez-le puis ouvrez son dossier avant d'enregistrer la demande."),
    type: z.enum(PRIVACY_TYPES, { error: "Choisissez le type de demande." }),
    note: note.optional(),
  })
  .refine((v) => v.type !== "RECTIFICATION" || (v.note ?? "").length >= 3, {
    path: ["note"],
    message: "Décrivez la donnée à rectifier et la valeur attendue (3 caractères au moins).",
  });

export type CreateRequestResult = { id: number; opposition: { purged: ReturnType<typeof recordOpposition>["purged"] } | null };

export function createPrivacyRequest(ctx: AccessContext, input: z.input<typeof createRequestSchema>): CreateRequestResult {
  ensureRh(ctx, "privacy.request.create");
  const data = createRequestSchema.parse(input);
  if (!employeeExists(data.employeeId)) throw notFound("Collaborateur");
  const { sqlite } = getDb();
  if (data.type === "OPPOSITION" && getOpposition(sqlite, data.employeeId))
    throw new HttpError(409, "DEJA_OPPOSE", "Une opposition est déjà en vigueur pour ce collaborateur : aucune nouvelle demande n'est nécessaire.");

  const result = sqlite
    .transaction((): CreateRequestResult => {
      const id = Number(
        sqlite
          .prepare("INSERT INTO privacy_request (employee_id, type, note, created_by) VALUES (?, ?, ?, ?)")
          .run(data.employeeId, data.type, data.note || null, ctx.userId).lastInsertRowid,
      );
      // Art. 42 : l'opposition suspend immédiatement le traitement, avant même l'instruction de la demande
      const opposition = data.type === "OPPOSITION" ? { purged: recordOpposition(sqlite, { employeeId: data.employeeId, requestId: id, userId: ctx.userId }).purged } : null;
      return { id, opposition };
    })
    .immediate();

  const target = { type: "employee", id: data.employeeId };
  audit(ctx.userId, "privacy.request.create", target, "OK", { requestId: result.id, requestType: data.type });
  if (result.opposition) audit(ctx.userId, "privacy.opposition.record", target, "OK", { requestId: result.id, purged: result.opposition.purged });
  return result;
}

export const closeRequestSchema = z
  .object({ status: z.enum(["TRAITEE", "REFUSEE"], { error: "Choisissez l'issue de la demande." }), note: note.optional() })
  .refine((v) => v.status !== "REFUSEE" || (v.note ?? "").length >= 3, { path: ["note"], message: "Le motif du refus est obligatoire : indiquez-le en 3 caractères au moins." });

// Refuser une opposition (motif légitime absent, art. 42) lève la suspension : le salarié est recalculé au prochain run
export function closePrivacyRequest(ctx: AccessContext, requestId: number, input: z.input<typeof closeRequestSchema>): { lifted: boolean } {
  ensureRh(ctx, "privacy.request.close", { type: "privacy_request", id: requestId });
  const data = closeRequestSchema.parse(input);
  const { sqlite } = getDb();
  const req = sqlite.prepare("SELECT id, employee_id AS employeeId, type, status FROM privacy_request WHERE id = ?").get(requestId) as
    | { id: number; employeeId: number; type: PrivacyType; status: PrivacyStatus }
    | undefined;
  if (!req) throw notFound("Demande");
  if (req.status !== "OUVERTE") throw new HttpError(409, "DEJA_CLOTUREE", "Cette demande est déjà clôturée.");

  const lifted = sqlite
    .transaction(() => {
      const closing = `Clôture (${data.status === "TRAITEE" ? "traitée" : "refusée"}) : ${data.note || "sans commentaire"}`;
      sqlite
        .prepare(
          `UPDATE privacy_request SET status = @s, closed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), closed_by = @u,
             note = CASE WHEN note IS NULL OR note = '' THEN @c ELSE note || char(10) || @c END WHERE id = @id AND status = 'OUVERTE'`,
        )
        .run({ s: data.status, u: ctx.userId, c: closing, id: requestId });
      return req.type === "OPPOSITION" && data.status === "REFUSEE" ? liftOpposition(sqlite, req.employeeId) : false;
    })
    .immediate();

  const target = { type: "employee", id: req.employeeId };
  audit(ctx.userId, "privacy.request.close", target, "OK", { requestId, requestType: req.type, status: data.status });
  if (lifted) audit(ctx.userId, "privacy.opposition.lift", target, "OK", { requestId, reason: "refus" });
  return { lifted };
}

export const liftOppositionSchema = z.object({ note: note.min(3, "Indiquez l'origine de la levée (retrait du collaborateur, date du courrier…), en 3 caractères au moins.") });

// Retrait de l'opposition par le salarié : tracé comme une demande d'opposition clôturée, et les demandes ouvertes sont closes
export function liftEmployeeOpposition(ctx: AccessContext, employeeId: number, input: z.input<typeof liftOppositionSchema>): { requestId: number } {
  const target = { type: "employee", id: employeeId };
  ensureRh(ctx, "privacy.opposition.lift", target);
  const data = liftOppositionSchema.parse(input);
  if (!employeeExists(employeeId)) throw notFound("Collaborateur");
  const { sqlite } = getDb();
  if (!getOpposition(sqlite, employeeId)) throw new HttpError(409, "AUCUNE_OPPOSITION", "Aucune opposition n'est en vigueur pour ce collaborateur : il n'y a rien à lever.");
  const requestId = sqlite
    .transaction(() => {
      liftOpposition(sqlite, employeeId);
      const text = `Levée de l'opposition : ${data.note}`;
      sqlite
        .prepare(
          `UPDATE privacy_request SET status = 'TRAITEE', closed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), closed_by = @u,
             note = CASE WHEN note IS NULL OR note = '' THEN @c ELSE note || char(10) || @c END
           WHERE employee_id = @e AND type = 'OPPOSITION' AND status = 'OUVERTE'`,
        )
        .run({ u: ctx.userId, c: text, e: employeeId });
      return Number(
        sqlite
          .prepare(
            `INSERT INTO privacy_request (employee_id, type, status, note, created_by, closed_at, closed_by)
             VALUES (?, 'OPPOSITION', 'TRAITEE', ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), ?)`,
          )
          .run(employeeId, text, ctx.userId, ctx.userId).lastInsertRowid,
      );
    })
    .immediate();
  audit(ctx.userId, "privacy.opposition.lift", target, "OK", { requestId, reason: "retrait" });
  return { requestId };
}

// ---------- Export du droit d'accès ----------

export type AccessExportFile = { filename: string; contentType: string; body: Buffer; rubriques: number };

// Lié à une demande d'ACCÈS enregistrée (non refusée) : pas d'extraction nominative hors procédure
export function exportAccessData(ctx: AccessContext, requestId: number, format: ExportFormat, meta: AuditMeta): AccessExportFile {
  const reqTarget = { type: "privacy_request", id: requestId };
  ensureRh(ctx, "privacy.export", reqTarget, meta);
  const { sqlite } = getDb();
  const req = sqlite.prepare("SELECT employee_id AS employeeId, type, status FROM privacy_request WHERE id = ?").get(requestId) as
    | { employeeId: number; type: PrivacyType; status: PrivacyStatus }
    | undefined;
  if (!req) throw notFound("Demande");
  const target = { type: "employee", id: req.employeeId };
  if (req.type !== "ACCES" || req.status === "REFUSEE") {
    audit(ctx.userId, "privacy.export", target, "REFUSE", { requestId, reason: req.type !== "ACCES" ? "type" : "refusee", source: meta.source }, meta.ip);
    throw new HttpError(409, "DEMANDE_INVALIDE", "L'export n'est possible que pour une demande d'accès ouverte ou traitée.");
  }
  const x = buildAccessExport(sqlite, req.employeeId);
  if (!x) throw notFound("Collaborateur");
  const body = format === "json" ? Buffer.from(exportToJson(x), "utf8") : exportToZip(x);
  const safe = x.employee.matricule.replace(/[^A-Za-z0-9_-]/g, "_");
  const day = x.generatedAt.slice(0, 10).replace(/-/g, "");
  audit(
    ctx.userId,
    "privacy.export",
    target,
    "OK",
    { requestId, format, source: meta.source, bytes: body.length, rubriques: Object.fromEntries(x.rubriques.map((r) => [r.key, r.rows.length])) },
    meta.ip,
  );
  return {
    filename: `acces-${safe}-${day}.${format}`,
    contentType: format === "json" ? "application/json; charset=utf-8" : "application/zip",
    body,
    rubriques: x.rubriques.length,
  };
}
