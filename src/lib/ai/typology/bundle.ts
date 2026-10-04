import fs from "node:fs";
import path from "node:path";
import { checkTypologyGolden, parseTypologyBundle, type TypologyBundle } from "./model";

// Version fixée, chargée comme un bundle depuis models/typology/<version>/ : le registre topic_model n'accepte que les
// sujets de AI_TOPICS (src/db/schema.ts), qu'on ne modifie pas sans migration. Réentraîner = nouvelle version ici et
// dans ml/typology/run.py (VERSION).
export const TYPOLOGY_VERSION = "typo-kmeans-v1-20261004";
export const TYPOLOGY_DIR = "models/typology";

export type TypologyModelState =
  | { status: "OK"; version: string; bundle: TypologyBundle; goldenRows: number; maxDiff: number }
  | { status: "ABSENT"; version: string }
  | { status: "INVALIDE"; version: string; error: string };

const cache = new Map<string, TypologyModelState>();

export function typologyBundleDir(version = TYPOLOGY_VERSION): string {
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), TYPOLOGY_DIR, version);
}

// Contrôle de parité golden (1e-9) au premier chargement, puis cache par processus tant que model.json ne change pas.
// Absence non mise en cache : un bundle déposé après le démarrage est pris en compte sans redémarrer.
export function loadTypologyModel(version = TYPOLOGY_VERSION): TypologyModelState {
  const dir = typologyBundleDir(version);
  const modelFile = path.join(dir, "model.json");
  if (!fs.existsSync(modelFile)) return { status: "ABSENT", version };
  const key = `${version}:${fs.statSync(modelFile).mtimeMs}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let state: TypologyModelState;
  try {
    const bundle = parseTypologyBundle(JSON.parse(fs.readFileSync(modelFile, "utf8")));
    if (bundle.version !== version) throw new Error(`Bundle ${bundle.version} rangé sous ${version}.`);
    const goldenFile = path.join(dir, "golden.json");
    if (!fs.existsSync(goldenFile)) throw new Error("golden.json absent : parité Python / TypeScript non vérifiable.");
    const g = checkTypologyGolden(bundle, JSON.parse(fs.readFileSync(goldenFile, "utf8")));
    state = { status: "OK", version, bundle, goldenRows: g.rows, maxDiff: g.maxDiff };
  } catch (e) {
    state = { status: "INVALIDE", version, error: e instanceof Error ? e.message : String(e) };
  }
  cache.set(key, state);
  return state;
}
