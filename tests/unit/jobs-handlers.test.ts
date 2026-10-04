import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, Fixture, type TestDb } from "../fixtures/engine/db";
import { buildTeamScenario } from "../fixtures/engine/scenario";
import { claimNextJob, completeJob, enqueueJob, failJob, getJob, heartbeat, recoverStale } from "@/lib/jobs";
import {
  assertMonthCovered,
  ensureCalendar,
  lastCompleteMonth,
  processNextJob,
  refreshAggregatesSafe,
  runJob,
  runMonthlyBatch,
  scheduledBatchMonth,
  weeksOfMonth,
} from "@/lib/jobs/handlers";
import { getSetting, setSetting } from "@/lib/settings";

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const job = (type: string, target: string | null = null, payload: Record<string, unknown> = {}, createdBy: number | null = null) =>
  ({ id: 0, type, target, status: "EN_COURS", payload, createdBy, error: null }) as Parameters<typeof runJob>[1];

describe("file de jobs : cas limites", () => {
  let db: TestDb;
  beforeAll(() => (db = createTestDb()));
  afterAll(() => db.close());

  it("file vide : rien à prendre ; cible NULL et cible renseignée sont deux jobs distincts ; payload et auteur conservés", () => {
    expect(claimNextJob(db.sqlite)).toBeNull();
    const a = enqueueJob(db.sqlite, "AGGREGATE");
    const b = enqueueJob(db.sqlite, "AGGREGATE", "2025-06", { months: ["2025-06"] }, 4);
    expect(b).not.toBe(a);
    expect(enqueueJob(db.sqlite, "AGGREGATE", null)).toBe(a);
    expect(getJob(db.sqlite, b)).toMatchObject({ target: "2025-06", payload: { months: ["2025-06"] }, createdBy: 4, status: "EN_FILE" });
    expect(getJob(db.sqlite, a)!.payload).toEqual({});
    expect(getJob(db.sqlite, 999_999)).toBeNull();
  });

  it("un job terminé ou en échec libère la place ; heartbeat sans job : seul le signal du worker est mis à jour", () => {
    const first = claimNextJob(db.sqlite)!;
    completeJob(db.sqlite, first.id);
    expect(getJob(db.sqlite, first.id)).toMatchObject({ status: "TERMINE", error: null });
    expect(enqueueJob(db.sqlite, "AGGREGATE")).not.toBe(first.id);
    heartbeat(db.sqlite);
    expect(Date.parse(getSetting(db.sqlite, "worker_heartbeat"))).toBeGreaterThan(Date.now() - 5000);
    const second = claimNextJob(db.sqlite)!;
    failJob(db.sqlite, second.id, "chaîne brute");
    expect(getJob(db.sqlite, second.id)).toMatchObject({ status: "ECHEC", error: "chaîne brute" });
    failJob(db.sqlite, second.id, new Error("x".repeat(3000)));
    expect(getJob(db.sqlite, second.id)!.error).toHaveLength(2000);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM alert WHERE dedup_key = ?").get(`systeme:job:${second.id}`)).toEqual({ n: 1 });
  });

  it("reprise : sans heartbeat, l'heure de démarrage fait foi ; délai de péremption paramétrable ; job en file ignoré", () => {
    db.sqlite.prepare("DELETE FROM app_job").run();
    const id = enqueueJob(db.sqlite, "FEATURES", "2025-06");
    claimNextJob(db.sqlite);
    db.sqlite.prepare("UPDATE app_job SET heartbeat_at = NULL, started_at = ? WHERE id = ?").run(ago(3), id);
    enqueueJob(db.sqlite, "SCORING", "2025-06");
    expect(recoverStale(db.sqlite)).toEqual({ requeued: 0, failed: 0, failedRuns: 0 });
    expect(recoverStale(db.sqlite, 60_000)).toEqual({ requeued: 1, failed: 0, failedRuns: 0 });
    expect(getJob(db.sqlite, id)).toMatchObject({ status: "EN_FILE", error: expect.stringMatching(/^Repris après arrêt du worker/) });
    const alert = db.sqlite.prepare("SELECT severity, message FROM alert WHERE dedup_key = ?").get(`systeme:job-repris:${id}`) as { severity: string; message: string };
    expect(alert.severity).toBe("ATTENTION");
    expect(alert.message).toContain("« Variables » (2025-06)");
  });
});

describe("exécution des jobs : paramètres et erreurs", () => {
  let db: TestDb;
  beforeAll(() => {
    db = createTestDb();
    buildTeamScenario(new Fixture(db.sqlite));
  });
  afterAll(() => db.close());

  it("périodes : mois complet précédent si la fin des données est en milieu de mois ; semaines couvrant le mois", () => {
    setSetting(db.sqlite, "data_end_date", "2025-06-15");
    expect(lastCompleteMonth(db.sqlite)).toBe("2025-05");
    expect(scheduledBatchMonth(db.sqlite)).toBe("2025-05");
    expect(() => assertMonthCovered(db.sqlite, "2025-06")).toThrow(/Mois 2025-06 non couvert.*jusqu'au 15\/06\/2025/);
    expect(() => assertMonthCovered(db.sqlite, "2025-05")).not.toThrow();
    setSetting(db.sqlite, "data_end_date", "");
    expect(lastCompleteMonth(db.sqlite)).toBe("2025-06");
    expect(weeksOfMonth("2025-03")).toEqual({ fromWeek: "2025-02-17", toWeek: "2025-03-31" });
  });

  it("AGGREGATE : mois de la cible ou du payload ; FEATURES : intervalle du payload", async () => {
    expect(await runJob(db.sqlite, job("AGGREGATE", "2025-06"))).toMatch(/^\d+ lignes d'agrégats$/);
    expect(await runJob(db.sqlite, job("AGGREGATE", "pas-un-mois", { months: ["2025-04", "2025-05"] }))).toMatch(/lignes d'agrégats/);
    expect(await refreshAggregatesSafe(db.sqlite, ["2025-06"])).toBeGreaterThan(0);
    const beats: number[] = [];
    const r = await runJob(db.sqlite, job("FEATURES", null, { from: "2025-04", to: "2025-06" }), () => beats.push(1));
    expect(r).toMatch(/snapshots de 2025-04 à 2025-06$/);
    expect(beats).toHaveLength(3);
  });

  it("SCORING : mois invalide ou non couvert refusé ; asOf du payload ; forçage", async () => {
    await expect(runJob(db.sqlite, job("SCORING", "juin"))).rejects.toThrow(/Mois invalide : juin/);
    await expect(runJob(db.sqlite, job("SCORING", null, { asOf: "2025-09-30" }))).rejects.toThrow(/non couvert/);
    const r = await runJob(db.sqlite, job("SCORING", null, { asOf: "2025-06-30", force: true }, 5));
    expect(r).toMatch(/^run \d+ \(b0-v1\) : 5 salariés, \d+ recommandations, \d+ alertes$/);
    expect(db.sqlite.prepare("SELECT user_id AS u FROM audit_log WHERE action = 'scoring.publish' ORDER BY id DESC LIMIT 1").get()).toEqual({ u: 5 });
  });

  it("ANOMALIES : semaines du payload prioritaires, sinon celles du mois", async () => {
    expect(await runJob(db.sqlite, job("ANOMALIES", null, { fromWeek: "2025-06-02", toWeek: "2025-06-09" }))).toMatch(/anomalies de 2025-06-02 à 2025-06-09$/);
    expect(await runJob(db.sqlite, job("ANOMALIES", "2025-05"))).toMatch(/de 2025-04-21 à 2025-05-26$/);
  });

  it("batch mensuel : mois mal formé refusé ; battements à chaque étape", async () => {
    await expect(runMonthlyBatch(db.sqlite, "2025-13")).rejects.toThrow(/Mois invalide/);
    let beats = 0;
    const s = await runMonthlyBatch(db.sqlite, "2025-06", { beat: () => beats++, userId: 3 });
    expect(beats).toBeGreaterThanOrEqual(4);
    expect(s).toMatchObject({ month: "2025-06", snapshots: 5, nScored: 5 });
    expect(s.aggregates).toBeGreaterThan(0);
  });

  it("calendrier : construit une fois, puis considéré complet", async () => {
    expect(await ensureCalendar(db.sqlite, 2024, 2024)).toBe(366);
    expect(await ensureCalendar(db.sqlite, 2024, 2024)).toBe(0);
  });
});

describe("sans aucune donnée importée", () => {
  it("chaque type de job échoue avec un message explicite ; le cron n'a rien à faire", async () => {
    const db = createTestDb();
    try {
      expect(lastCompleteMonth(db.sqlite)).toBeNull();
      expect(scheduledBatchMonth(db.sqlite)).toBeNull();
      expect(() => assertMonthCovered(db.sqlite, "2025-06")).toThrow(/importées jusqu'au —/);
      await expect(runJob(db.sqlite, job("FEATURES"))).rejects.toThrow(/mois à calculer inconnu/);
      await expect(runJob(db.sqlite, job("SCORING"))).rejects.toThrow(/mois du calcul des risques inconnu/);
      await expect(runJob(db.sqlite, job("ANOMALIES"))).rejects.toThrow(/semaines à analyser inconnues/);
      await expect(runJob(db.sqlite, job("BATCH_MENSUEL"))).rejects.toThrow(/mois du calcul mensuel inconnu/);
      enqueueJob(db.sqlite, "IMPORT", "inbox/absent", { dir: "C:/nexiste/pas", source: "test" });
      const r = await processNextJob(db.sqlite);
      // un import en ECHEC marque le job ECHEC (arbitrage de docs/qa/COUVERTURE.md §6)
      expect(r!.ok).toBe(false);
      expect(r!.summary).toMatch(/^Import n° \d+ en échec : Fichier obligatoire absent/);
      expect(db.sqlite.prepare("SELECT status, source FROM import_batch").all()).toEqual([{ status: "ECHEC", source: "test" }]);
      expect(getJob(db.sqlite, r!.job.id)!.status).toBe("ECHEC");
    } finally {
      db.close();
    }
  });
});
