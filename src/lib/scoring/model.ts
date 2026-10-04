import { z } from "zod";
import { FEATURE_INDEX, FEATURES, FSV, GROUP_CODES, GROUPS, featureSpec, type B0Rule } from "../features/spec";

const ruleSchema = z.object({
  feature: z.string(),
  op: z.enum(["<", "<=", ">", ">=", "=="]),
  value: z.number(),
  points: z.number(),
});

export const logregBundleSchema = z.object({
  version: z.string().min(1),
  kind: z.literal("LOGREG"),
  fsv: z.string(),
  features: z.array(z.string()).min(1),
  standardization: z.object({ mean: z.array(z.number()), std: z.array(z.number()) }),
  coef: z.array(z.number()),
  intercept: z.number(),
  calibration: z.object({ method: z.string(), a: z.number(), b: z.number() }).optional(),
  base_rate: z.number().optional(),
  trained_at: z.string().nullable().optional(),
  // période d'entraînement (lue par les écrans Vérification a posteriori et Dérive) : conservée dans le manifeste enregistré
  train_from: z.string().nullable().optional(),
  train_to: z.string().nullable().optional(),
  data_hash: z.string().optional(),
  train_rows: z.number().optional(),
  metrics: z.record(z.string(), z.unknown()).optional(),
});

export const b0BundleSchema = z.object({
  version: z.string().min(1),
  kind: z.literal("B0"),
  fsv: z.string(),
  features: z.array(z.string()).optional(),
  rules: z.array(ruleSchema).min(1),
  trained_at: z.string().nullable().optional(),
  train_from: z.string().nullable().optional(),
  train_to: z.string().nullable().optional(),
  metrics: z.record(z.string(), z.unknown()).optional(),
});

export const bundleSchema = z.discriminatedUnion("kind", [logregBundleSchema, b0BundleSchema]);
export const goldenSchema = z.array(z.object({ x: z.array(z.number()), p: z.number() }));

export type LogregBundle = z.infer<typeof logregBundleSchema>;
export type B0Bundle = z.infer<typeof b0BundleSchema>;
export type ModelBundle = z.infer<typeof bundleSchema>;
export type GoldenRow = z.infer<typeof goldenSchema>[number];

export type LoadedModel = {
  id: number | null;
  version: string;
  kind: "B0" | "LOGREG";
  fsv: string;
  bundle: ModelBundle;
  // position dans le snapshot (ordre features.json) de chaque variable du bundle
  idx: number[];
};

export type FactorDetail = { feature: string; value: number; contribution: number };
export type GroupContribution = {
  group: string;
  contribution: number;
  direction: "HAUSSE" | "BAISSE";
  topFeature: string | null;
  topFeatureValue: number | null;
  phraseRh: string;
  phraseManager: string;
  features: FactorDetail[];
  rules?: B0Rule[];
};

export const GOLDEN_TOLERANCE = 1e-9;

export function parseBundle(json: unknown): ModelBundle {
  const r = bundleSchema.safeParse(json);
  if (!r.success) throw new Error(`Bundle invalide : ${r.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join(" ; ")}`);
  return r.data;
}

export function bundleFeatures(b: ModelBundle): string[] {
  return b.kind === "LOGREG" ? b.features : (b.features ?? [...new Set(b.rules.map((r) => r.feature))]);
}

// Contrôles structurels : fsv, variables connues, dimensions.
export function checkBundle(b: ModelBundle): string[] {
  const errors: string[] = [];
  if (b.fsv !== FSV) errors.push(`fsv du modèle (${b.fsv}) différente de la fsv courante (${FSV})`);
  for (const f of bundleFeatures(b)) if (FEATURE_INDEX[f] === undefined) errors.push(`variable inconnue : ${f}`);
  if (b.kind === "B0") {
    const names = bundleFeatures(b);
    for (const r of b.rules) if (!names.includes(r.feature)) errors.push(`règle sur une variable absente du bundle : ${r.feature}`);
  } else {
    const n = b.features.length;
    if (b.coef.length !== n || b.standardization.mean.length !== n || b.standardization.std.length !== n)
      errors.push("dimensions incohérentes (features, coef, mean, std)");
  }
  return errors;
}

export function toLoadedModel(b: ModelBundle, id: number | null): LoadedModel {
  const errors = checkBundle(b);
  if (errors.length) throw new Error(errors.join(" ; "));
  return { id, version: b.version, kind: b.kind, fsv: b.fsv, bundle: b, idx: bundleFeatures(b).map((f) => FEATURE_INDEX[f]) };
}

function sigmoid(s: number): number {
  if (s >= 0) return 1 / (1 + Math.exp(-s));
  const e = Math.exp(s);
  return e / (1 + e);
}

function zScores(b: LogregBundle, x: number[]): number[] {
  return x.map((v, j) => {
    const sd = b.standardization.std[j];
    return (v - b.standardization.mean[j]) / (sd === 0 ? 1 : sd);
  });
}

function calib(b: LogregBundle) {
  return { a: b.calibration?.a ?? 1, b: b.calibration?.b ?? 0 };
}

function ruleFires(r: B0Rule, v: number): boolean {
  switch (r.op) {
    case "<":
      return v < r.value;
    case "<=":
      return v <= r.value;
    case ">":
      return v > r.value;
    case ">=":
      return v >= r.value;
    case "==":
      return v === r.value;
  }
}

// x dans l'ordre des variables du bundle
export function predictRaw(m: LoadedModel, x: number[]): number {
  const b = m.bundle;
  if (b.kind === "B0") {
    const names = bundleFeatures(b);
    return b.rules.reduce((s, r) => (ruleFires(r, x[names.indexOf(r.feature)]) ? s + r.points : s), 0);
  }
  const z = zScores(b, x);
  let logit = b.intercept;
  for (let j = 0; j < z.length; j++) logit += b.coef[j] * z[j];
  const c = calib(b);
  return sigmoid(c.a * logit + c.b);
}

export function toModelOrder(m: LoadedModel, snapshotValues: number[]): number[] {
  return m.idx.map((i) => snapshotValues[i]);
}

// values dans l'ordre du snapshot (features.json). LOGREG : probabilité ; B0 : points.
export function predict(m: LoadedModel, values: number[]): number {
  return predictRaw(m, toModelOrder(m, values));
}

export function calibratedLogit(m: LoadedModel, values: number[]): number {
  const b = m.bundle;
  if (b.kind !== "LOGREG") throw new Error("logit indisponible pour un score à règles");
  const z = zScores(b, toModelOrder(m, values));
  const c = calib(b);
  return c.a * z.reduce((s, zj, j) => s + b.coef[j] * zj, b.intercept) + c.b;
}

export function meanProfileLogit(m: LoadedModel): number {
  const b = m.bundle;
  if (b.kind !== "LOGREG") throw new Error("logit indisponible pour un score à règles");
  const c = calib(b);
  return c.a * b.intercept + c.b;
}

export function goldenMaxDiff(m: LoadedModel, golden: GoldenRow[]): number {
  const nModel = m.idx.length;
  let max = 0;
  for (const row of golden) {
    const x = row.x.length === nModel ? row.x : row.x.length === FEATURES.length ? toModelOrder(m, row.x) : null;
    if (!x) return Infinity;
    const d = Math.abs(predictRaw(m, x) - row.p);
    if (!Number.isFinite(d)) return Infinity;
    if (d > max) max = d;
  }
  return max;
}

function fmtNum(v: number, signed = false): string {
  const r = Math.abs(v) >= 10 ? Math.round(v) : Math.round(v * 10) / 10;
  const s = String(r + 0).replace(".", ",");
  return signed && r > 0 ? `+${s}` : s;
}

function fmtPct(v: number): string {
  const p = v * 100;
  const r = Math.abs(p) >= 10 ? Math.round(p) : Math.round(p * 10) / 10;
  return `${String(r + 0).replace(".", ",")} %`;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function featurePhrase(name: string, value: number): string {
  const spec = featureSpec(name);
  if (spec.unit === "0/1" && value === 0) {
    return capitalize(spec.label.startsWith("aucune ") ? spec.label.slice(7) : `pas de ${spec.label}`);
  }
  const signed = /_(delta|trend)/.test(name);
  return capitalize(spec.label.replace("{v}", fmtNum(value, signed)).replace("{pct}", fmtPct(value)));
}

export function managerPhrase(group: string): string {
  return GROUPS[group]?.label_manager ?? group;
}

// Contributions exactes au logit calibré (a * coef_j * z_j) agrégées par groupe ; B0 : règles déclenchées.
export function explain(m: LoadedModel, values: number[]): GroupContribution[] {
  const b = m.bundle;
  const names = bundleFeatures(b);
  const x = toModelOrder(m, values);
  const byGroup = new Map<string, FactorDetail[]>();
  const rulesByGroup = new Map<string, B0Rule[]>();

  if (b.kind === "LOGREG") {
    const z = zScores(b, x);
    const { a } = calib(b);
    names.forEach((f, j) => {
      const g = featureSpec(f).group;
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g)!.push({ feature: f, value: x[j], contribution: a * b.coef[j] * z[j] });
    });
  } else {
    for (const r of b.rules) {
      const v = x[names.indexOf(r.feature)];
      if (!ruleFires(r, v)) continue;
      const g = featureSpec(r.feature).group;
      if (!byGroup.has(g)) byGroup.set(g, []);
      if (!rulesByGroup.has(g)) rulesByGroup.set(g, []);
      const list = byGroup.get(g)!;
      const existing = list.find((d) => d.feature === r.feature);
      if (existing) existing.contribution += r.points;
      else list.push({ feature: r.feature, value: v, contribution: r.points });
      rulesByGroup.get(g)!.push(r);
    }
  }

  const out: GroupContribution[] = [];
  for (const [group, feats] of byGroup) {
    const contribution = feats.reduce((s, f) => s + f.contribution, 0);
    const sign = contribution > 0 ? 1 : -1;
    let top: FactorDetail | null = null;
    for (const f of feats) if (f.contribution * sign > 0 && (!top || f.contribution * sign > top.contribution * sign)) top = f;
    out.push({
      group,
      contribution,
      direction: contribution > 0 ? "HAUSSE" : "BAISSE",
      topFeature: top?.feature ?? null,
      topFeatureValue: top?.value ?? null,
      phraseRh: top ? featurePhrase(top.feature, top.value) : (GROUPS[group]?.label_rh ?? group),
      phraseManager: managerPhrase(group),
      features: feats,
      ...(b.kind === "B0" ? { rules: rulesByGroup.get(group) ?? [] } : {}),
    });
  }
  return out.sort((p, q) => Math.abs(q.contribution) - Math.abs(p.contribution) || GROUP_CODES.indexOf(p.group) - GROUP_CODES.indexOf(q.group));
}
