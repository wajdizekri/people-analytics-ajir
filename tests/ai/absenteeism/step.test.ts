import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runStep } from "@/lib/ai/absenteeism/step";
import { draftRecommendations, ABS_RECO_SETTINGS } from "@/lib/ai/absenteeism/recommendations";
import { openDalDb } from "../../fixtures/unit/dal-world";
import { AS_OF, buildAbsWorld, installModel } from "./world";

let db: ReturnType<typeof openDalDb>;
let w: ReturnType<typeof buildAbsWorld>;
beforeAll(() => {
  db = openDalDb("ai-abs-step");
  w = buildAbsWorld(db.sqlite);
});
afterAll(() => db.close());

type F = { scope: string; department_id: number | null; manager_id: number | null; month: string; horizon: number; value: number; lower: number; upper: number };
const forecasts = () => db.sqlite.prepare("SELECT * FROM forecast WHERE topic = 'ABSENTEISME' ORDER BY scope, department_id, manager_id, horizon").all() as F[];
type R = { scope: string; audience: string; department_id: number | null; manager_id: number | null; employee_id: number | null; action_code: string; rationale: string; priority: number; dedup_key: string };
const recos = () => db.sqlite.prepare("SELECT * FROM insight_recommendation WHERE topic = 'ABSENTEISME' ORDER BY id").all() as R[];

describe("étape ABSENTEISME du batch", () => {
  it("sans modèle champion : aucune écriture", () => {
    expect(runStep(db.sqlite, AS_OF).summary).toMatch(/aucun modèle champion/);
    expect(forecasts()).toHaveLength(0);
  });

  it("prévisions 1 à 3 mois pour l'entreprise, les départements et les équipes d'au moins 5 personnes", () => {
    installModel(db.sqlite);
    expect(runStep(db.sqlite, AS_OF).summary).toMatch(/prévisions/);
    const f = forecasts();
    const units = [...new Set(f.map((r) => `${r.scope}:${r.department_id ?? ""}:${r.manager_id ?? ""}`))].sort();
    expect(units).toEqual([`DEPARTEMENT:${w.com}:`, `DEPARTEMENT:${w.prod}:`, "ENTREPRISE::", `EQUIPE:${w.com}:${w.e.MC}`, `EQUIPE:${w.prod}:${w.e.MA}`].sort());
    expect(f.filter((r) => r.manager_id === w.e.MB || r.manager_id === w.e.DIR)).toEqual([]);
    for (const r of f) {
      expect([1, 2, 3]).toContain(r.horizon);
      expect(r.lower).toBeLessThanOrEqual(r.value);
      expect(r.upper).toBeGreaterThanOrEqual(r.value);
    }
    expect(f.filter((r) => r.scope === "ENTREPRISE").map((r) => r.month)).toEqual(["2025-09", "2025-10", "2025-11"]);
  });

  it("recommandations collectives : équipe très absente, anomalies persistantes ; jamais individuelles", () => {
    const r = recos();
    const teamA = r.filter((x) => x.manager_id === w.e.MA);
    expect(teamA.map((x) => x.action_code)).toContain("ANTICIPER_REMPLACEMENTS");
    expect(teamA[0]).toMatchObject({ scope: "EQUIPE", audience: "MANAGER", department_id: w.prod, employee_id: null, priority: 1 });
    expect(teamA[0].rationale).toMatch(/Équipe de NomMA PrenomMA \(6 collaborateurs en poste\).*prévu à \d+,\d{2}\s%/);
    const teamC = r.filter((x) => x.manager_id === w.e.MC);
    expect(teamC.map((x) => x.action_code)).toEqual(["ECHANGER_ORGANISATION"]);
    expect(teamC[0].rationale).toMatch(/2 épisodes d'absentéisme collectif inhabituel/);
    const prod = r.find((x) => x.scope === "DEPARTEMENT" && x.department_id === w.prod);
    expect(prod).toMatchObject({ audience: "MANAGER", manager_id: w.e.DIR });
    for (const x of r) {
      expect(x.scope).not.toBe("SALARIE");
      expect(x.employee_id).toBeNull();
      expect(x.rationale).not.toMatch(/NomA\d|NomB\d|NomC\d|maladie|maternit/i);
      expect(x.dedup_key).toMatch(new RegExp(`^abs:(E|D\\d+|T\\d+):2025-08:${x.action_code}$`));
    }
    expect(r.filter((x) => x.manager_id === w.e.MB)).toEqual([]);
  });

  it("idempotente : relancer le même mois ne duplique ni prévision ni recommandation", () => {
    const before = { f: forecasts(), r: recos() };
    expect(runStep(db.sqlite, AS_OF).summary).toMatch(/0 recommandation/);
    expect(forecasts().map(({ value, lower, upper, month }) => ({ value, lower, upper, month }))).toEqual(before.f.map(({ value, lower, upper, month }) => ({ value, lower, upper, month })));
    expect(recos()).toEqual(before.r);
  });

  it("une recommandation encore ouverte n'est pas reproposée le mois suivant", () => {
    const n = recos().length;
    runStep(db.sqlite, "2025-07-31");
    const newer = recos().slice(n);
    expect(newer.filter((x) => x.manager_id === w.e.MA && x.action_code === "ANTICIPER_REMPLACEMENTS")).toEqual([]);
  });

  it("les absences pour raison de santé ne changent pas les prévisions", () => {
    const before = forecasts().filter((r) => r.manager_id === w.e.MA);
    const ins = db.sqlite.prepare("INSERT INTO absence_episode (employee_id, start_date, end_date, days, category, is_health, recorded_at) VALUES (?, ?, ?, ?, ?, 1, ?)");
    for (let i = 1; i <= 6; i++) ins.run(w.e[`A${i}`], "2025-08-04", "2025-08-15", 10, i % 2 ? "MALADIE" : "MATERNITE", "2025-08-20");
    runStep(db.sqlite, AS_OF);
    expect(forecasts().filter((r) => r.manager_id === w.e.MA && r.month > "2025-08")).toEqual(
      expect.arrayContaining(before.filter((r) => r.month > "2025-08").map((r) => expect.objectContaining({ value: r.value, lower: r.lower, upper: r.upper }))),
    );
  });

  it("seuils paramétrables : relever le seuil de niveau supprime la recommandation de remplacement", () => {
    const base = {
      unit: "T1",
      scope: "EQUIPE" as const,
      label: "Équipe de X",
      active: 6,
      ma12: 0.012,
      ma3: 0.012,
      companyMa12: 0.008,
      forecasts: [{ month: "2025-09", value: 0.013, lower: 0.005, upper: 0.02, cal: { wd: 21, ram: 0, bridge: 0, hol: 0, su: 0 } }],
      anomalies: { count: 0, lastStart: null },
    };
    expect(draftRecommendations(base, { ...ABS_RECO_SETTINGS }).map((d) => d.action)).toEqual(["ANTICIPER_REMPLACEMENTS"]);
    expect(draftRecommendations(base, { ...ABS_RECO_SETTINGS, abs_reco_seuil_niveau: 1 })).toEqual([]);
    // retour à la moyenne d'une équipe habituellement peu absente : pas de « hausse »
    const low = { ...base, ma12: 0.002, ma3: 0.002, forecasts: [{ ...base.forecasts[0], value: 0.006 }] };
    expect(draftRecommendations(low, { ...ABS_RECO_SETTINGS })).toEqual([]);
  });
});
