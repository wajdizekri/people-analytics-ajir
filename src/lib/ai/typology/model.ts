import { z } from "zod";
import { FEATURE_INDEX, FSV } from "@/lib/features/spec";

// Profils types de départs : k-moyennes entraînées hors ligne (ml/typology/run.py), exécutées ici pour rattacher un départ
// au profil le plus proche, uniquement pour compter (aucun salarié n'est étiqueté à l'écran).

// Variables professionnelles admises. Exclus par construction : attributs sensibles (sexe, âge, situation familiale,
// gouvernorat, santé : ADR-009) et variables de présence fine (retards, jours sans badge, absences courtes, Bradford),
// pour que rien ne ressemble à une détection d'abus.
export const TYPOLOGY_ALLOWED_FEATURES = [
  "tenure_months",
  "contract_cdd",
  "grade_level",
  "months_since_promotion",
  "job_change_12m",
  "compa_ratio",
  "raise_pct_12m",
  "months_since_raise",
  "overtime_h_avg_3m",
  "absence_rate_12m",
  "training_hours_12m",
] as const;
const ALLOWED = new Set<string>(TYPOLOGY_ALLOWED_FEATURES);
export const FAMILY_TRAIT_PREFIX = "job_family:";

// Mot sensible dans un libellé ou un trait (« hors santé » est la mention d'exclusion, admise)
const SENSITIVE = /(?<!\p{L})(sexe|femmes?|hommes?|âge|gouvernorats?|mari[ée]e?s?|célibataires?|enfants?|santé|maladies?|maternité|grossesse|handicap)(?!\p{L})/iu;
export const isSensitiveText = (text: string) => SENSITIVE.test(text.replace(/hors santé/giu, ""));

const traitSchema = z.object({
  feature: z.string().min(1),
  direction: z.enum(["HAUSSE", "BAISSE", "PROCHE"]),
  effect: z.number(),
  text: z.string().min(1),
});
const profileSchema = z.object({
  id: z.number().int().positive(),
  label: z.string().min(1),
  traits: z.array(traitSchema).min(1).max(4),
  size: z.number().int().nonnegative(),
  share: z.number().min(0).max(1),
  median_tenure_months: z.number().nullable(),
  stability: z.number().nullable(),
});

export const typologyBundleSchema = z.object({
  version: z.string().min(1),
  kind: z.literal("KMEANS"),
  topic: z.literal("TYPOLOGIE_DEPARTS"),
  fsv: z.string().min(1),
  population: z.string().optional(),
  features: z.array(z.string()).min(1),
  feature_index: z.array(z.number().int().nonnegative()),
  transform: z.array(z.enum(["none", "log1p", "sqrt"])),
  clip: z.array(z.tuple([z.number(), z.number()])),
  standardization: z.object({ mean: z.array(z.number()), std: z.array(z.number()) }),
  centers: z.array(z.array(z.number())).min(2),
  profiles: z.array(profileSchema).min(2),
  k: z.number().int().optional(),
  min_profile_size: z.number().int().positive(),
  trained_at: z.string().optional(),
  reference_date: z.string().optional(),
  train_rows: z.number().int().optional(),
  train_from: z.string().nullable().optional(),
  train_to: z.string().nullable().optional(),
  selection: z.record(z.string(), z.unknown()).optional(),
  metrics: z.record(z.string(), z.unknown()).optional(),
  data_hash: z.string().optional(),
});
export type TypologyBundle = z.infer<typeof typologyBundleSchema>;
export type TypologyProfile = TypologyBundle["profiles"][number];

export const typologyGoldenSchema = z.object({
  version: z.string(),
  rows: z.array(z.object({ x: z.array(z.number()), d: z.array(z.number()), profile: z.number().int() })),
  selection: z
    .object({
      reference_date: z.string(),
      fsv: z.string(),
      rows: z.array(z.tuple([z.number().int(), z.string()])),
      sizes: z.record(z.string(), z.number().int()),
    })
    .optional(),
});
export type TypologyGolden = z.infer<typeof typologyGoldenSchema>;
export const TYPOLOGY_GOLDEN_TOLERANCE = 1e-9;

export function parseTypologyBundle(json: unknown): TypologyBundle {
  const r = typologyBundleSchema.safeParse(json);
  if (!r.success) throw new Error(`Bundle de profils de départs invalide : ${r.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join(" ; ")}`);
  const b = r.data;
  const n = b.features.length;
  const dims = [b.feature_index.length, b.transform.length, b.clip.length, b.standardization.mean.length, b.standardization.std.length, ...b.centers.map((c) => c.length)];
  if (dims.some((d) => d !== n)) throw new Error("Bundle de profils de départs invalide : dimensions incohérentes.");
  if (b.centers.length !== b.profiles.length) throw new Error("Bundle de profils de départs invalide : un centre par profil attendu.");
  if (new Set(b.profiles.map((p) => p.id)).size !== b.profiles.length) throw new Error("Bundle de profils de départs invalide : identifiants de profil en double.");
  if (b.fsv !== FSV) throw new Error(`Bundle de profils de départs : variables ${b.fsv}, contrat courant ${FSV}.`);
  b.features.forEach((name, j) => {
    if (!ALLOWED.has(name)) throw new Error(`Bundle de profils de départs : variable non admise (${name}).`);
    if (FEATURE_INDEX[name] !== b.feature_index[j]) throw new Error(`Bundle de profils de départs : position de ${name} différente de shared/features.json.`);
  });
  for (const p of b.profiles) {
    if (p.size < b.min_profile_size) throw new Error(`Bundle de profils de départs : profil ${p.id} sous la taille minimale (${p.size} < ${b.min_profile_size}).`);
    if (isSensitiveText(p.label)) throw new Error(`Bundle de profils de départs : libellé du profil ${p.id} sensible.`);
    for (const t of p.traits) {
      if (!ALLOWED.has(t.feature) && !t.feature.startsWith(FAMILY_TRAIT_PREFIX)) throw new Error(`Bundle de profils de départs : trait non admis (${t.feature}).`);
      if (isSensitiveText(t.text)) throw new Error(`Bundle de profils de départs : trait sensible dans le profil ${p.id}.`);
    }
  }
  return b;
}

// Valeurs du modèle prises dans un vecteur de feature_snapshot (ordre de shared/features.json)
export function rawFromSnapshot(b: TypologyBundle, values: number[]): number[] {
  return b.feature_index.map((i) => values[i]);
}

// Même suite d'opérations que bundle_prepare / bundle_distances / bundle_assign (ml/typology/cluster.py)
export function prepare(b: TypologyBundle, raw: number[]): number[] {
  const z: number[] = [];
  for (let j = 0; j < raw.length; j++) {
    let x = raw[j];
    if (b.transform[j] === "log1p") x = Math.log1p(Math.max(x, 0));
    else if (b.transform[j] === "sqrt") x = Math.sqrt(Math.max(x, 0));
    const [lo, hi] = b.clip[j];
    x = Math.min(Math.max(x, lo), hi);
    const s = b.standardization.std[j];
    z.push((x - b.standardization.mean[j]) / (s === 0 ? 1 : s));
  }
  return z;
}

export function distances(b: TypologyBundle, raw: number[]): number[] {
  const z = prepare(b, raw);
  return b.centers.map((c) => {
    let d = 0;
    for (let j = 0; j < z.length; j++) {
      const diff = z[j] - c[j];
      d += diff * diff;
    }
    return d;
  });
}

// Profil le plus proche (à égalité, le premier : même règle que Python)
export function assignProfile(b: TypologyBundle, raw: number[]): { profileId: number; distances: number[] } {
  const d = distances(b, raw);
  let best = 0;
  for (let i = 1; i < d.length; i++) if (d[i] < d[best]) best = i;
  return { profileId: b.profiles[best].id, distances: d };
}

// Distances à 1e-9 près ; profil identique sauf quasi-égalité de deux distances (écart sous la tolérance)
export function checkTypologyGolden(b: TypologyBundle, golden: unknown): { rows: number; maxDiff: number } {
  const g = typologyGoldenSchema.parse(golden);
  let maxDiff = 0;
  let mismatches = 0;
  for (const r of g.rows) {
    const { profileId, distances: d } = assignProfile(b, r.x);
    if (d.length !== r.d.length) throw new Error(`Golden incohérent avec le bundle ${b.version} : ${r.d.length} distances pour ${d.length} profils.`);
    for (let i = 0; i < d.length; i++) maxDiff = Math.max(maxDiff, Math.abs(d[i] - r.d[i]));
    if (profileId !== r.profile) {
      const sorted = [...r.d].sort((a, c) => a - c);
      if (sorted[1] - sorted[0] > TYPOLOGY_GOLDEN_TOLERANCE) mismatches++;
    }
  }
  if (maxDiff > TYPOLOGY_GOLDEN_TOLERANCE || mismatches > 0) throw new Error(`Parité rompue avec le bundle ${b.version} : écart ${maxDiff}, ${mismatches} profil(s) différent(s).`);
  return { rows: g.rows.length, maxDiff };
}
