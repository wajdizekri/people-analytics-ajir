import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { getDb } from "@/db/client";
import {
  getDataHealth,
  getImportDetail,
  getSystemHealth,
  inboxRoot,
  listImports,
  raiseWorkerStaleAlert,
  requestRecompute,
  requestScoring,
  saveUploadedExport,
  UPLOAD_MAX_TOTAL_BYTES,
  workerStatus,
  type UploadFile,
} from "@/lib/dal/imports";
import { setSetting } from "@/lib/settings";
import { auditOf, buildWorld, expectHttp, expectHttpAsync, openDalDb, publishRun, REF } from "../fixtures/unit/dal-world";

let db: ReturnType<typeof openDalDb>;
let w: ReturnType<typeof buildWorld>;
beforeAll(() => {
  db = openDalDb("dal-imports");
  w = buildWorld(db.sqlite);
});
afterAll(() => db.close());

const sqlite = () => getDb().sqlite;
const batch = (status: string, opts: { report?: string | null; user?: number | null; started?: string } = {}) =>
  Number(
    sqlite()
      .prepare("INSERT INTO import_batch (source, status, report_json, user_id, started_at) VALUES ('test', ?, ?, ?, COALESCE(?, strftime('%Y-%m-%dT%H:%M:%fZ','now')))")
      .run(status, opts.report ?? null, opts.user ?? null, opts.started ?? null).lastInsertRowid,
  );
const rejection = (batchId: number, file: string, rule: string, severity: string, line: number | null = 1) =>
  sqlite().prepare("INSERT INTO import_rejection (batch_id, file, line, rule, message, severity) VALUES (?, ?, ?, ?, 'msg', ?)").run(batchId, file, line, rule, severity);
const ago = (s: number) => new Date(Date.now() - s * 1000).toISOString();
const file = (name: string, content: string | Buffer, size?: number): UploadFile => {
  const buf = typeof content === "string" ? Buffer.from(content) : content;
  return { name, size: size ?? buf.length, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) as ArrayBuffer };
};

describe("historique et détail des imports", () => {
  it("liste : ADMIN et RH, plus récent d'abord, limite bornée ; MANAGER 403 audité", () => {
    const a = batch("OK", { started: "2025-06-01T08:00:00Z", user: w.users.admin });
    const b = batch("BLOQUE", { started: "2025-07-01T08:00:00Z" });
    expect(listImports(w.ctx.rh).map((i) => i.id)).toEqual([b, a]);
    expect(listImports(w.ctx.admin, { limit: 1 })).toEqual([expect.objectContaining({ id: b, status: "BLOQUE", userLogin: null })]);
    expect(listImports(w.ctx.admin).find((i) => i.id === a)!.userLogin).toBe("admin");
    expect(() => listImports(w.ctx.rh, { limit: 0 })).toThrow(ZodError);
    expectHttp(() => listImports(w.ctx.mgr), 403);
    expect(auditOf(db.sqlite, "import.list").at(-1)).toMatchObject({ outcome: "REFUSE", userId: w.users.mgr });
    sqlite().prepare("DELETE FROM import_batch").run();
  });

  it("détail : comptages complets du rapport, sévérité déduite des règles, fichiers présents d'abord, synthèse", () => {
    const report = {
      source: "ajir",
      files: {
        "payroll.csv": { present: true, rows: 10, ok: 8, rejected: 2, rules: { SALAIRE_SOUS_SMIG: 2, PAIE_INCOMPLETE: 1 } },
        "absences.csv": { present: true, rows: 1500, ok: 0, rejected: 1500, rules: { MATRICULE_INCONNU: 1500, REGLE_FUTURE: 3, BIDON: "x" } },
        "users.csv": { present: false, rows: 0, ok: 0, rejected: 0, rules: {} },
        "trainings.csv": { present: true, headerError: "Colonnes manquantes" },
        "bizarre.csv": "pas un objet",
      },
      quality: { rowScore: 0.61, payrollMonth: "2025-06", activeCount: 11, activeWithoutPayroll: 1 },
      users: { created: ["a", "b"], reactivated: [], deactivated: ["c"], updated: 4 },
      dataEndDate: REF,
      durationMs: 1234,
      error: "x".repeat(600),
    };
    const id = batch("BLOQUE", { report: JSON.stringify(report) });
    rejection(id, "absences.csv", "MATRICULE_INCONNU", "REJET", 7);
    rejection(id, "payroll.csv", "PAIE_INCOMPLETE", "AVERTISSEMENT", null);
    rejection(id, "payroll.csv", "SALAIRE_SOUS_SMIG", "REJET", 3);
    const d = getImportDetail(w.ctx.rh, id);
    expect(d.countsSource).toBe("rapport");
    expect(d.bySeverity).toEqual([
      { severity: "REJET", n: 1505 },
      { severity: "AVERTISSEMENT", n: 1 },
    ]);
    expect(d.byRule[0]).toEqual({ rule: "MATRICULE_INCONNU", severity: "REJET", n: 1500 });
    expect(d.byRule.find((r) => r.rule === "REGLE_FUTURE")).toEqual({ rule: "REGLE_FUTURE", severity: "REJET", n: 3 });
    expect(d.byFile.map((f) => [f.file, f.n])).toEqual([
      ["absences.csv", 1503],
      ["payroll.csv", 3],
    ]);
    expect(d.byFile[1].rules.map((r) => r.rule)).toEqual(["SALAIRE_SOUS_SMIG", "PAIE_INCOMPLETE"]);
    expect(d.samples.map((s) => [s.rule, s.line])).toEqual([
      ["MATRICULE_INCONNU", 7],
      ["SALAIRE_SOUS_SMIG", 3],
      ["PAIE_INCOMPLETE", null],
    ]);
    const s = d.summary!;
    expect(s.files.map((f) => [f.file, f.present])).toEqual([
      ["absences.csv", true],
      ["payroll.csv", true],
      ["trainings.csv", true],
      ["users.csv", false],
    ]);
    expect(s.files.find((f) => f.file === "trainings.csv")).toEqual({ file: "trainings.csv", present: true, rows: 0, ok: 0, rejected: 0, headerError: "Colonnes manquantes" });
    expect(s).toMatchObject({ rowScore: 0.61, payrollMonth: "2025-06", activeCount: 11, activeWithoutPayroll: 1, dataEndDate: REF, durationMs: 1234 });
    expect(s.error).toHaveLength(500);
    expect(s.users).toEqual({ created: 2, reactivated: 0, deactivated: 1, updated: 4 });
  });

  it("rapport absent, illisible ou sans comptage : repli sur le détail des rejets", () => {
    for (const report of [null, "{pas du json", JSON.stringify(["tableau"]), JSON.stringify({ files: {} }), JSON.stringify({ quality: {} })]) {
      const id = batch("OK", { report });
      rejection(id, "employees.csv", "GRADE_INCONNU", "CORRECTION");
      rejection(id, "employees.csv", "GRADE_INCONNU", "CORRECTION");
      const d = getImportDetail(w.ctx.admin, id);
      expect(d.countsSource, String(report)).toBe("detail");
      expect(d.byRule).toEqual([{ rule: "GRADE_INCONNU", severity: "CORRECTION", n: 2 }]);
      if (report === JSON.stringify({ files: {} })) expect(d.summary).toMatchObject({ files: [], rowScore: null, users: null, error: null, dataEndDate: null });
      else expect(d.summary).toBeNull();
    }
  });

  it("404 si inexistant ; MANAGER 403 audité avec la cible", () => {
    expectHttp(() => getImportDetail(w.ctx.rh, 999_999), 404, "INTROUVABLE");
    expectHttp(() => getImportDetail(w.ctx.mgr, 1), 403);
    expect(auditOf(db.sqlite, "import.view").at(-1)).toMatchObject({ outcome: "REFUSE", targetType: "import", targetId: "1" });
  });
});

describe("worker : heartbeat et alerte", () => {
  it("états ABSENT, ACTIF, EN_RETARD, PERIME selon l'âge du dernier signal", () => {
    setSetting(sqlite(), "worker_heartbeat", "");
    expect(workerStatus(sqlite())).toEqual({ heartbeatAt: null, ageSeconds: null, state: "ABSENT" });
    setSetting(sqlite(), "worker_heartbeat", "hier soir");
    expect(workerStatus(sqlite()).state).toBe("ABSENT");
    setSetting(sqlite(), "worker_heartbeat", ago(30));
    expect(workerStatus(sqlite())).toMatchObject({ state: "ACTIF", ageSeconds: 30 });
    setSetting(sqlite(), "worker_heartbeat", ago(300));
    expect(workerStatus(sqlite()).state).toBe("EN_RETARD");
    setSetting(sqlite(), "worker_heartbeat", new Date(Date.now() + 60_000).toISOString());
    expect(workerStatus(sqlite())).toMatchObject({ state: "ACTIF", ageSeconds: 0 });
  });

  it("alerte SYSTEME une seule fois par interruption, jamais si le worker est actif", () => {
    const hb = ago(3600);
    expect(raiseWorkerStaleAlert(sqlite(), { heartbeatAt: hb, ageSeconds: 3600, state: "EN_RETARD" })).toBe(false);
    expect(raiseWorkerStaleAlert(sqlite(), { heartbeatAt: null, ageSeconds: null, state: "PERIME" })).toBe(false);
    setSetting(sqlite(), "worker_heartbeat", hb);
    const w1 = workerStatus(sqlite());
    expect(w1.state).toBe("PERIME");
    expect(raiseWorkerStaleAlert(sqlite(), w1)).toBe(true);
    expect(raiseWorkerStaleAlert(sqlite(), w1)).toBe(false);
    const a = sqlite().prepare("SELECT audience, severity, link FROM alert WHERE dedup_key = ?").get(`systeme:worker-perime:${hb}`);
    expect(a).toEqual({ audience: "ADMIN", severity: "CRITIQUE", link: "/data-health" });
  });
});

describe("santé des données et file de jobs", () => {
  it("dernier import terminé (hors EN_COURS), import en cours, calcul courant, jobs récents", () => {
    sqlite().prepare("DELETE FROM import_rejection").run();
    sqlite().prepare("DELETE FROM import_batch").run();
    const ok = batch("OK", { started: "2025-06-01T00:00:00Z" });
    const running = batch("EN_COURS", { started: "2025-07-01T00:00:00Z" });
    const runId = publishRun(sqlite(), "B0", REF, [{ employeeId: w.e.T1, level: "ELEVE", prob6: 2, lift: 2 }], { version: "b0-v1" });
    sqlite().prepare("INSERT INTO app_job (type, status, error, created_by) VALUES ('IMPORT', 'ECHEC', ?, ?)").run("e".repeat(400), w.users.admin);
    setSetting(sqlite(), "worker_heartbeat", ago(10));
    const h = getDataHealth(w.ctx.rh);
    expect(h.lastImport?.id).toBe(ok);
    expect(h.runningImport?.id).toBe(running);
    expect(h.scoring).toEqual({ blocked: false, reason: null, currentRun: { id: runId, asOf: REF, finishedAt: expect.any(String), nScored: 1, modelVersion: "b0-v1" } });
    expect(h.jobs[0]).toMatchObject({ type: "IMPORT", status: "ECHEC", createdBy: "admin" });
    expect(h.jobs[0].error).toHaveLength(300);
    expect(h).toMatchObject({ dataEndDate: REF, qualityThreshold: 0.95, worker: { state: "ACTIF" } });
    expectHttp(() => getDataHealth(w.ctx.mgr), 403);
  });

  it("scoring demandé : refusé si le dernier import est bloqué (409 audité), hors données, antérieur au calcul courant", () => {
    const blocked = batch("BLOQUE", { started: "2025-08-01T00:00:00Z" });
    expect(getDataHealth(w.ctx.admin).scoring).toMatchObject({ blocked: true, reason: expect.stringContaining(`n° ${blocked}`) });
    expectHttp(() => requestScoring(w.ctx.rh), 409, "SCORING_BLOQUE");
    expectHttp(() => requestRecompute(w.ctx.admin), 409, "SCORING_BLOQUE");
    expect(auditOf(db.sqlite, "job.enqueue").slice(-2).map((a) => JSON.parse(a.detail!))).toEqual([
      { jobType: "SCORING", reason: "import_bloque" },
      { jobType: "BATCH_MENSUEL", reason: "import_bloque" },
    ]);
    sqlite().prepare("UPDATE import_batch SET status = 'OK' WHERE id = ?").run(blocked);

    expect(() => requestScoring(w.ctx.rh, { asOf: "2025-06-15" })).toThrow(ZodError);
    expect(() => requestScoring(w.ctx.rh, { asOf: "30/06/2025" })).toThrow(ZodError);
    expectHttp(() => requestScoring(w.ctx.rh, { asOf: "2025-07-31" }), 409, "MOIS_NON_COUVERT");
    expectHttp(() => requestScoring(w.ctx.rh, { asOf: "2025-05-31" }), 409, "MOIS_ANTERIEUR");
    setSetting(sqlite(), "data_end_date", "");
    sqlite().prepare("DELETE FROM attendance_daily").run();
    try {
      expectHttp(() => requestScoring(w.ctx.rh, { asOf: "2025-06-30" }), 409, "MOIS_NON_COUVERT");
    } finally {
      setSetting(sqlite(), "data_end_date", REF);
    }
    expectHttp(() => requestScoring(w.ctx.mgr), 403);
  });

  it("mise en file : un seul job actif par type, audit job.enqueue ; recalcul complet réservé à l'ADMIN", () => {
    sqlite().prepare("DELETE FROM app_job").run();
    const first = requestScoring(w.ctx.rh, { asOf: REF });
    expect(first.alreadyQueued).toBe(false);
    expect(sqlite().prepare("SELECT type, target, payload_json AS p, created_by AS u FROM app_job WHERE id = ?").get(first.jobId)).toEqual({
      type: "SCORING",
      target: REF,
      p: JSON.stringify({ asOf: REF }),
      u: w.users.rh,
    });
    expect(requestScoring(w.ctx.admin)).toEqual({ jobId: first.jobId, alreadyQueued: true });
    expectHttp(() => requestRecompute(w.ctx.rh), 403);
    const batchJob = requestRecompute(w.ctx.admin);
    expect(sqlite().prepare("SELECT type, target, payload_json AS p FROM app_job WHERE id = ?").get(batchJob.jobId)).toEqual({
      type: "BATCH_MENSUEL",
      target: null,
      p: JSON.stringify({ trigger: "manuel" }),
    });
    expect(auditOf(db.sqlite, "job.enqueue").filter((a) => a.outcome === "OK").map((a) => JSON.parse(a.detail!).alreadyQueued)).toEqual([false, true, false]);
  });
});

describe("téléversement d'un export AJIR", () => {
  const valid = () => [file("departments.csv", "code;name\nPROD;Production\n"), file("employees.csv", "\uFEFFmatricule;last_name\nA;B\n")];

  it("ADMIN seulement ; noms hors contrat, doublons ou liste vide refusés", async () => {
    await expectHttpAsync(() => saveUploadedExport(w.ctx.rh, valid()), 403);
    await expect(saveUploadedExport(w.ctx.admin, [file("../../etc/passwd", "a;b")])).rejects.toThrow(/Fichier non prévu par le contrat/);
    await expect(saveUploadedExport(w.ctx.admin, [file("employees.csv", "a;b"), file("employees.csv", "a;b")])).rejects.toThrow(/deux fois/);
    await expect(saveUploadedExport(w.ctx.admin, [])).rejects.toThrow(/Aucun fichier/);
  });

  it("taille totale, fichier vide, en-tête sans séparateur : refus sans rien écrire", async () => {
    await expectHttpAsync(() => saveUploadedExport(w.ctx.admin, [file("employees.csv", "a;b", UPLOAD_MAX_TOTAL_BYTES + 1)]), 413, "TROP_VOLUMINEUX");
    await expectHttpAsync(() => saveUploadedExport(w.ctx.admin, [file("employees.csv", "")]), 422, "EN_TETE_INVALIDE");
    await expectHttpAsync(() => saveUploadedExport(w.ctx.admin, [file("employees.csv", "matricule,last_name\n")]), 422, "EN_TETE_INVALIDE");
    expect(fs.existsSync(inboxRoot()) ? fs.readdirSync(inboxRoot()) : []).toEqual([]);
  });

  it("export valide : fichiers écrits dans la boîte de dépôt, job IMPORT en file, audit ; second envoi refusé (409)", async () => {
    sqlite().prepare("DELETE FROM app_job").run();
    const r = await saveUploadedExport(w.ctx.admin, valid());
    expect(r.alreadyQueued).toBe(false);
    expect(r.files).toEqual([
      { name: "departments.csv", size: Buffer.byteLength("code;name\nPROD;Production\n") },
      { name: "employees.csv", size: Buffer.byteLength("\uFEFFmatricule;last_name\nA;B\n") },
    ]);
    const dir = path.join(path.dirname(inboxRoot()), r.dir);
    expect(fs.readdirSync(dir).sort()).toEqual(["departments.csv", "employees.csv"]);
    expect(sqlite().prepare("SELECT type, target FROM app_job WHERE id = ?").get(r.jobId)).toEqual({ type: "IMPORT", target: r.dir });
    expect(auditOf(db.sqlite, "import.upload").at(-1)).toMatchObject({ outcome: "OK", targetId: String(r.jobId) });
    await expectHttpAsync(() => saveUploadedExport(w.ctx.admin, valid()), 409, "IMPORT_EN_COURS");
    expect(fs.readdirSync(inboxRoot())).toHaveLength(1);
  });

  it("deux dépôts dans la même seconde : dossiers distincts (suffixe), aucun écrasement", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-30T10:00:00.123Z"));
    try {
      sqlite().prepare("DELETE FROM app_job").run();
      const a = await saveUploadedExport(w.ctx.admin, valid());
      sqlite().prepare("UPDATE app_job SET status = 'TERMINE' WHERE id = ?").run(a.jobId);
      const b = await saveUploadedExport(w.ctx.admin, valid());
      expect(a.dir).toBe("inbox/20260930T100000Z");
      expect(b.dir).toBe("inbox/20260930T100000Z-2");
    } finally {
      vi.useRealTimers();
    }
  });

  it("échec de la mise en file : le dossier déposé est supprimé (pas de dépôt orphelin)", async () => {
    sqlite().prepare("DELETE FROM app_job").run();
    const before = fs.readdirSync(inboxRoot()).sort();
    sqlite().exec("CREATE TRIGGER fail_job BEFORE INSERT ON app_job BEGIN SELECT RAISE(ABORT, 'file indisponible'); END;");
    try {
      await expect(saveUploadedExport(w.ctx.admin, valid())).rejects.toThrow(/file indisponible/);
    } finally {
      sqlite().exec("DROP TRIGGER fail_job");
    }
    expect(fs.readdirSync(inboxRoot()).sort()).toEqual(before);
  });
});

describe("/api/health", () => {
  it("ok avec worker actif et champion B0 sans bundle ; dégradé sans champion ; erreur si la base est inaccessible", () => {
    setSetting(sqlite(), "worker_heartbeat", ago(5));
    sqlite().prepare("UPDATE model_version SET status = 'RETIRE'").run();
    sqlite().prepare("INSERT INTO model_version (version, kind, status, fsv) VALUES ('b0-sans-chemin', 'B0', 'CHAMPION', 'v1')").run();
    expect(getSystemHealth()).toEqual({ status: "ok", database: "ok", worker: { state: "ACTIF", heartbeatAgeSeconds: 5 }, model: { championLoaded: true } });
    sqlite().prepare("UPDATE model_version SET status = 'RETIRE'").run();
    expect(getSystemHealth()).toMatchObject({ status: "degrade", model: { championLoaded: false } });
    sqlite().prepare("INSERT INTO model_version (version, kind, status, fsv, bundle_path) VALUES ('lr-perdu', 'LOGREG', 'CHAMPION', 'v1', 'models/turnover/nexiste-pas')").run();
    expect(getSystemHealth()).toMatchObject({ status: "degrade", model: { championLoaded: false } });

    const g = globalThis as { __paDb?: { sqlite: { close(): void } } };
    g.__paDb!.sqlite.close();
    expect(getSystemHealth()).toEqual({ status: "erreur", database: "erreur", worker: { state: "ABSENT", heartbeatAgeSeconds: null }, model: { championLoaded: false } });
    g.__paDb = undefined;
    expect(getSystemHealth().database).toBe("ok");
  });
});
