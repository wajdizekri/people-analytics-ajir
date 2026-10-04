// Sérialisation CSV pour Excel en français : UTF-8 avec BOM, séparateur « ; », fins de ligne CRLF,
// décimales à virgule, dates JJ/MM/AAAA, guillemets RFC 4180, injection de formule neutralisée.

export type CsvValue = string | number | boolean | null | undefined;
export type CsvType = "text" | "number" | "date" | "datetime";
export type CsvColumn = { header: string; type?: CsvType; decimals?: number };
export type CsvTable = { columns: CsvColumn[]; rows: CsvValue[][] };
export type ColumnDef<T> = CsvColumn & { value: (row: T) => CsvValue };

export const CSV_BOM = "﻿";
export const CSV_SEPARATOR = ";";
export const CSV_EOL = "\r\n";
const TZ = "Africa/Tunis";

// Excel exécute une cellule qui commence par = + - @ (ou tabulation, retour chariot) : préfixe « ' » = texte
export function neutralizeFormula(s: string): string {
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

export function quoteField(s: string): string {
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function frNumber(n: number, decimals?: number): string {
  if (!Number.isFinite(n)) return "";
  const s = decimals == null ? String(Math.round(n * 1e6) / 1e6) : n.toFixed(decimals);
  return s.replace(/^-(?=0(\.0+)?$)/, "").replace(".", ",");
}

export function frDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

// Horodatage SQLite (UTC, avec ou sans « Z ») affiché à l'heure de Tunis, comme à l'écran
export function frDateTime(iso: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return frDate(iso);
  const d = new Date(/(Z|[+-]\d{2}:?\d{2})$/i.test(iso) ? iso : `${iso.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = new Intl.DateTimeFormat("fr-FR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}`;
}

export function csvCell(v: CsvValue, col: CsvColumn = { header: "" }): string {
  if (v == null || v === "") return "";
  if (typeof v === "boolean") return v ? "Oui" : "Non";
  if (typeof v === "number") return frNumber(v, col.decimals);
  const s = col.type === "date" ? frDate(v) : col.type === "datetime" ? frDateTime(v) : v;
  return quoteField(neutralizeFormula(s));
}

export function toCsv(table: CsvTable): string {
  const head = table.columns.map((c) => quoteField(neutralizeFormula(c.header))).join(CSV_SEPARATOR);
  const body = table.rows.map((r) => table.columns.map((c, i) => csvCell(r[i], c)).join(CSV_SEPARATOR));
  return CSV_BOM + [head, ...body].join(CSV_EOL) + CSV_EOL;
}

export function buildTable<T>(defs: ColumnDef<T>[], items: T[]): CsvTable {
  return {
    columns: defs.map(({ header, type, decimals }) => ({ header, type, decimals })),
    rows: items.map((item) => defs.map((d) => d.value(item))),
  };
}
