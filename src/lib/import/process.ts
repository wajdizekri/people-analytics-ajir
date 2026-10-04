import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import type { z } from "zod";
import { CsvHeaderError, readCsv, type CsvRow } from "./csv";
import { DATE_FIELDS } from "./schemas";
import { isReject, reject, type IssueLog, type Reject, type Rule } from "./rules";

export type FileReport = {
  present: boolean;
  rows: number;
  ok: number;
  rejected: number;
  durationMs: number;
  rules: Partial<Record<Rule, number>>;
  headerError?: string;
};

export type Employment = { hire: string; exit: string | null };

export type ImportCtx = {
  sqlite: Database.Database;
  dir: string;
  issues: IssueLog;
  files: Record<string, FileReport>;
  empIds: Map<string, number>;
  employment: Map<number, Employment>;
  payrollMonth: string | null;
  batchSize: number;
};

export function describeIssues(error: z.ZodError, data: Record<string, string>): Reject {
  let rule: Rule | null = null;
  const parts: string[] = [];
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "");
    const value = data[field];
    const r: Rule = value === undefined ? "CHAMP_OBLIGATOIRE" : DATE_FIELDS.has(field) ? "DATE_INVALIDE" : "VALEUR_INVALIDE";
    rule ??= r;
    if (r === "CHAMP_OBLIGATOIRE") parts.push(`champ obligatoire manquant : ${field}`);
    else if (r === "DATE_INVALIDE") parts.push(`date invalide pour ${field} : « ${value} » (format attendu ${field === "month" ? "AAAA-MM" : "AAAA-MM-JJ"})`);
    else parts.push(`valeur invalide pour ${field} : « ${value} »`);
  }
  const msg = parts.join(" ; ");
  return reject(rule ?? "VALEUR_INVALIDE", msg.charAt(0).toUpperCase() + msg.slice(1));
}

export function employeeId(ctx: ImportCtx, matricule: string): number | Reject {
  return ctx.empIds.get(matricule) ?? reject("MATRICULE_INCONNU", `Matricule ${matricule} absent des collaborateurs importés (employees.csv)`);
}

export function loadEmployees(ctx: ImportCtx) {
  const rows = ctx.sqlite.prepare("SELECT id, matricule, hire_date, exit_date FROM employee").all() as {
    id: number;
    matricule: string;
    hire_date: string;
    exit_date: string | null;
  }[];
  ctx.empIds = new Map(rows.map((r) => [r.matricule, r.id]));
  ctx.employment = new Map(rows.map((r) => [r.id, { hire: r.hire_date, exit: r.exit_date }]));
}

// Lit un fichier en flux : validation zod, règles métier (prepare), écriture par lots transactionnels.
// Renvoie false si l'en-tête est invalide (fichier ignoré).
export async function processFile<S extends z.ZodType, U>(
  ctx: ImportCtx,
  file: string,
  columns: readonly string[],
  schema: S,
  prepare: (row: z.output<S>, src: CsvRow) => U | Reject,
  write: (rows: U[]) => void,
): Promise<boolean> {
  const full = path.join(ctx.dir, file);
  const stats: FileReport = { present: fs.existsSync(full), rows: 0, ok: 0, rejected: 0, durationMs: 0, rules: {} };
  ctx.files[file] = stats;
  if (!stats.present) return true;
  const t0 = performance.now();
  const buf: U[] = [];
  const flush = () => {
    ctx.sqlite.transaction(() => {
      if (buf.length) write(buf);
      ctx.issues.flush();
    })();
    buf.length = 0;
  };
  const rejectRow = (line: number | null, rule: Rule, message: string, raw: string | null) => {
    stats.rejected++;
    ctx.issues.add(file, line, rule, message, raw);
  };
  try {
    const rows = readCsv(full, columns, (line, message) => {
      stats.rows++;
      rejectRow(line, "FORMAT_LIGNE", `Ligne illisible, guillemet ou séparateur « ; » mal placé (détail : ${message})`, null);
    });
    for await (const src of rows) {
      stats.rows++;
      if (src.badWidth) {
        rejectRow(src.line, "FORMAT_LIGNE", "Nombre de colonnes différent de l'en-tête", src.raw);
        continue;
      }
      const parsed = schema.safeParse(src.data);
      if (!parsed.success) {
        const r = describeIssues(parsed.error, src.data);
        rejectRow(src.line, r.reject, r.message, src.raw);
        continue;
      }
      const out = prepare(parsed.data, src);
      if (isReject(out)) {
        rejectRow(src.line, out.reject, out.message, src.raw);
        continue;
      }
      stats.ok++;
      buf.push(out);
      if (buf.length >= ctx.batchSize) flush();
    }
  } catch (e) {
    if (!(e instanceof CsvHeaderError)) throw e;
    stats.headerError = e.message;
    ctx.issues.add(file, 1, "EN_TETE_INVALIDE", e.message, null);
  }
  flush();
  stats.durationMs = Math.round(performance.now() - t0);
  return !stats.headerError;
}
