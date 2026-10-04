import type Database from "better-sqlite3";
import { dayOfWeek, toDay } from "./dates";

export const CAL_WORKING = 1;
export const CAL_HOLIDAY = 2;
export const CAL_BRIDGE = 4;
export const CAL_RAMADAN = 8;
export const CAL_SEANCE_UNIQUE = 16;

// Jours ouvrés depuis dim_date ; en l'absence de ligne : lundi-vendredi.
export class WorkCalendar {
  private readonly prefix: Int32Array;

  constructor(
    readonly start: number,
    readonly end: number,
    private readonly flags: Uint8Array,
  ) {
    this.prefix = new Int32Array(flags.length + 1);
    for (let i = 0; i < flags.length; i++) this.prefix[i + 1] = this.prefix[i] + (flags[i] & CAL_WORKING);
  }

  static load(sqlite: Database.Database, fromDate: string, toDate: string): WorkCalendar {
    const start = toDay(fromDate);
    const end = toDay(toDate);
    const flags = new Uint8Array(Math.max(0, end - start + 1));
    for (let d = start; d <= end; d++) flags[d - start] = defaultFlags(d);
    const rows = sqlite
      .prepare(
        "SELECT date, is_weekend AS w, is_holiday AS h, is_bridge AS b, is_ramadan AS r, is_seance_unique AS s FROM dim_date WHERE date BETWEEN ? AND ?",
      )
      .all(fromDate, toDate) as { date: string; w: number; h: number; b: number; r: number; s: number }[];
    for (const r of rows) {
      const i = toDay(r.date) - start;
      if (i < 0 || i >= flags.length) continue;
      flags[i] =
        (!r.w && !r.h && !r.b ? CAL_WORKING : 0) |
        (r.h ? CAL_HOLIDAY : 0) |
        (r.b ? CAL_BRIDGE : 0) |
        (r.r ? CAL_RAMADAN : 0) |
        (r.s ? CAL_SEANCE_UNIQUE : 0);
    }
    return new WorkCalendar(start, end, flags);
  }

  flag(day: number): number {
    return day >= this.start && day <= this.end ? this.flags[day - this.start] : defaultFlags(day);
  }

  isWorking(day: number): boolean {
    return (this.flag(day) & CAL_WORKING) !== 0;
  }

  workingBetween(a: number, b: number): number {
    if (b < a) return 0;
    if (a >= this.start && b <= this.end) return this.prefix[b - this.start + 1] - this.prefix[a - this.start];
    let n = 0;
    for (let d = a; d <= b; d++) if (this.isWorking(d)) n++;
    return n;
  }
}

function defaultFlags(day: number): number {
  const dow = dayOfWeek(day);
  return dow >= 1 && dow <= 5 ? CAL_WORKING : 0;
}
