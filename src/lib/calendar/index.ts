import type Database from "better-sqlite3";
import { FIXED_HOLIDAYS, SUMMER_SEANCE_UNIQUE, TN_HIJRI_DATES, TN_TABLE_FIRST_YEAR, TN_TABLE_LAST_YEAR } from "./tn-dates";

const DAY_MS = 86_400_000;

export type DayInfo = {
  date: string;
  isWeekend: boolean;
  isHoliday: boolean;
  holidayName: string | null;
  isRamadan: boolean;
  isBridge: boolean;
  isSeanceUnique: boolean;
};

export function toUtcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  return toIso(new Date(toUtcDate(iso).getTime() + n * DAY_MS));
}

export function monthStart(month: string): string {
  return `${month}-01`;
}

export function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return toIso(new Date(Date.UTC(y, m, 0)));
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return toIso(d).slice(0, 7);
}

export function monthsBetween(fromMonth: string, toMonth: string): string[] {
  const out: string[] = [];
  for (let m = fromMonth; m <= toMonth; m = addMonths(m, 1)) out.push(m);
  return out;
}

// 0 = dimanche ... 6 = samedi ; semaine de travail du lundi au vendredi
export function isWeekend(iso: string): boolean {
  const dow = toUtcDate(iso).getUTCDay();
  return dow === 0 || dow === 6;
}

type YearCalendar = { holidays: Map<string, string>; ramadan: Set<string> };
const yearCache = new Map<number, YearCalendar>();

let hijriFormat: Intl.DateTimeFormat | null = null;

// Repli hors de la table tunisienne : calendrier Umm al-Qura d'ICU
function umalquraEvents(year: number, add: (date: string, name: string) => void, ramadan: Set<string>) {
  hijriFormat ??= new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", { timeZone: "UTC", month: "numeric", day: "numeric" });
  for (let d = `${year}-01-01`; d.startsWith(`${year}-`); d = addDays(d, 1)) {
    let m = 0;
    let day = 0;
    for (const p of hijriFormat.formatToParts(toUtcDate(d))) {
      if (p.type === "month") m = Number(p.value);
      else if (p.type === "day") day = Number(p.value);
    }
    if (m === 9) ramadan.add(d);
    else if (m === 10 && day <= 2) add(d, "Aïd el-Fitr");
    else if (m === 12 && (day === 10 || day === 11)) add(d, "Aïd el-Idha");
    else if (m === 1 && day === 1) add(d, "Ras el Am el Hejri");
    else if (m === 3 && day === 12) add(d, "Mouled");
  }
}

function tableEvents(year: number, add: (date: string, name: string) => void, ramadan: Set<string>) {
  for (const h of Object.values(TN_HIJRI_DATES)) {
    add(h.rasElAm, "Ras el Am el Hejri");
    add(h.mouled, "Mouled");
    add(h.fitr, "Aïd el-Fitr");
    add(addDays(h.fitr, 1), "Aïd el-Fitr");
    add(h.idha, "Aïd el-Idha");
    add(addDays(h.idha, 1), "Aïd el-Idha");
    for (let d = h.ramadan; d < h.fitr; d = addDays(d, 1)) if (d.startsWith(`${year}-`)) ramadan.add(d);
  }
}

function yearCalendar(year: number): YearCalendar {
  const cached = yearCache.get(year);
  if (cached) return cached;
  const holidays = new Map<string, string>();
  const ramadan = new Set<string>();
  const add = (date: string, name: string) => {
    if (!date.startsWith(`${year}-`)) return;
    const prev = holidays.get(date);
    if (!prev) holidays.set(date, name);
    else if (!prev.split(" / ").includes(name)) holidays.set(date, `${prev} / ${name}`);
  };
  for (const h of FIXED_HOLIDAYS) {
    if ((h.from ?? -Infinity) <= year && year <= (h.to ?? Infinity)) add(`${year}-${h.md}`, h.name);
  }
  if (year >= TN_TABLE_FIRST_YEAR && year <= TN_TABLE_LAST_YEAR) tableEvents(year, add, ramadan);
  else umalquraEvents(year, add, ramadan);
  const cal = { holidays, ramadan };
  yearCache.set(year, cal);
  return cal;
}

export function holidaysOfYear(year: number): Map<string, string> {
  return new Map(yearCalendar(year).holidays);
}

export function holidayName(iso: string): string | null {
  return yearCalendar(Number(iso.slice(0, 4))).holidays.get(iso) ?? null;
}

export function isHoliday(iso: string): boolean {
  return holidayName(iso) !== null;
}

export function isRamadan(iso: string): boolean {
  return yearCalendar(Number(iso.slice(0, 4))).ramadan.has(iso);
}

export function isWorkday(iso: string): boolean {
  return !isWeekend(iso) && !isHoliday(iso);
}

// Pont : jour ouvré isolé entre un férié et un week-end (ou deux fériés). Il reste un jour ouvré.
export function isBridge(iso: string): boolean {
  if (!isWorkday(iso)) return false;
  const prev = addDays(iso, -1);
  const next = addDays(iso, 1);
  return !isWorkday(prev) && !isWorkday(next) && (isHoliday(prev) || isHoliday(next));
}

export function isSeanceUnique(iso: string): boolean {
  const md = iso.slice(5);
  return (md >= SUMMER_SEANCE_UNIQUE.from && md <= SUMMER_SEANCE_UNIQUE.to) || isRamadan(iso);
}

export function dayInfo(iso: string): DayInfo {
  const name = holidayName(iso);
  return {
    date: iso,
    isWeekend: isWeekend(iso),
    isHoliday: name !== null,
    holidayName: name,
    isRamadan: isRamadan(iso),
    isBridge: isBridge(iso),
    isSeanceUnique: isSeanceUnique(iso),
  };
}

export function workdaysBetween(from: string, to: string): number {
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) if (isWorkday(d)) n++;
  return n;
}

export function workdaysInMonth(month: string): number {
  return workdaysBetween(monthStart(month), monthEnd(month));
}

export function buildCalendar(sqlite: Database.Database, fromYear: number, toYear: number): number {
  if (!Number.isInteger(fromYear) || !Number.isInteger(toYear) || fromYear > toYear) {
    throw new Error(`Plage d'années invalide : ${fromYear}-${toYear}`);
  }
  const stmt = sqlite.prepare(
    `INSERT INTO dim_date (date, is_weekend, is_holiday, holiday_name, is_ramadan, is_bridge, is_seance_unique)
     VALUES (@date, @isWeekend, @isHoliday, @holidayName, @isRamadan, @isBridge, @isSeanceUnique)
     ON CONFLICT(date) DO UPDATE SET is_weekend = excluded.is_weekend, is_holiday = excluded.is_holiday,
       holiday_name = excluded.holiday_name, is_ramadan = excluded.is_ramadan, is_bridge = excluded.is_bridge,
       is_seance_unique = excluded.is_seance_unique`,
  );
  let n = 0;
  sqlite.transaction(() => {
    for (let d = `${fromYear}-01-01`; d <= `${toYear}-12-31`; d = addDays(d, 1)) {
      const i = dayInfo(d);
      stmt.run({
        date: d,
        isWeekend: i.isWeekend ? 1 : 0,
        isHoliday: i.isHoliday ? 1 : 0,
        holidayName: i.holidayName,
        isRamadan: i.isRamadan ? 1 : 0,
        isBridge: i.isBridge ? 1 : 0,
        isSeanceUnique: i.isSeanceUnique ? 1 : 0,
      });
      n++;
    }
  })();
  return n;
}
