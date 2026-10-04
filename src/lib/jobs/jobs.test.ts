import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, Fixture, type TestDb } from "../../../tests/fixtures/engine/db";
import { buildTeamScenario } from "../../../tests/fixtures/engine/scenario";
import { getSetting } from "../settings";
import { claimNextJob, enqueueJob, failJob, getJob, heartbeat, recoverStale } from "./index";
import { lastCompleteMonth, loadAggregates, processNextJob, runMonthlyBatch, scheduledBatchMonth, weeksOfMonth } from "./handlers";
import { setSetting } from "../settings";

let db: TestDb;
beforeAll(() => {
  db = createTestDb();
  buildTeamScenario(new Fixture(db.sqlite));
});
afterAll(() => db.close());

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

describe("file de jobs", () => {
  it("un seul job actif par type et cible", () => {
    const a = enqueueJob(db.sqlite, "FEATURES", "2025-06");
    expect(enqueueJob(db.sqlite, "FEATURES", "2025-06")).toBe(a);
    const b = enqueueJob(db.sqlite, "FEATURES", "2025-05");
    expect(b).not.toBe(a);
    const c = enqueueJob(db.sqlite, "ANOMALIES", null, { fromWeek: "2025-06-02", toWeek: "2025-06-23" });
    expect(enqueueJob(db.sqlite, "ANOMALIES")).toBe(c);
    expect(() => enqueueJob(db.sqlite, "INCONNU" as never)).toThrow();
  });

  it("claim FIFO, heartbeat, reprise d'un job périmé puis échec au second arrêt", () => {
    const first = claimNextJob(db.sqlite)!;
    expect(first).toMatchObject({ type: "FEATURES", target: "2025-06", status: "EN_COURS" });
    heartbeat(db.sqlite, first.id);
    expect(getSetting(db.sqlite, "worker_heartbeat")).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    db.sqlite.prepare("UPDATE app_job SET heartbeat_at = ? WHERE id = ?").run(ago(20), first.id);
    const staging = Number(db.sqlite.prepare("INSERT INTO scoring_run (as_of, model_version_id, status, started_at) VALUES ('2025-01-31', 99, 'STAGING', ?)").run(ago(30)).lastInsertRowid);
    const fresh = Number(db.sqlite.prepare("INSERT INTO scoring_run (as_of, model_version_id, status) VALUES ('2025-02-28', 99, 'STAGING')").run().lastInsertRowid);
    expect(recoverStale(db.sqlite)).toEqual({ requeued: 1, failed: 0, failedRuns: 1 });
    expect(getJob(db.sqlite, first.id)).toMatchObject({ status: "EN_FILE" });
    expect(db.sqlite.prepare("SELECT id, status FROM scoring_run WHERE id IN (?, ?) ORDER BY id").all(staging, fresh)).toEqual([
      { id: staging, status: "ECHEC" },
      { id: fresh, status: "STAGING" },
    ]);
    db.sqlite.prepare("DELETE FROM scoring_run WHERE model_version_id = 99").run();

    expect(claimNextJob(db.sqlite)!.id).toBe(first.id);
    db.sqlite.prepare("UPDATE app_job SET heartbeat_at = ? WHERE id = ?").run(ago(20), first.id);
    expect(recoverStale(db.sqlite)).toMatchObject({ requeued: 0, failed: 1 });
    expect(getJob(db.sqlite, first.id)).toMatchObject({ status: "ECHEC" });
    const alerts = db.sqlite.prepare("SELECT dedup_key AS k, audience FROM alert WHERE type = 'SYSTEME' ORDER BY id").all();
    expect(alerts).toEqual([
      { k: `systeme:job-repris:${first.id}`, audience: "ADMIN" },
      { k: `systeme:job:${first.id}`, audience: "ADMIN" },
    ]);
  });

  it("échec explicite : ECHEC et alerte SYSTEME ADMIN", () => {
    db.sqlite.prepare("DELETE FROM app_job WHERE status = 'EN_FILE'").run();
    const id = enqueueJob(db.sqlite, "IMPORT", "x");
    claimNextJob(db.sqlite);
    failJob(db.sqlite, id, new Error("disque plein"));
    expect(getJob(db.sqlite, id)).toMatchObject({ status: "ECHEC", error: "disque plein" });
    const a = db.sqlite.prepare("SELECT audience, message FROM alert WHERE dedup_key = ?").get(`systeme:job:${id}`) as { audience: string; message: string };
    expect(a.audience).toBe("ADMIN");
    expect(a.message).toMatch(/« Import » \(x\).*disque plein/);
  });
});

describe("exécution des jobs", () => {
  it("helpers de période", () => {
    expect(lastCompleteMonth(db.sqlite)).toBe("2025-06");
    expect(weeksOfMonth("2025-06")).toEqual({ fromWeek: "2025-05-19", toWeek: "2025-06-30" });
  });

  it("FEATURES puis SCORING puis ANOMALIES", async () => {
    db.sqlite.prepare("DELETE FROM app_job").run();
    enqueueJob(db.sqlite, "FEATURES", "2025-06");
    enqueueJob(db.sqlite, "SCORING", "2025-06");
    enqueueJob(db.sqlite, "ANOMALIES", "2025-06");
    const beats: (number | null)[] = [];
    const results = [];
    for (let r = await processNextJob(db.sqlite, (id) => (beats.push(id), () => {})); r; r = await processNextJob(db.sqlite)) results.push(r);
    expect(results.map((r) => [r.job.type, r.ok])).toEqual([
      ["FEATURES", true],
      ["SCORING", true],
      ["ANOMALIES", true],
    ]);
    expect(results[0].summary).toMatch(/5 snapshots/);
    expect(getSetting(db.sqlite, "current_run_id")).not.toBe("");
    expect(beats.length).toBe(1);
  });

  it("IMPORT sans dossier : ECHEC", async () => {
    enqueueJob(db.sqlite, "IMPORT", null, {});
    const r = await processNextJob(db.sqlite);
    expect(r).toMatchObject({ ok: false });
    expect(r!.summary).toMatch(/dossier/);
  });

  it("import dynamique protégé des modules des autres contributeurs", async () => {
    const agg = await loadAggregates();
    expect(agg === null || typeof agg.refreshAggregates === "function").toBe(true);
  });

  it("BATCH_MENSUEL : agrégats, variables, scoring publié, anomalies", async () => {
    enqueueJob(db.sqlite, "BATCH_MENSUEL", "2025-06");
    const r = await processNextJob(db.sqlite);
    expect(r).toMatchObject({ ok: true });
    expect(r!.summary).toMatch(/batch 2025-06 : 5 snapshots, run \d+ \(5 scorés\)/);
  });

  it("batch et scoring refusés pour un mois non couvert par les données ; cron sans objet si le mois est déjà publié", async () => {
    const current = getSetting(db.sqlite, "current_run_id");
    await expect(runMonthlyBatch(db.sqlite, "2025-07")).rejects.toThrow(/non couvert/);
    enqueueJob(db.sqlite, "SCORING", "2025-07");
    const r = await processNextJob(db.sqlite);
    expect(r).toMatchObject({ ok: false });
    expect(r!.summary).toMatch(/non couvert/);
    expect(getSetting(db.sqlite, "current_run_id")).toBe(current);

    expect(scheduledBatchMonth(db.sqlite)).toBeNull();
    setSetting(db.sqlite, "current_run_id", "");
    expect(scheduledBatchMonth(db.sqlite)).toBe("2025-06");
    setSetting(db.sqlite, "current_run_id", current);
  });

  it("SCORING d'un mois antérieur au calcul courant : calculé sans publication ni effets", async () => {
    const current = getSetting(db.sqlite, "current_run_id");
    const recos = db.sqlite.prepare("SELECT COUNT(*) AS n FROM recommendation").get();
    enqueueJob(db.sqlite, "SCORING", "2025-04");
    const r = await processNextJob(db.sqlite);
    expect(r).toMatchObject({ ok: true });
    expect(r!.summary).toMatch(/non publié/);
    expect(getSetting(db.sqlite, "current_run_id")).toBe(current);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM recommendation").get()).toEqual(recos);
  });
});
