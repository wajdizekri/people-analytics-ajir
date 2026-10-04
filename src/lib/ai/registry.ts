import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import type { AI_TOPICS } from "@/db/schema";

export type AiTopic = (typeof AI_TOPICS)[number];
export type TopicModelRow = { id: number; topic: AiTopic; version: string; kind: string; status: string; bundle_path: string | null; metrics_json: string | null };

// Chemin enregistré relatif à la racine du projet quand le bundle s'y trouve (base déplaçable avec l'installation),
// absolu sinon ; résolu depuis le dossier courant au chargement.
function portablePath(dir: string): string {
  const abs = path.resolve(/*turbopackIgnore: true*/ process.cwd(), dir);
  const rel = path.relative(process.cwd(), abs);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel.split(path.sep).join("/") : abs;
}

const bundleDir = (row: TopicModelRow) => path.resolve(/*turbopackIgnore: true*/ process.cwd(), row.bundle_path!);

// Registre commun des modèles par sujet : models/<sujet>/<version>/model.json (+ golden.json), entraînés hors ligne en Python.
export function registerTopicModel(sqlite: Database.Database, topic: AiTopic, dir: string): TopicModelRow {
  const bundlePath = portablePath(dir);
  const model = JSON.parse(fs.readFileSync(path.join(path.resolve(/*turbopackIgnore: true*/ process.cwd(), bundlePath), "model.json"), "utf8")) as {
    version: string;
    kind: string;
    metrics?: unknown;
  };
  sqlite
    .prepare(
      `INSERT INTO topic_model (topic, version, kind, bundle_path, metrics_json) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(version) DO UPDATE SET bundle_path = excluded.bundle_path, metrics_json = excluded.metrics_json, kind = excluded.kind`,
    )
    .run(topic, model.version, model.kind, bundlePath, model.metrics ? JSON.stringify(model.metrics) : null);
  return sqlite.prepare("SELECT * FROM topic_model WHERE version = ?").get(model.version) as TopicModelRow;
}

export function promoteTopicModel(sqlite: Database.Database, version: string): void {
  sqlite.transaction(() => {
    const row = sqlite.prepare("SELECT topic FROM topic_model WHERE version = ?").get(version) as { topic: string } | undefined;
    if (!row) throw new Error(`Modèle inconnu : ${version}`);
    sqlite.prepare("UPDATE topic_model SET status = 'RETIRE' WHERE topic = ? AND status = 'CHAMPION'").run(row.topic);
    sqlite.prepare("UPDATE topic_model SET status = 'CHAMPION', promoted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE version = ?").run(version);
  })();
}

export function championTopicModel(sqlite: Database.Database, topic: AiTopic): TopicModelRow | null {
  return (sqlite.prepare("SELECT * FROM topic_model WHERE topic = ? AND status = 'CHAMPION'").get(topic) as TopicModelRow | undefined) ?? null;
}

export function loadBundle<T>(row: TopicModelRow): T {
  if (!row.bundle_path) throw new Error(`Modèle ${row.version} sans bundle.`);
  return JSON.parse(fs.readFileSync(path.join(bundleDir(row), "model.json"), "utf8")) as T;
}

export function loadGolden<T>(row: TopicModelRow): T | null {
  const f = row.bundle_path ? path.join(bundleDir(row), "golden.json") : null;
  return f && fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, "utf8")) as T) : null;
}
