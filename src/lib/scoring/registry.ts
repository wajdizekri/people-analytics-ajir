import type Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { auditSqlite, systemAlert, today } from "../engine/alerts";
import { B0_RULES, FEATURE_NAMES, FSV } from "../features/spec";
import {
  checkBundle,
  goldenMaxDiff,
  goldenSchema,
  GOLDEN_TOLERANCE,
  parseBundle,
  toLoadedModel,
  type GoldenRow,
  type LoadedModel,
  type ModelBundle,
} from "./model";

export const B0_VERSION = "b0-v1";
export const B0_DIR = "models/turnover/b0-v1";

export type ModelRow = {
  id: number;
  version: string;
  kind: "B0" | "LOGREG" | "LGBM";
  status: "CANDIDAT" | "CHAMPION" | "RETIRE";
  fsv: string;
  bundlePath: string | null;
  manifestJson: string | null;
  metricsJson: string | null;
  createdAt: string;
  promotedAt: string | null;
  promotedBy: number | null;
};

type Manifest = { sha256: string; bundle: ModelBundle; golden: GoldenRow[] | null };

const SELECT_MODEL = `SELECT id, version, kind, status, fsv, bundle_path AS bundlePath, manifest_json AS manifestJson,
  metrics_json AS metricsJson, created_at AS createdAt, promoted_at AS promotedAt, promoted_by AS promotedBy FROM model_version`;

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

function resolveDir(dir: string): string {
  return path.isAbsolute(dir) ? dir : path.resolve(/*turbopackIgnore: true*/ process.cwd(), dir);
}

function portablePath(dir: string): string {
  const rel = path.relative(process.cwd(), resolveDir(dir));
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel.split(path.sep).join("/") : resolveDir(dir);
}

export function readBundleDir(dir: string): Manifest {
  const abs = resolveDir(dir);
  const text = fs.readFileSync(path.join(abs, "model.json"), "utf8");
  const bundle = parseBundle(JSON.parse(text));
  const goldenFile = path.join(abs, "golden.json");
  let goldenText = "";
  let golden: GoldenRow[] | null = null;
  if (fs.existsSync(goldenFile)) {
    goldenText = fs.readFileSync(goldenFile, "utf8");
    golden = goldenSchema.parse(JSON.parse(goldenText));
  }
  return { sha256: sha256(text + goldenText), bundle, golden };
}

function b0Manifest(): Manifest {
  try {
    return readBundleDir(B0_DIR);
  } catch {
    const bundle: ModelBundle = { version: B0_VERSION, kind: "B0", fsv: FSV, features: FEATURE_NAMES, rules: B0_RULES };
    return { sha256: sha256(JSON.stringify(bundle)), bundle, golden: null };
  }
}

export type CheckResult = { ok: boolean; errors: string[]; goldenRows: number; maxDiff: number | null };

export function checkManifest(m: Manifest): CheckResult {
  const errors = checkBundle(m.bundle);
  let maxDiff: number | null = null;
  const rows = m.golden?.length ?? 0;
  if (!errors.length) {
    const model = toLoadedModel(m.bundle, null);
    if (m.golden && rows > 0) {
      maxDiff = goldenMaxDiff(model, m.golden);
      if (!(maxDiff <= GOLDEN_TOLERANCE)) errors.push(`golden non reproduit : écart max ${maxDiff} > ${GOLDEN_TOLERANCE}`);
    } else if (m.bundle.kind !== "B0") errors.push("golden.json absent ou vide");
  }
  return { ok: errors.length === 0, errors, goldenRows: rows, maxDiff };
}

export function getModel(sqlite: Database.Database, version: string): ModelRow | null {
  return (sqlite.prepare(`${SELECT_MODEL} WHERE version = ?`).get(version) as ModelRow | undefined) ?? null;
}

export function listModels(sqlite: Database.Database): ModelRow[] {
  return sqlite.prepare(`${SELECT_MODEL} ORDER BY id`).all() as ModelRow[];
}

function insertManifest(sqlite: Database.Database, m: Manifest, bundlePath: string | null, userId: number | null): number {
  const existing = getModel(sqlite, m.bundle.version);
  if (existing) {
    const stored = existing.manifestJson ? (JSON.parse(existing.manifestJson) as Manifest) : null;
    if (stored?.sha256 !== m.sha256) throw new Error(`La version ${m.bundle.version} est déjà enregistrée avec un contenu différent.`);
    // Mêmes fichiers relus avec un schéma enrichi (ex. train_from / train_to) : le manifeste enregistré est complété.
    if (JSON.stringify(stored.bundle) !== JSON.stringify(m.bundle))
      sqlite.prepare("UPDATE model_version SET manifest_json = ? WHERE id = ?").run(JSON.stringify(m), existing.id);
    return existing.id;
  }
  const check = checkManifest(m);
  if (!check.ok) throw new Error(`Bundle refusé : ${check.errors.join(" ; ")}`);
  const metrics = m.bundle.metrics ?? {};
  const id = Number(
    sqlite
      .prepare("INSERT INTO model_version (version, kind, status, fsv, bundle_path, manifest_json, metrics_json) VALUES (?, ?, 'CANDIDAT', ?, ?, ?, ?)")
      .run(m.bundle.version, m.bundle.kind, m.bundle.fsv, bundlePath, JSON.stringify(m), JSON.stringify(metrics)).lastInsertRowid,
  );
  auditSqlite(sqlite, userId, "model.register", { type: "model_version", id: m.bundle.version }, "OK", { sha256: m.sha256, kind: m.bundle.kind });
  return id;
}

export function registerBundle(sqlite: Database.Database, dir: string, userId: number | null = null): number {
  return insertManifest(sqlite, readBundleDir(dir), portablePath(dir), userId);
}

// Rejoue le golden ; si les fichiers du bundle sont présents, vérifie aussi leur empreinte.
export function verifyModel(sqlite: Database.Database, version: string): CheckResult {
  const row = getModel(sqlite, version);
  if (!row?.manifestJson) return { ok: false, errors: [`version inconnue : ${version}`], goldenRows: 0, maxDiff: null };
  const stored = JSON.parse(row.manifestJson) as Manifest;
  const res = checkManifest(stored);
  if (row.bundlePath && fs.existsSync(path.join(resolveDir(row.bundlePath), "model.json"))) {
    try {
      const onDisk = readBundleDir(row.bundlePath);
      if (onDisk.sha256 !== stored.sha256) res.errors.push("les fichiers du bundle ont changé depuis l'enregistrement (sha256)");
    } catch (e) {
      res.errors.push(`bundle illisible : ${(e as Error).message}`);
    }
  }
  res.ok = res.errors.length === 0;
  return res;
}

export function promoteModel(sqlite: Database.Database, version: string, userId: number | null = null): void {
  const row = getModel(sqlite, version);
  if (!row) throw new Error(`Version inconnue : ${version}`);
  const check = verifyModel(sqlite, version);
  if (!check.ok) {
    auditSqlite(sqlite, userId, "model.promote", { type: "model_version", id: version }, "ECHEC", { errors: check.errors });
    throw new Error(`Promotion refusée : ${check.errors.join(" ; ")}`);
  }
  sqlite
    .transaction(() => {
      const prev = sqlite.prepare("SELECT version FROM model_version WHERE status = 'CHAMPION'").get() as { version: string } | undefined;
      sqlite.prepare("UPDATE model_version SET status = 'RETIRE' WHERE status = 'CHAMPION' AND id <> ?").run(row.id);
      sqlite
        .prepare("UPDATE model_version SET status = 'CHAMPION', promoted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), promoted_by = ? WHERE id = ?")
        .run(userId, row.id);
      auditSqlite(sqlite, userId, "model.promote", { type: "model_version", id: version }, "OK", {
        previous: prev?.version ?? null,
        goldenRows: check.goldenRows,
        maxDiff: check.maxDiff,
      });
    })
    .immediate();
  championCache.clear();
}

// Repromeut la version championne précédente (bundle conservé).
export function rollbackModel(sqlite: Database.Database, userId: number | null = null): string {
  const current = sqlite.prepare("SELECT id FROM model_version WHERE status = 'CHAMPION'").get() as { id: number } | undefined;
  const prev = sqlite
    .prepare("SELECT version FROM model_version WHERE status = 'RETIRE' AND promoted_at IS NOT NULL AND id <> ? ORDER BY promoted_at DESC, id DESC LIMIT 1")
    .get(current?.id ?? -1) as { version: string } | undefined;
  if (!prev) throw new Error("Aucune version précédente à repromouvoir.");
  promoteModel(sqlite, prev.version, userId);
  auditSqlite(sqlite, userId, "model.rollback", { type: "model_version", id: prev.version });
  return prev.version;
}

const championCache = new Map<string, LoadedModel>();

type ChampionState = { model: LoadedModel } | { model: null; reason: "ABSENT" | "INVALIDE"; errors: string[]; version?: string };

export function loadChampionState(sqlite: Database.Database): ChampionState {
  const row = sqlite.prepare(`${SELECT_MODEL} WHERE status = 'CHAMPION'`).get() as ModelRow | undefined;
  if (!row) return { model: null, reason: "ABSENT", errors: [] };
  // Clé = ligne + horodatage de promotion + empreinte du manifeste : toute altération, même à longueur égale, recharge.
  const key = `${row.id}:${row.promotedAt ?? ""}:${sha256(row.manifestJson ?? "")}`;
  const cached = championCache.get(key);
  if (cached) return { model: cached };
  let errors: string[];
  try {
    const manifest = JSON.parse(row.manifestJson ?? "null") as Manifest | null;
    if (!manifest) throw new Error("manifeste absent");
    const res = checkManifest(manifest);
    errors = res.errors;
    if (res.ok) {
      const model = toLoadedModel(manifest.bundle, row.id);
      championCache.clear();
      championCache.set(key, model);
      return { model };
    }
  } catch (e) {
    errors = [(e as Error).message];
  }
  systemAlert(
    sqlite,
    `modele-invalide:${row.version}:${today()}`,
    "Modèle en service illisible",
    `Le modèle ${row.version} ne peut pas être chargé : ${errors.join(" ; ")}. Le calcul des risques est suspendu jusqu'à la correction de ses fichiers ou le retour à la version précédente (procédure du guide d'exploitation).`,
  );
  return { model: null, reason: "INVALIDE", errors, version: row.version };
}

export function loadChampion(sqlite: Database.Database): LoadedModel | null {
  return loadChampionState(sqlite).model;
}

// Score à règles B0 utilisé à la place d'un champion probabiliste (démarrage à froid) : enregistré au besoin, jamais promu.
export function loadB0Fallback(sqlite: Database.Database, userId: number | null = null): LoadedModel {
  const row = getModel(sqlite, B0_VERSION);
  if (row?.manifestJson) {
    const manifest = JSON.parse(row.manifestJson) as Manifest;
    if (manifest.bundle.kind === "B0" && checkManifest(manifest).ok) return toLoadedModel(manifest.bundle, row.id);
  }
  const manifest = b0Manifest();
  const id = insertManifest(sqlite, manifest, fs.existsSync(resolveDir(B0_DIR)) ? B0_DIR : null, userId);
  return toLoadedModel(manifest.bundle, id);
}

// Sans champion : B0 est enregistré et promu. Champion invalide : refus.
export function ensureChampion(sqlite: Database.Database, userId: number | null = null): LoadedModel {
  let state = loadChampionState(sqlite);
  if (!state.model && state.reason === "ABSENT") {
    const manifest = b0Manifest();
    insertManifest(sqlite, manifest, fs.existsSync(resolveDir(B0_DIR)) ? B0_DIR : null, userId);
    promoteModel(sqlite, manifest.bundle.version, userId);
    state = loadChampionState(sqlite);
  }
  if (!state.model) throw new Error(`Aucun modèle utilisable : ${"errors" in state ? state.errors.join(" ; ") : ""}`);
  return state.model;
}
