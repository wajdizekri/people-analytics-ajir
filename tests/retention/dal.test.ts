import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "@/db/client";
import { HttpError } from "@/lib/dal/errors";
import { getRetention, retentionQuerySchema, type RetentionDto } from "@/lib/dal/retention";
import { DAYS_PER_MONTH } from "@/lib/retention/summary";
import { WINDOW_START, admin, cleanupFixture, createFixture, manager, rh, type Fixture } from "./fixture";

let fx: Fixture;
beforeAll(() => {
  fx = createFixture("dal");
});
afterAll(() => cleanupFixture(fx.file));

const q = (o: Record<string, string> = {}) => retentionQuerySchema.parse(o);
const ms = (curve: RetentionDto["overall"], months: number) => curve!.milestones.find((m) => m.months === months)!;

describe("DAL rétention : rôles et périmètre", () => {
  it("ADMIN refusé (403), refus audité", () => {
    expect(() => getRetention(admin, q())).toThrow(HttpError);
    const row = getDb().sqlite.prepare("SELECT outcome FROM audit_log WHERE action = 'retention.view' AND user_id = ? ORDER BY id DESC LIMIT 1").get(admin.userId) as
      | { outcome: string }
      | undefined;
    expect(row?.outcome).toBe("REFUSE");
  });

  it("RH : toute l'entreprise ; stages et SIVP seuls exclus, embauches antérieures à l'historique non suivies", () => {
    const r = getRetention(rh, q());
    expect(r.view).toBe("RH");
    expect(r.observationStart).toBe(WINDOW_START);
    expect(r.referenceDate).toBe("2026-08-31");
    expect(r.followed).toBe(24);
    expect(r.notFollowed).toBe(4);
    expect(r.overall!.events).toBe(6);
  });

  it("manager : limité à sa hiérarchie (équipe de Q exclue), lui-même exclu", () => {
    const r = getRetention(manager(fx.ids.M), q());
    expect(r.view).toBe("MANAGER");
    expect(r.followed).toBe(15);
    expect(r.notFollowed).toBe(1);
    expect(r.overall!.events).toBe(5);
  });
});

describe("DAL rétention : courbe d'ensemble calculée à la main", () => {
  it("toutes sorties : S(12) = 12/15, S(24) = 4/7, arrêt à 820 jours (4 personnes suivies ensuite)", () => {
    const o = getRetention(manager(fx.ids.M), q()).overall!;
    expect(ms(o, 6)).toMatchObject({ survival: 1, atRisk: 15 });
    expect(ms(o, 12).survival).toBeCloseTo(12 / 15, 12);
    expect(ms(o, 12).atRisk).toBe(12);
    expect(ms(o, 24).survival).toBeCloseTo(4 / 7, 12);
    expect(ms(o, 24).atRisk).toBe(5);
    expect(ms(o, 36)).toMatchObject({ survival: null, atRisk: null });
    expect(o.stopMonths).toBeCloseTo(820 / DAYS_PER_MONTH, 9);
    expect(o.medianMonths).toBeNull();
    expect(o.survival.slice(27).every((v) => v == null)).toBe(true);
    expect(o.survival[26]).toBeCloseTo(4 / 7, 12);
    expect(o.lower[12]! < o.survival[12]! && o.survival[12]! < o.upper[12]!).toBe(true);
  });

  it("départs volontaires : fins de CDD et licenciements censurés (risque spécifique)", () => {
    const o = getRetention(manager(fx.ids.M), q({ mode: "volontaires" })).overall!;
    expect(o.events).toBe(3);
    expect(ms(o, 12).survival).toBeCloseTo(14 / 15, 12);
    expect(ms(o, 24).survival).toBeCloseTo(2 / 3, 12);
  });

  it("sortie saisie après la référence ignorée (censure à la référence), sortie postérieure ignorée", () => {
    const s = getDb().sqlite;
    expect(getRetention(rh, q()).overall!.events).toBe(6);
    s.prepare("UPDATE exit_event SET recorded_at = '2026-08-25' WHERE employee_id = ?").run(fx.ids.A3);
    try {
      expect(getRetention(rh, q()).overall!.events).toBe(7);
    } finally {
      s.prepare("UPDATE exit_event SET recorded_at = '2026-09-03' WHERE employee_id = ?").run(fx.ids.A3);
    }
    s.prepare("UPDATE exit_event SET exit_date = '2026-08-30' WHERE employee_id = ?").run(fx.ids.A4);
    try {
      expect(getRetention(rh, q()).overall!.events).toBe(7);
    } finally {
      s.prepare("UPDATE exit_event SET exit_date = '2026-09-15' WHERE employee_id = ?").run(fx.ids.A4);
    }
  });
});

describe("DAL rétention : segmentation et petits groupes", () => {
  it("manager par département : groupes de moins de 5 masqués (aucun chiffre), groupe visible arrêté sous 5 suivis", () => {
    const r = getRetention(manager(fx.ids.M), q({ segment: "departement" }));
    expect(r.groups.map((g) => [g.label, g.masked])).toEqual([
      ["Production", false],
      ["Commercial", true],
      ["Qualité", true],
    ]);
    expect(r.maskedGroups).toBe(2);
    for (const g of r.groups.filter((x) => x.masked)) expect(g).toMatchObject({ n: null, curve: null, inChart: false });
    const prod = r.groups[0];
    expect(prod).toMatchObject({ n: 9, inChart: true });
    expect(ms(prod.curve, 12).survival).toBeCloseTo(7 / 9, 12);
    expect(ms(prod.curve, 24).survival).toBeCloseTo(5 / 9, 12);
    expect(prod.curve!.stopMonths).toBeCloseTo(820 / DAYS_PER_MONTH, 9);
    expect(r.logRank).toBeNull();
  });

  it("manager par famille de métier : masquage secondaire tant que l'ensemble masqué compte moins de 5 personnes", () => {
    const r = getRetention(manager(fx.ids.M), q({ segment: "famille" }));
    expect(r.groups.map((g) => [g.label, g.masked])).toEqual([
      ["Production", false],
      ["Support", true],
      ["Commercial", true],
    ]);
  });

  it("cohortes d'embauche : courbe de la cohorte 2025 arrêtée à 456 jours, test du log-rank à 1 ddl", () => {
    const r = getRetention(manager(fx.ids.M), q({ segment: "cohorte" }));
    expect(r.groups.map((g) => [g.label, g.n])).toEqual([
      ["2024", 9],
      ["2025", 6],
    ]);
    const c25 = r.groups[1].curve!;
    expect(ms(c25, 12).survival).toBeCloseTo(5 / 6, 12);
    expect(ms(c25, 24).survival).toBeNull();
    expect(c25.stopMonths).toBeCloseTo(456 / DAYS_PER_MONTH, 9);
    expect(r.logRank?.df).toBe(1);
    expect(r.logRank!.pValue).toBeGreaterThan(0);
  });

  it("RH : aucun masquage, groupe de 3 sans courbe ; log-rank sur 3 groupes", () => {
    const r = getRetention(rh, q({ segment: "departement" }));
    expect(r.groups.map((g) => [g.label, g.n, g.masked])).toEqual([
      ["Production", 15, false],
      ["Commercial", 6, false],
      ["Qualité", 3, false],
    ]);
    const qua = r.groups[2].curve!;
    expect(qua.stopMonths).toBe(0);
    expect(qua.survival.every((v) => v == null)).toBe(true);
    expect(r.groups[2].inChart).toBe(false);
    expect(r.logRank?.df).toBe(2);
  });

  it("premier contrat : SIVP puis CDD compté depuis le CDD", () => {
    const r = getRetention(rh, q({ segment: "contrat" }));
    expect(Object.fromEntries(r.groups.map((g) => [g.label, g.n]))).toEqual({ CDI: 22, CDD: 1, "SIVP puis CDI ou CDD": 1 });
  });

  it("manager dont l'équipe compte moins de 5 embauches suivies : ni courbe ni chiffre de sortie", () => {
    const r = getRetention(manager(fx.ids.Z), q({ segment: "cohorte" }));
    expect(r.followed).toBe(3);
    expect(r.overall).toBeNull();
    expect(r.groups.every((g) => g.masked && g.curve == null)).toBe(true);
  });
});
