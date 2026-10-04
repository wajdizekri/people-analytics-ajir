import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runImport } from "@/lib/import";
import { fixtureCopy, FIXTURE_DIR, tempDb } from "@/lib/import/test-db";
import { claimNextJob, enqueueJob, getJob, recoverStale } from "@/lib/jobs";
import { processNextJob } from "@/lib/jobs/handlers";
import { setSetting, smigResolver, smigSchedule } from "@/lib/settings";

let db: ReturnType<typeof tempDb>;
beforeEach(() => {
  db = tempDb();
});
afterEach(() => db.close());

const count = (sql: string, ...args: unknown[]) => (db.sqlite.prepare(sql).get(...args) as { n: number }).n;
const PAYROLL_HEADER = "matricule;month;base_salary;gross_salary;overtime_hours;recorded_at";
const payroll = (lines: string[]) => [PAYROLL_HEADER, ...lines].join("\n") + "\n";

describe("barème SMIG daté", () => {
  it("valeurs par défaut (à confirmer) : 528,320 jusqu'à décembre 2025, 554,736 à partir de janvier 2026", () => {
    const at = smigResolver(db.sqlite);
    expect([at("2020-03"), at("2025-12"), at("2026-01"), at("2027-06")]).toEqual([528.32, 528.32, 554.736, 554.736]);
  });

  it("barème invalide ou absent : repli sur smig_monthly ; mois antérieur à une première borne datée : repli aussi", () => {
    for (const bad of ["pas du json", "[]", '[{"from":"2026-13","value":500}]', '[{"from":null,"value":-1}]']) {
      setSetting(db.sqlite, "smig_schedule", bad);
      expect(smigSchedule(db.sqlite), bad).toBeNull();
      expect(smigResolver(db.sqlite)("2026-05")).toBe(528.32);
    }
    setSetting(db.sqlite, "smig_schedule", '[{"from":"2024-05-01","value":500},{"from":"2025-01-01","value":520}]');
    const at = smigResolver(db.sqlite);
    expect([at("2024-04"), at("2024-05"), at("2025-01")]).toEqual([528.32, 500, 520]);
  });

  it("contrôle appliqué selon le mois de paie ; brut > 2 × base : avertissement, ligne importée, score inchangé", async () => {
    const dir = fixtureCopy(db.dir, "smig", {
      "payroll.csv": payroll([
        "E002;2025-12;540;600;0;2025-12-31",
        "E002;2026-01;540;600;0;2026-01-31",
        "E003;2026-01;2000;2200;0;2026-01-31",
        "E004;2026-01;220;2400;0;2026-01-31",
        "E005;2026-01;600;1300;0;2026-01-31",
        "E007;2026-01;600;1100;0;2026-01-31",
      ]),
    });
    const res = await runImport(db.sqlite, dir);
    const issues = db.sqlite.prepare("SELECT line, rule, severity, message FROM import_rejection WHERE file = 'payroll.csv' ORDER BY line").all() as {
      line: number;
      rule: string;
      severity: string;
      message: string;
    }[];
    expect(issues.filter((i) => i.rule === "SALAIRE_SOUS_SMIG")).toMatchObject([
      { line: 3, severity: "REJET", message: "Salaire de base 540 TND inférieur au SMIG (554.736 TND) en 2026-01" },
      { line: 5, severity: "REJET" },
    ]);
    expect(issues.filter((i) => i.rule === "PAIE_BRUT_INCOHERENT")).toEqual([
      { line: 6, rule: "PAIE_BRUT_INCOHERENT", severity: "AVERTISSEMENT", message: "Salaire brut supérieur au double du salaire de base en 2026-01 : vérifiez le salaire de base dans AJIR" },
    ]);
    expect(count("SELECT COUNT(*) AS n FROM payroll_monthly p JOIN employee e ON e.id = p.employee_id WHERE e.matricule = 'E002'")).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM payroll_monthly p JOIN employee e ON e.id = p.employee_id WHERE e.matricule = 'E005'")).toBe(1);
    expect(res.report.files["payroll.csv"]).toMatchObject({ rows: 6, ok: 4, rejected: 2 });
    expect(res.report.rules.PAIE_BRUT_INCOHERENT).toBe(1);
  });
});

describe("job IMPORT lancé depuis l'interface", () => {
  it("import OK : calendrier et agrégats reconstruits, job TERMINE", async () => {
    setSetting(db.sqlite, "quality_threshold", "0");
    enqueueJob(db.sqlite, "IMPORT", "inbox/mini", { dir: FIXTURE_DIR, source: "mini" });
    const r = await processNextJob(db.sqlite);
    expect(r).toMatchObject({ ok: true });
    expect(r!.summary).toMatch(/^import lot \d+ : OK, .* ; calendrier \d+ jours, \d+ lignes d'agrégats$/);
    expect(getJob(db.sqlite, r!.job.id)!.status).toBe("TERMINE");
    expect(count("SELECT COUNT(*) AS n FROM dim_date WHERE date BETWEEN '2026-01-01' AND '2027-12-31'")).toBe(730);
    expect(count("SELECT COUNT(*) AS n FROM agg_kpi_monthly WHERE month = '2026-01'")).toBe(3);
    expect(db.sqlite.prepare("SELECT value FROM app_setting WHERE key = 'aggregates_refreshed_at'").get()).toBeTruthy();
  });

  it("import BLOQUE (qualité sous le seuil) : données chargées, agrégats reconstruits, job TERMINE", async () => {
    enqueueJob(db.sqlite, "IMPORT", "inbox/mini", { dir: FIXTURE_DIR, source: "mini" });
    const r = await processNextJob(db.sqlite);
    expect(r!.summary).toMatch(/^import lot \d+ : BLOQUE, .* \d+ lignes d'agrégats$/);
    expect(getJob(db.sqlite, r!.job.id)!.status).toBe("TERMINE");
    expect(count("SELECT COUNT(*) AS n FROM agg_kpi_monthly")).toBeGreaterThan(0);
  });

  it("import en ECHEC : job ECHEC avec le motif et alerte SYSTEME, rien reconstruit", async () => {
    const dir = fixtureCopy(db.dir, "sans-salaries", { "employees.csv": null });
    enqueueJob(db.sqlite, "IMPORT", "inbox/x", { dir, source: "x" });
    const r = await processNextJob(db.sqlite);
    expect(r).toMatchObject({ ok: false });
    const job = getJob(db.sqlite, r!.job.id)!;
    expect(job.status).toBe("ECHEC");
    expect(job.error).toMatch(/Import n° \d+ en échec : Fichier obligatoire absent : employees\.csv/);
    expect(count("SELECT COUNT(*) AS n FROM alert WHERE type = 'SYSTEME' AND dedup_key = ?", `systeme:job:${job.id}`)).toBe(1);
    expect(count("SELECT COUNT(*) AS n FROM agg_kpi_monthly")).toBe(0);
  });

  it("worker tué pendant un import : à la reprise, le lot EN_COURS de ce job passe ECHEC (audité), les autres lots non", () => {
    const id = enqueueJob(db.sqlite, "IMPORT", "inbox/export-aout", { dir: "C:/depot/inbox/export-aout" });
    claimNextJob(db.sqlite);
    const old = new Date(Date.now() - 20 * 60_000).toISOString();
    db.sqlite.prepare("UPDATE app_job SET started_at = ?, heartbeat_at = ? WHERE id = ?").run(old, old, id);
    const insert = db.sqlite.prepare("INSERT INTO import_batch (source, started_at, status) VALUES (?, ?, 'EN_COURS')");
    const mine = Number(insert.run("export-aout", new Date(Date.now() - 19 * 60_000).toISOString()).lastInsertRowid);
    const cli = Number(insert.run("autre-export", new Date(Date.now() - 19 * 60_000).toISOString()).lastInsertRowid);
    const older = Number(insert.run("export-aout", new Date(Date.now() - 60 * 60_000).toISOString()).lastInsertRowid);

    expect(recoverStale(db.sqlite)).toEqual({ requeued: 1, failed: 0, failedRuns: 0 });
    const status = (b: number) => (db.sqlite.prepare("SELECT status, finished_at AS f FROM import_batch WHERE id = ?").get(b) as { status: string; f: string | null });
    expect(status(mine)).toMatchObject({ status: "ECHEC" });
    expect(status(mine).f).toBeTruthy();
    expect(status(cli).status).toBe("EN_COURS");
    expect(status(older).status).toBe("EN_COURS");
    expect(db.sqlite.prepare("SELECT outcome FROM audit_log WHERE action = 'import.run' AND target_id = ?").get(String(mine))).toEqual({ outcome: "ECHEC" });
    expect(getJob(db.sqlite, id)!.status).toBe("EN_FILE");
    expect(fs.existsSync(FIXTURE_DIR)).toBe(true);
  });
});
