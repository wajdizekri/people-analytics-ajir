import "server-only";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getDb } from "@/db/client";
import { coldStartState, currentPublishedAsOf, type ColdStartState } from "@/lib/scoring";
import { dataEndDate, getSetting } from "@/lib/settings";
import featuresContract from "../../../shared/features.json";
import { ensureRole } from "./admin";
import type { AccessContext } from "./context";

type Contract = {
  fsv: string;
  groups: Record<string, { label_rh: string; label_manager: string; actionable: boolean }>;
  features: { name: string; group: string; unit?: string; label: string }[];
  b0_rules: { feature: string; op: string; value: number; points: number }[];
};
const CONTRACT = featuresContract as Contract;

const ruleSchema = z.object({ feature: z.string(), op: z.string(), value: z.number(), points: z.number() });
const bundleSchema = z.object({
  version: z.string(),
  kind: z.enum(["B0", "LOGREG", "LGBM"]),
  fsv: z.string(),
  features: z.array(z.string()).nullish(),
  standardization: z.object({ mean: z.array(z.number()), std: z.array(z.number()) }).nullish(),
  coef: z.array(z.number()).nullish(),
  intercept: z.number().nullish(),
  calibration: z.object({ method: z.string(), a: z.number(), b: z.number() }).nullish(),
  base_rate: z.number().nullish(),
  trained_at: z.string().nullish(),
  data_hash: z.string().nullish(),
  train_rows: z.number().nullish(),
  rules: z.array(ruleSchema).nullish(),
  metrics: z.unknown().nullish(),
});
type Bundle = z.infer<typeof bundleSchema>;

const PROJECT_ROOT = path.resolve(/*turbopackIgnore: true*/ process.cwd());

// bundle_path peut désigner le dossier du modèle ou son model.json ; il doit rester sous la racine du projet.
function resolveBundleFile(bundlePath: string): string | null {
  const abs = path.resolve(/*turbopackIgnore: true*/ PROJECT_ROOT, bundlePath);
  const file = path.basename(abs) === "model.json" ? abs : path.join(abs, "model.json");
  const rel = path.relative(PROJECT_ROOT, file);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return file;
}

export function readBundle(bundlePath: string | null): { ok: true; bundle: Bundle } | { ok: false; error: string } {
  if (!bundlePath) return { ok: false, error: "Fichiers du modèle non référencés : les détails de la méthode ne peuvent pas être affichés. Le modèle doit être réenregistré (procédure du guide d'exploitation)." };
  const file = resolveBundleFile(bundlePath);
  if (!file) return { ok: false, error: "Fichiers du modèle placés hors de l'application : ils ne sont pas lus. Le modèle doit être réenregistré (procédure du guide d'exploitation)." };
  try {
    const parsed = bundleSchema.safeParse(JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ file, "utf8")));
    return parsed.success ? { ok: true, bundle: parsed.data } : { ok: false, error: "Fichiers du modèle au format inattendu : les détails de la méthode ne peuvent pas être affichés. Le modèle doit être réenregistré (procédure du guide d'exploitation)." };
  } catch {
    return { ok: false, error: "Fichiers du modèle introuvables ou illisibles : les détails de la méthode ne peuvent pas être affichés. Le modèle doit être réenregistré (procédure du guide d'exploitation)." };
  }
}

// ---------- Lecture tolérante de metrics_json ----------

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.map(obj).filter((x): x is Record<string, unknown> => !!x) : []);
const first = (o: Record<string, unknown> | null, ...keys: string[]): number | null => {
  for (const k of keys) {
    const n = num(o?.[k]);
    if (n != null) return n;
  }
  return null;
};
// Intervalle [bas, haut] facultatif : absent (et non null) quand la mesure ne le fournit pas
const pair = (v: unknown): [number, number] | undefined => {
  if (!Array.isArray(v) || v.length !== 2) return undefined;
  const [a, b] = v.map(num);
  return a != null && b != null ? [a, b] : undefined;
};

export type FairnessRow = {
  group: string;
  n: number | null;
  baseRate: number | null;
  meanPred: number | null;
  oe: number | null;
  /** Intervalle de confiance à 95 % du rapport observé / prévu, s'il est fourni. */
  oeCi?: [number, number];
  selectionRate: number | null;
  tpr: number | null;
  fpr: number | null;
  masked: boolean;
};

export type ParsedMetrics = {
  horizonMonths: number | null;
  auc: number | null;
  aucCi: [number, number] | null;
  prAuc: number | null;
  brier: number | null;
  evalN: number | null;
  evalPositives: number | null;
  evalBaseRate: number | null;
  evalPeriod: string | null;
  calibration: {
    oe: number | null;
    oeCi?: [number, number];
    slope: number | null;
    slopeCi?: [number, number];
    byHorizon: { horizon: number; oe: number | null; slope: number | null; brier: number | null }[];
    bins: { predicted: number; observed: number; n: number | null }[];
  };
  lift: {
    kRate: number | null;
    liftAtK: number | null;
    liftCi?: [number, number];
    precisionAtK: number | null;
    recallAtK: number | null;
    curve: { topPct: number; lift: number | null; precision: number | null; recall?: number }[];
  };
  decisionCurve: { threshold: number; netBenefit: number | null; treatAll: number | null }[];
  fairness: { minGroupSize: number; dimensions: { key: string; label: string; rows: FairnessRow[] }[]; note: string | null };
  golden: { status: string; maxAbsDiff: number | null } | null;
  other: { key: string; value: string }[];
};

const FAIRNESS_LABELS: Record<string, string> = { sex: "Sexe", age_band: "Tranche d'âge", age: "Tranche d'âge" };
const KNOWN_KEYS = new Set([
  "horizon_months", "pr_auc", "average_precision", "auc", "auc_6m", "roc_auc", "auc_ci", "brier", "eval", "calibration", "lift", "lift_at_k",
  "precision_at_k", "recall_at_k", "k_rate", "decision_curve", "net_benefit", "fairness", "golden", "train_rows",
]);

export function parseMetrics(json: string | null): ParsedMetrics | null {
  if (!json) return null;
  let m: Record<string, unknown> | null;
  try {
    m = obj(JSON.parse(json));
  } catch {
    return null;
  }
  if (!m) return null;
  const evalBlock = obj(m.eval);
  const cal = obj(m.calibration);
  const liftBlock = obj(m.lift);
  const fair = obj(m.fairness);
  const golden = obj(m.golden);
  const ci = Array.isArray(m.auc_ci) && m.auc_ci.length === 2 ? m.auc_ci.map(num) : null;
  const minGroupSize = first(fair, "min_group_size") ?? 30;

  const dimensions = fair
    ? Object.entries(fair)
        .filter(([, v]) => Array.isArray(v))
        .map(([key, v]) => ({
          key,
          label: FAIRNESS_LABELS[key] ?? key,
          rows: arr(v).map((r) => {
            const n = first(r, "n");
            return {
              group: String(r.group ?? r.label ?? "?"),
              n,
              baseRate: first(r, "base_rate", "observed_rate"),
              meanPred: first(r, "mean_pred", "predicted_rate"),
              oe: first(r, "oe_ratio", "oe"),
              oeCi: pair(obj(r.ci)?.oe_ratio),
              selectionRate: first(r, "selection_rate"),
              tpr: first(r, "tpr_at_k", "tpr"),
              fpr: first(r, "fpr_at_k", "fpr"),
              masked: n != null && n < minGroupSize,
            };
          }),
        }))
    : [];

  return {
    horizonMonths: first(m, "horizon_months"),
    auc: first(m, "auc", "auc_6m", "roc_auc"),
    aucCi: ci && ci[0] != null && ci[1] != null ? [ci[0], ci[1]] : null,
    prAuc: first(m, "pr_auc", "average_precision"),
    brier: first(m, "brier"),
    evalN: first(evalBlock, "n"),
    evalPositives: first(evalBlock, "n_pos", "positives"),
    evalBaseRate: first(evalBlock, "base_rate"),
    evalPeriod: typeof evalBlock?.period === "string" ? evalBlock.period : null,
    calibration: {
      oe: first(cal, "oe_ratio", "oe", "observed_expected"),
      oeCi: pair(cal?.oe_ci),
      slope: first(cal, "slope"),
      slopeCi: pair(cal?.slope_ci),
      byHorizon: arr(cal?.by_horizon)
        .map((r) => ({ horizon: first(r, "horizon") ?? 0, oe: first(r, "oe_ratio", "oe"), slope: first(r, "slope"), brier: first(r, "brier") }))
        .filter((r) => r.horizon > 0),
      bins: arr(cal?.bins)
        .map((r) => ({ predicted: first(r, "p_mean", "predicted") ?? NaN, observed: first(r, "observed", "obs_rate") ?? NaN, n: first(r, "n") }))
        .filter((r) => Number.isFinite(r.predicted) && Number.isFinite(r.observed)),
    },
    lift: {
      kRate: first(liftBlock, "k_rate") ?? first(m, "k_rate"),
      liftAtK: first(liftBlock, "lift_at_k") ?? first(m, "lift_at_k") ?? num(m.lift),
      liftCi: pair(liftBlock?.lift_ci),
      precisionAtK: first(liftBlock, "precision_at_k") ?? first(m, "precision_at_k"),
      recallAtK: first(liftBlock, "recall_at_k") ?? first(m, "recall_at_k"),
      curve: arr(liftBlock?.curve)
        .map((r) => ({ topPct: first(r, "top_pct") ?? NaN, lift: first(r, "lift"), precision: first(r, "precision"), recall: first(r, "recall") ?? undefined }))
        .filter((r) => Number.isFinite(r.topPct)),
    },
    decisionCurve: arr(m.decision_curve ?? m.net_benefit)
      .map((r) => ({ threshold: first(r, "threshold") ?? NaN, netBenefit: first(r, "net_benefit"), treatAll: first(r, "treat_all") }))
      .filter((r) => Number.isFinite(r.threshold)),
    fairness: { minGroupSize, dimensions, note: typeof fair?.note === "string" ? fair.note : null },
    golden: golden ? { status: String(golden.status ?? "?"), maxAbsDiff: first(golden, "max_abs_diff") } : null,
    other: Object.entries(m)
      .filter(([k, v]) => !KNOWN_KEYS.has(k) && (typeof v === "number" || typeof v === "string" || typeof v === "boolean"))
      .map(([key, v]) => ({ key, value: String(v) })),
  };
}

// ---------- Transparence ----------

export type FeatureEffect = {
  name: string;
  label: string;
  unit: string | null;
  coef: number;
  effect: number;
  mean: number | null;
  std: number | null;
};

export type ChampionDTO = {
  version: string;
  kind: "B0" | "LOGREG" | "LGBM";
  fsv: string;
  createdAt: string;
  promotedAt: string | null;
  promotedBy: string | null;
  trainedAt: string | null;
  trainRows: number | null;
  dataHash: string | null;
  baseRate: number | null;
  bundleError: string | null;
  intercept: number | null;
  calibration: { method: string; a: number; b: number } | null;
  groups: { code: string; label: string; actionable: boolean; weight: number; features: FeatureEffect[] }[];
  rules: { feature: string; label: string; op: string; value: number; points: number }[] | null;
  metrics: ParsedMetrics | null;
};

export type ModelVersionRow = {
  id: number;
  version: string;
  kind: string;
  status: "CANDIDAT" | "CHAMPION" | "RETIRE";
  fsv: string;
  createdAt: string;
  promotedAt: string | null;
  promotedBy: string | null;
  auc: number | null;
  liftAtK: number | null;
};

// Démarrage à froid (settings min_events_for_model / indicative_until_events) : active = le champion probabiliste
// est écarté au profit de B0 ; indicative = probabilité affichée mais à présenter comme indicative. message = texte prêt à
// afficher (null si rien à signaler). publishedRun = modèle réellement utilisé par le calcul publié.
export type ColdStartDTO = ColdStartState & { champion: string | null };

export type TransparencyDTO = {
  champion: ChampionDTO | null;
  versions: ModelVersionRow[];
  decision: { capacityRate: number; mediumLift: number };
  contractFsv: string;
  coldStart: ColdStartDTO | null;
  publishedRun: { id: number; asOf: string; modelVersion: string; kind: string } | null;
};

const featureLabel = (name: string) => {
  const f = CONTRACT.features.find((x) => x.name === name);
  return f ? f.label.replace("{pct}", "x %").replace("{v}", "x") : name;
};

type ModelRow = {
  id: number;
  version: string;
  kind: "B0" | "LOGREG" | "LGBM";
  status: ModelVersionRow["status"];
  fsv: string;
  bundle_path: string | null;
  manifest_json: string | null;
  metrics_json: string | null;
  created_at: string;
  promoted_at: string | null;
  promoted_by_login: string | null;
};

function buildChampion(row: ModelRow): ChampionDTO {
  const b = readBundle(row.bundle_path);
  const bundle = b.ok ? b.bundle : null;
  let manifest: Record<string, unknown> | null = null;
  try {
    manifest = row.manifest_json ? obj(JSON.parse(row.manifest_json)) : null;
  } catch {
    manifest = null;
  }
  const metrics = parseMetrics(row.metrics_json ?? (bundle?.metrics ? JSON.stringify(bundle.metrics) : null));
  const a = bundle?.calibration?.a ?? 1;

  const groups: ChampionDTO["groups"] = [];
  if (bundle?.features && bundle.coef && bundle.features.length === bundle.coef.length) {
    for (const [code, g] of Object.entries(CONTRACT.groups)) {
      const features = bundle.features
        .map((name, j) => ({ name, j }))
        .filter(({ name }) => (CONTRACT.features.find((f) => f.name === name)?.group ?? "AUTRE") === code)
        .map(({ name, j }) => ({
          name,
          label: featureLabel(name),
          unit: CONTRACT.features.find((f) => f.name === name)?.unit ?? null,
          coef: bundle.coef![j],
          effect: a * bundle.coef![j],
          mean: bundle.standardization?.mean[j] ?? null,
          std: bundle.standardization?.std[j] ?? null,
        }))
        .sort((x, y) => Math.abs(y.effect) - Math.abs(x.effect));
      if (features.length)
        groups.push({ code, label: g.label_rh, actionable: g.actionable, weight: features.reduce((s, f) => s + Math.abs(f.effect), 0), features });
    }
    groups.sort((x, y) => y.weight - x.weight);
  }

  const rules =
    row.kind === "B0"
      ? (bundle?.rules ?? CONTRACT.b0_rules).map((r) => ({ ...r, label: featureLabel(r.feature) }))
      : null;

  return {
    version: row.version,
    kind: row.kind,
    fsv: row.fsv,
    createdAt: row.created_at,
    promotedAt: row.promoted_at,
    promotedBy: row.promoted_by_login,
    trainedAt: bundle?.trained_at ?? (typeof manifest?.trained_at === "string" ? manifest.trained_at : null),
    trainRows: bundle?.train_rows ?? num(manifest?.train_rows) ?? null,
    dataHash: bundle?.data_hash ?? (typeof manifest?.data_hash === "string" ? manifest.data_hash : null),
    baseRate: bundle?.base_rate ?? null,
    bundleError: row.kind === "B0" && !row.bundle_path ? null : b.ok ? null : b.error,
    intercept: bundle?.intercept ?? null,
    calibration: bundle?.calibration ?? null,
    groups,
    rules,
    metrics,
  };
}

const MODEL_SELECT = `
  SELECT m.id, m.version, m.kind, m.status, m.fsv, m.bundle_path, m.manifest_json, m.metrics_json,
         m.created_at, m.promoted_at, u.login AS promoted_by_login
  FROM model_version m LEFT JOIN app_user u ON u.id = m.promoted_by`;

export function getTransparency(ctx: AccessContext): TransparencyDTO {
  ensureRole(ctx, ["ADMIN", "RH"], "model.view");
  const { sqlite } = getDb();
  const rows = sqlite.prepare(`${MODEL_SELECT} ORDER BY m.created_at DESC, m.id DESC`).all() as ModelRow[];
  const champion = rows.find((r) => r.status === "CHAMPION");
  return {
    champion: champion ? buildChampion(champion) : null,
    versions: rows.map((r) => {
      const pm = parseMetrics(r.metrics_json);
      return {
        id: r.id,
        version: r.version,
        kind: r.kind,
        status: r.status,
        fsv: r.fsv,
        createdAt: r.created_at,
        promotedAt: r.promoted_at,
        promotedBy: r.promoted_by_login,
        auc: pm?.auc ?? null,
        liftAtK: pm?.lift.liftAtK ?? null,
      };
    }),
    decision: { capacityRate: Number(getSetting(sqlite, "capacity_rate")), mediumLift: Number(getSetting(sqlite, "medium_lift")) },
    contractFsv: CONTRACT.fsv,
    coldStart: coldStartOf(sqlite, champion ?? null),
    publishedRun: publishedRun(sqlite),
  };
}

type Sqlite = ReturnType<typeof getDb>["sqlite"];

// Évalué à la date du calcul publié (sinon fin des données) ; sans champion ni date : null.
function coldStartOf(sqlite: Sqlite, champion: ModelRow | null): ColdStartDTO | null {
  if (!champion) return null;
  const asOf = currentPublishedAsOf(sqlite) ?? dataEndDate(sqlite);
  if (!asOf) return null;
  return { ...coldStartState(sqlite, asOf, champion.kind, champion.fsv), champion: champion.version };
}

function publishedRun(sqlite: Sqlite): TransparencyDTO["publishedRun"] {
  const id = Number(getSetting(sqlite, "current_run_id"));
  if (!Number.isInteger(id) || id <= 0) return null;
  const r = sqlite
    .prepare(
      `SELECT r.id, r.as_of AS asOf, m.version AS modelVersion, m.kind FROM scoring_run r JOIN model_version m ON m.id = r.model_version_id
       WHERE r.id = ? AND r.status = 'PUBLIE'`,
    )
    .get(id) as NonNullable<TransparencyDTO["publishedRun"]> | undefined;
  return r ?? null;
}

// État du champion pour /api/health : aucun détail du modèle.
export function championStatus(): { loaded: boolean; kind: string | null } {
  const row = getDb().sqlite.prepare("SELECT kind, bundle_path FROM model_version WHERE status = 'CHAMPION'").get() as
    | { kind: string; bundle_path: string | null }
    | undefined;
  if (!row) return { loaded: false, kind: null };
  if (row.kind === "B0" && !row.bundle_path) return { loaded: true, kind: row.kind };
  return { loaded: readBundle(row.bundle_path).ok, kind: row.kind };
}
