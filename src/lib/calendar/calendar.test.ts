import { afterAll, describe, expect, it } from "vitest";
import {
  buildCalendar,
  dayInfo,
  holidayName,
  holidaysOfYear,
  isBridge,
  isHoliday,
  isRamadan,
  isSeanceUnique,
  isWorkday,
  workdaysBetween,
  workdaysInMonth,
} from "./index";
import { tempDb } from "@/lib/import/test-db";

describe("fériés tunisiens", () => {
  it("fériés fixes 2025", () => {
    const h = holidaysOfYear(2025);
    for (const d of ["2025-01-01", "2025-03-20", "2025-04-09", "2025-05-01", "2025-07-25", "2025-08-13", "2025-10-15", "2025-12-17"])
      expect(h.has(d), d).toBe(true);
    expect(isHoliday("2025-01-14")).toBe(false);
  });

  it("fête de la Révolution : 14 janvier jusqu'en 2021, 17 décembre à partir de 2021", () => {
    expect(isHoliday("2020-01-14")).toBe(true);
    expect(isHoliday("2021-01-14")).toBe(true);
    expect(isHoliday("2021-12-17")).toBe(true);
    expect(isHoliday("2020-12-17")).toBe(false);
    expect(isHoliday("2022-01-14")).toBe(false);
    expect(isHoliday("2026-12-17")).toBe(true);
  });

  it("fêtes religieuses 2025 (Aïd sur 2 jours)", () => {
    expect(holidayName("2025-03-30")).toBe("Aïd el-Fitr");
    expect(holidayName("2025-03-31")).toBe("Aïd el-Fitr");
    expect(holidayName("2025-06-06")).toBe("Aïd el-Idha");
    expect(holidayName("2025-06-07")).toBe("Aïd el-Idha");
    expect(holidayName("2025-06-26")).toBe("Ras el Am el Hejri");
    expect(holidayName("2025-09-04")).toBe("Mouled");
  });

  it("fêtes religieuses 2026 et cumul avec un férié fixe", () => {
    expect(holidayName("2026-03-20")).toBe("Fête de l'Indépendance / Aïd el-Fitr");
    expect(holidayName("2026-03-21")).toBe("Aïd el-Fitr");
    expect(holidayName("2026-05-27")).toBe("Aïd el-Idha");
    expect(holidayName("2026-05-28")).toBe("Aïd el-Idha");
    expect(holidayName("2026-06-16")).toBe("Ras el Am el Hejri");
    expect(holidayName("2026-08-25")).toBe("Mouled");
    expect(holidaysOfYear(2026).size).toBe(13);
  });

  it("repli Umm al-Qura hors de la table", () => {
    expect(isRamadan("2018-06-01")).toBe(true);
    expect([...holidaysOfYear(2018).values()].filter((n) => n === "Aïd el-Fitr")).toHaveLength(2);
    expect(holidayName("2031-01-24")).toBe("Aïd el-Fitr");
  });
});

describe("Ramadan, ponts, séance unique", () => {
  it("Ramadan 2026 du 18 février au 19 mars", () => {
    expect(isRamadan("2026-02-17")).toBe(false);
    expect(isRamadan("2026-02-18")).toBe(true);
    expect(isRamadan("2026-03-19")).toBe(true);
    expect(isRamadan("2026-03-20")).toBe(false);
  });

  it("ponts : jour ouvré isolé entre férié et week-end", () => {
    expect(isBridge("2026-01-02")).toBe(true); // vendredi après le 1er janvier (jeudi)
    expect(isBridge("2025-05-02")).toBe(true);
    expect(isBridge("2026-05-29")).toBe(true); // vendredi après l'Aïd el-Idha
    expect(isBridge("2026-06-15")).toBe(true); // lundi avant Ras el Am (mardi)
    expect(isBridge("2025-04-01")).toBe(false);
    expect(isBridge("2026-01-01")).toBe(false);
    expect(isWorkday("2026-01-02")).toBe(true);
  });

  it("séance unique : été et Ramadan", () => {
    expect(isSeanceUnique("2025-06-30")).toBe(false);
    expect(isSeanceUnique("2025-07-01")).toBe(true);
    expect(isSeanceUnique("2025-08-31")).toBe(true);
    expect(isSeanceUnique("2025-09-01")).toBe(false);
    expect(isSeanceUnique("2026-03-02")).toBe(true);
  });

  it("jours ouvrés (lundi-vendredi hors fériés)", () => {
    expect(workdaysInMonth("2026-01")).toBe(21);
    expect(workdaysInMonth("2026-02")).toBe(20);
    expect(workdaysInMonth("2025-03")).toBe(19);
    expect(workdaysBetween("2026-01-29", "2026-02-03")).toBe(4);
    expect(dayInfo("2026-01-03")).toMatchObject({ isWeekend: true, isHoliday: false });
  });
});

describe("buildCalendar", () => {
  const db = tempDb();
  afterAll(() => db.close());

  it("remplit dim_date et reste idempotent", () => {
    expect(buildCalendar(db.sqlite, 2025, 2026)).toBe(730);
    expect(buildCalendar(db.sqlite, 2025, 2026)).toBe(730);
    const n = db.sqlite.prepare("SELECT COUNT(*) AS n FROM dim_date").get() as { n: number };
    expect(n.n).toBe(730);
    const row = db.sqlite.prepare("SELECT * FROM dim_date WHERE date = '2026-01-02'").get();
    expect(row).toMatchObject({ is_weekend: 0, is_holiday: 0, is_bridge: 1, is_ramadan: 0, is_seance_unique: 0 });
    const wd = db.sqlite
      .prepare("SELECT COUNT(*) AS n FROM dim_date WHERE date LIKE '2026-01-%' AND is_weekend = 0 AND is_holiday = 0")
      .get() as { n: number };
    expect(wd.n).toBe(21);
    expect(() => buildCalendar(db.sqlite, 2027, 2026)).toThrow();
  });
});
