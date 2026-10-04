import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "../fixtures/engine/db";
import { B0_RULES, FEATURE_NAMES, FSV } from "@/lib/features/spec";
import {
  B0_VERSION,
  checkManifest,
  ensureChampion,
  getModel,
  listModels,
  loadChampion,
  loadChampionState,
  promoteModel,
  readBundleDir,
  registerBundle,
  rollbackModel,
  verifyModel,
} from "@/lib/scoring/registry";

const TOY = path.resolve(__dirname, "../fixtures/engine/logreg-toy");
const toyBundle = () => JSON.parse(fs.readFileSync(path.join(TOY, "model.json"), "utf8"));
const toyGolden = () => fs.readFileSync(path.join(TOY, "golden.json"), "utf8");

let root = "";
const bundleDir = (name: string, model: unknown, golden?: string | null) => {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "model.json"), JSON.stringify(model));
  if (golden != null) fs.writeFileSync(path.join(dir, "golden.json"), golden);
  return dir;
};
const audits = (db: TestDb, action: string) =>
  db.sqlite.prepare("SELECT user_id AS u, target_id AS t, outcome, detail_json AS d FROM audit_log WHERE action = ? ORDER BY id").all(action) as {
    u: number | null;
    t: string;
    outcome: string;
    d: string | null;
  }[];

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "pa-unit-registry-"));
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
afterEach(() => vi.restoreAllMocks());

describe("enregistrement des bundles", () => {
  let db: TestDb;
  beforeAll(() => (db = createTestDb()));
  afterAll(() => db.close());

  it("chemin portable : relatif sous le projet, absolu en dehors ; audit model.register", () => {
    const id = registerBundle(db.sqlite, TOY, 3);
    expect(getModel(db.sqlite, "logreg-toy-v1")).toMatchObject({ id, status: "CANDIDAT", kind: "LOGREG", bundlePath: "tests/fixtures/engine/logreg-toy" });
    const outside = bundleDir("hors-projet", { ...toyBundle(), version: "logreg-hors-projet" }, toyGolden());
    registerBundle(db.sqlite, outside);
    expect(getModel(db.sqlite, "logreg-hors-projet")!.bundlePath).toBe(outside);
    expect(audits(db, "model.register").map((a) => [a.u, a.t, a.outcome])).toEqual([
      [3, "logreg-toy-v1", "OK"],
      [null, "logreg-hors-projet", "OK"],
    ]);
  });

  it("réenregistrement idempotent à contenu identique ; refus si le contenu d'une version change", () => {
    const before = listModels(db.sqlite).length;
    expect(registerBundle(db.sqlite, TOY)).toBe(getModel(db.sqlite, "logreg-toy-v1")!.id);
    expect(listModels(db.sqlite)).toHaveLength(before);
    const changed = bundleDir("meme-version", { ...toyBundle(), intercept: toyBundle().intercept + 0.1 }, toyGolden());
    expect(() => registerBundle(db.sqlite, changed)).toThrow(/déjà enregistrée avec un contenu différent/);
    db.sqlite.prepare("INSERT INTO model_version (version, kind, fsv) VALUES ('logreg-sans-manifeste', 'LOGREG', 'v1')").run();
    const same = bundleDir("sans-manifeste", { ...toyBundle(), version: "logreg-sans-manifeste" }, toyGolden());
    expect(() => registerBundle(db.sqlite, same)).toThrow(/déjà enregistrée avec un contenu différent/);
  });

  it("LOGREG sans golden, ou golden vide : refusé ; B0 sans golden : accepté", () => {
    const noGolden = bundleDir("sans-golden", { ...toyBundle(), version: "logreg-sans-golden" });
    expect(readBundleDir(noGolden).golden).toBeNull();
    expect(() => registerBundle(db.sqlite, noGolden)).toThrow(/golden.json absent ou vide/);
    const emptyGolden = bundleDir("golden-vide", { ...toyBundle(), version: "logreg-golden-vide" }, "[]");
    expect(() => registerBundle(db.sqlite, emptyGolden)).toThrow(/golden.json absent ou vide/);
    const b0 = bundleDir("b0-sans-golden", { version: "b0-local", kind: "B0", fsv: FSV, rules: B0_RULES });
    registerBundle(db.sqlite, b0);
    expect(verifyModel(db.sqlite, "b0-local")).toEqual({ ok: true, errors: [], goldenRows: 0, maxDiff: null });
    expect(checkManifest(readBundleDir(b0)).ok).toBe(true);
  });

  it("golden au mauvais format refusé à la lecture", () => {
    const bad = bundleDir("golden-malforme", { ...toyBundle(), version: "logreg-golden-malforme" }, JSON.stringify([{ x: "a", p: 1 }]));
    expect(() => readBundleDir(bad)).toThrow();
    expect(getModel(db.sqlite, "logreg-golden-malforme")).toBeNull();
  });
});

describe("vérification, promotion et rollback", () => {
  let db: TestDb;
  beforeAll(() => (db = createTestDb()));
  afterAll(() => db.close());

  it("version inconnue : vérification en échec, promotion refusée", () => {
    expect(verifyModel(db.sqlite, "nexiste-pas")).toEqual({ ok: false, errors: ["version inconnue : nexiste-pas"], goldenRows: 0, maxDiff: null });
    expect(() => promoteModel(db.sqlite, "nexiste-pas")).toThrow(/Version inconnue/);
  });

  it("aucune version précédente : rollback refusé", () => {
    expect(() => rollbackModel(db.sqlite)).toThrow(/Aucune version précédente/);
    ensureChampion(db.sqlite);
    expect(() => rollbackModel(db.sqlite)).toThrow(/Aucune version précédente/);
  });

  it("fichiers modifiés après enregistrement : vérification en échec, promotion refusée et auditée ECHEC", () => {
    const dir = bundleDir("modifie", { ...toyBundle(), version: "logreg-modifie" }, toyGolden());
    registerBundle(db.sqlite, dir);
    expect(verifyModel(db.sqlite, "logreg-modifie")).toMatchObject({ ok: true, goldenRows: 200 });
    fs.writeFileSync(path.join(dir, "model.json"), JSON.stringify({ ...toyBundle(), version: "logreg-modifie", train_rows: 1 }));
    const res = verifyModel(db.sqlite, "logreg-modifie");
    expect(res.ok).toBe(false);
    expect(res.errors).toEqual(["les fichiers du bundle ont changé depuis l'enregistrement (sha256)"]);
    expect(() => promoteModel(db.sqlite, "logreg-modifie", 9)).toThrow(/Promotion refusée : les fichiers du bundle ont changé/);
    const last = audits(db, "model.promote").at(-1)!;
    expect(last).toMatchObject({ u: 9, t: "logreg-modifie", outcome: "ECHEC" });
    expect(loadChampion(db.sqlite)?.version).toBe(B0_VERSION);

    fs.writeFileSync(path.join(dir, "model.json"), "{ pas du json");
    expect(verifyModel(db.sqlite, "logreg-modifie").errors[0]).toMatch(/^bundle illisible : /);

    fs.rmSync(dir, { recursive: true, force: true });
    expect(verifyModel(db.sqlite, "logreg-modifie")).toMatchObject({ ok: true, errors: [] });
  });

  it("promotion : un seul CHAMPION, précédent RETIRE et tracé ; rollback vers le dernier champion retiré", () => {
    registerBundle(db.sqlite, TOY);
    promoteModel(db.sqlite, "logreg-toy-v1", 4);
    promoteModel(db.sqlite, "logreg-modifie", 4);
    const status = Object.fromEntries(listModels(db.sqlite).map((m) => [m.version, m.status]));
    expect(status).toEqual({ [B0_VERSION]: "RETIRE", "logreg-toy-v1": "RETIRE", "logreg-modifie": "CHAMPION" });
    const ok = audits(db, "model.promote").filter((a) => a.outcome === "OK");
    expect(JSON.parse(ok.at(-1)!.d!)).toMatchObject({ previous: "logreg-toy-v1", goldenRows: 200 });
    expect(rollbackModel(db.sqlite, 4)).toBe("logreg-toy-v1");
    expect(loadChampion(db.sqlite)?.version).toBe("logreg-toy-v1");
    expect(audits(db, "model.rollback").map((a) => [a.u, a.t])).toEqual([[4, "logreg-toy-v1"]]);
  });
});

describe("chargement du champion", () => {
  let db: TestDb;
  beforeAll(() => (db = createTestDb()));
  afterAll(() => db.close());

  it("absent : état ABSENT sans alerte ; chargé une fois puis servi par le cache", () => {
    expect(loadChampionState(db.sqlite)).toEqual({ model: null, reason: "ABSENT", errors: [] });
    const m = ensureChampion(db.sqlite);
    expect(loadChampion(db.sqlite)).toBe(m);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM alert").get()).toEqual({ n: 0 });
  });

  it("manifeste absent ou illisible : INVALIDE, alerte SYSTEME dédupliquée, ensureChampion refuse sans promouvoir B0", () => {
    db.sqlite.prepare("INSERT INTO model_version (version, kind, status, fsv) VALUES ('logreg-orphelin', 'LOGREG', 'CANDIDAT', 'v1')").run();
    db.sqlite.prepare("UPDATE model_version SET status = CASE version WHEN 'logreg-orphelin' THEN 'CHAMPION' ELSE 'RETIRE' END").run();
    const state = loadChampionState(db.sqlite);
    expect(state).toMatchObject({ model: null, reason: "INVALIDE", errors: ["manifeste absent"], version: "logreg-orphelin" });
    loadChampionState(db.sqlite);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM alert WHERE dedup_key LIKE 'systeme:modele-invalide:logreg-orphelin:%'").get()).toEqual({ n: 1 });
    expect(() => ensureChampion(db.sqlite)).toThrow(/Aucun modèle utilisable : manifeste absent/);
    expect(listModels(db.sqlite).filter((m) => m.status === "CHAMPION").map((m) => m.version)).toEqual(["logreg-orphelin"]);

    db.sqlite.prepare("UPDATE model_version SET manifest_json = '{pas du json' WHERE version = 'logreg-orphelin'").run();
    const bad = loadChampionState(db.sqlite);
    expect(bad).toMatchObject({ model: null, reason: "INVALIDE" });
    expect((bad as { errors: string[] }).errors[0]).toMatch(/JSON/);
  });
});

describe("cache du champion", () => {
  // B2 (docs/qa/COUVERTURE.md), corrigé : la clé du cache inclut le SHA-256 du manifeste (et la date de promotion) ;
  // un manifeste altéré à longueur égale (fsv "v1" -> "v0") est rechargé, contrôlé et refusé.
  it("un manifeste altéré après chargement est refusé, même à longueur égale", () => {
    const db = createTestDb();
    try {
      registerBundle(db.sqlite, TOY);
      promoteModel(db.sqlite, "logreg-toy-v1");
      expect(loadChampion(db.sqlite)?.version).toBe("logreg-toy-v1");
      const row = db.sqlite.prepare("SELECT manifest_json AS m FROM model_version WHERE version = 'logreg-toy-v1'").get() as { m: string };
      const tampered = JSON.parse(row.m);
      tampered.bundle.fsv = "v0";
      const text = JSON.stringify(tampered);
      expect(text.length).toBe(row.m.length);
      db.sqlite.prepare("UPDATE model_version SET manifest_json = ? WHERE version = 'logreg-toy-v1'").run(text);
      expect(loadChampion(db.sqlite)).toBeNull();
    } finally {
      db.close();
    }
  });
});

describe("repli B0 sans dossier de bundle", () => {
  it("bundle construit depuis features.json, enregistré sans chemin et promu", () => {
    const db = createTestDb();
    try {
      vi.spyOn(process, "cwd").mockReturnValue(root);
      const m = ensureChampion(db.sqlite, 5);
      expect(m).toMatchObject({ version: B0_VERSION, kind: "B0", fsv: FSV });
      expect(m.bundle).toEqual({ version: B0_VERSION, kind: "B0", fsv: FSV, features: FEATURE_NAMES, rules: B0_RULES });
      expect(getModel(db.sqlite, B0_VERSION)).toMatchObject({ status: "CHAMPION", bundlePath: null, promotedBy: 5 });
      expect(verifyModel(db.sqlite, B0_VERSION).ok).toBe(true);
    } finally {
      vi.restoreAllMocks();
      db.close();
    }
  });
});
