import fs from "node:fs";
import path from "node:path";

// Fourchettes de prévision à couverture vérifiée (prédiction conforme, ml/<sujet>/conformal.py). Les versions calibrées
// d'un modèle portent un champ additif `conformal` : quantiles signés [bas, haut] appliqués par l'inférence du sujet,
// et couverture mesurée sur une fenêtre de test jamais utilisée pour les caler. Sans ce champ, rien ne change.

export type CoverageByH = { n: number; coverage: number | null; width?: number | null; before?: number | null; width_before?: number | null; v1_shipped?: number | null };
export type CoverageCell = {
  months: number; // mois de test distincts (valeurs observées comparées à la fourchette)
  from: string;
  to: string;
  n: number;
  coverage: number | null;
  target: number;
  width?: number | null;
  before?: number | null; // procédure de la version source, mêmes prévisions de test
  width_before?: number | null;
  ci95?: [number, number];
  by_h?: Record<string, CoverageByH>;
};
export type ConformalInfo = {
  method: string;
  level: number;
  source_version?: string;
  calibration: { targets: [string, string]; months: number };
  test: { origins: [string, string]; targets: [string, string]; months: number };
  coverage: Record<string, CoverageCell>;
};

// Intervalle conforme à rangs sur des scores signés (y - ŷ) / échelle : [z(i), z(j)] des n scores triés, avec
// m = ceil((n + 1) × niveau) écarts, i = floor((n + 1 - m) / 2), j = i + m. Pour un score futur échangeable,
// P(z(i) <= Z <= z(j)) >= (j - i) / (n + 1) >= niveau. Élargi pour contenir 0 ; null si n est trop petit (n < 9 à 80 %).
// Même calcul que signed_interval (Python) : parité vérifiée sur les scores de calibration (conformal_parity.json).
export function conformalInterval(scores: readonly number[], level: number): [number, number] | null {
  const z = scores.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const n = z.length;
  const m = Math.ceil((n + 1) * level - 1e-9);
  const i = Math.floor((n + 1 - m) / 2);
  const j = i + m;
  if (i < 1 || j > n) return null;
  return [Math.min(z[i - 1], 0), Math.max(z[j - 1], 0)];
}

export type ConformalTopic = "absenteeism" | "workload" | "workforce";
const SAFE_VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const cache = new Map<string, ConformalInfo>();

// Couverture mesurée du modèle qui a produit les prévisions affichées : models/<sujet>/<version>/model.json (dossier
// du registre). null pour une version sans champ `conformal`, un dossier absent ou un nom de version inattendu.
export function readConformal(topic: ConformalTopic, version: string | null | undefined): ConformalInfo | null {
  if (!version || !SAFE_VERSION.test(version)) return null;
  const key = `${topic}/${version}`;
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    const file = path.join(path.resolve(/*turbopackIgnore: true*/ process.cwd(), "models", topic), version, "model.json");
    const b = JSON.parse(fs.readFileSync(file, "utf8")) as { version?: string; conformal?: ConformalInfo };
    if (b.version !== version || !b.conformal?.coverage) return null;
    cache.set(key, b.conformal);
    return b.conformal;
  } catch {
    return null;
  }
}
