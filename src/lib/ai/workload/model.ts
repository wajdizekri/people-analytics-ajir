// Bundle models/workload/<version>/model.json (ml/workload/bundle.py) : ridge sur z = log(1 + heures sup par ETP),
// une par portée (EQUIPE, DEPARTEMENT) et horizon (1..3), intervalle conforme normalisé.

export type WorkloadScope = "EQUIPE" | "DEPARTEMENT";

export type RidgeModel = { alpha: number; q: number; mean: number[]; std: number[]; coef: number[]; intercept: number; train_rows: number };

export type WorkloadBundle = {
  version: string;
  kind: "RIDGE_LOG";
  topic: "CHARGE_TRAVAIL";
  features: string[];
  horizons: number[];
  group: { min_members: number; min_valid_months: number; fte_min: number; s_floor: number; std_month_days: number };
  interval: { level: number; s_default: Record<WorkloadScope, number> };
  models: Record<WorkloadScope, Record<string, RidgeModel>>;
  tension: { threshold_h: number };
  rule: { threshold_h: number; consecutive_months: number; priority_risk_levels: string[] };
  metrics?: unknown;
};

export type GroupForecast = { value: number; lower: number; upper: number };

// Même suite d'opérations que bundle_predict (ml/workload/model.py) : parité au golden à 1e-9.
export function predictGroup(bundle: WorkloadBundle, scope: WorkloadScope, h: number, x: number[], zbar12: number, s: number | null): GroupForecast {
  const m = bundle.models[scope][String(h)];
  if (!m) throw new Error(`Modèle ${scope} h=${h} absent du bundle ${bundle.version}`);
  if (x.length !== m.coef.length) throw new Error(`${x.length} variables, ${m.coef.length} attendues`);
  let y = m.intercept;
  for (let j = 0; j < x.length; j++) y += m.coef[j] * ((x[j] - m.mean[j]) / m.std[j]);
  const sc = s ?? bundle.interval.s_default[scope];
  const zc = zbar12 + y;
  return {
    value: Math.max(0, Math.expm1(zc)),
    lower: Math.max(0, Math.expm1(zc - m.q * sc)),
    upper: Math.max(0, Math.expm1(zc + m.q * sc)),
  };
}

export function validateBundle(b: WorkloadBundle): void {
  if (b.kind !== "RIDGE_LOG") throw new Error(`Bundle ${b.version} : kind ${b.kind} inattendu`);
  for (const scope of ["EQUIPE", "DEPARTEMENT"] as const)
    for (const h of b.horizons) {
      const m = b.models[scope]?.[String(h)];
      if (!m || m.coef.length !== b.features.length || m.mean.length !== b.features.length || m.std.length !== b.features.length)
        throw new Error(`Bundle ${b.version} : modèle ${scope} h=${h} incomplet`);
    }
}
