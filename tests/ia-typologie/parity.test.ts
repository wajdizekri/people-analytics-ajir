import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { aggregateProfiles } from "@/lib/ai/typology/aggregate";
import { TYPOLOGY_VERSION, loadTypologyModel, typologyBundleDir } from "@/lib/ai/typology/bundle";
import { DEPARTURES_SQL, departureRows } from "@/lib/ai/typology/departures";
import { FAMILY_TRAIT_PREFIX, TYPOLOGY_ALLOWED_FEATURES, assignProfile, checkTypologyGolden, isSensitiveText, parseTypologyBundle, typologyGoldenSchema } from "@/lib/ai/typology/model";
import { excludeOpposed } from "@/lib/privacy/opposition";

// Bundle produit par `python -m ml.typology.run --db data/app.db --bundle` (phase B du chantier)
const DIR = typologyBundleDir(TYPOLOGY_VERSION);
const readJson = (f: string) => JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
const rawModel = readJson("model.json");
const bundle = parseTypologyBundle(rawModel);
const golden = typologyGoldenSchema.parse(readJson("golden.json"));

describe("bundle des profils de départs : parité Python / TypeScript", () => {
  it("golden : distances reproduites à 1e-9 près, même profil sur toutes les lignes", () => {
    expect(golden.version).toBe(TYPOLOGY_VERSION);
    expect(golden.rows.length).toBeGreaterThanOrEqual(100);
    expect(checkTypologyGolden(bundle, golden).maxDiff).toBeLessThan(1e-9);
    for (const r of golden.rows) expect(assignProfile(bundle, r.x).profileId).toBe(r.profile);
  });

  it("chargé par la version fixée, golden rejoué au chargement", () => {
    const m = loadTypologyModel();
    expect(m.status).toBe("OK");
    if (m.status === "OK") {
      expect(m.bundle.version).toBe(TYPOLOGY_VERSION);
      expect(m.goldenRows).toBe(golden.rows.length);
    }
  });

  it("3 à 6 profils, chacun au-dessus de la taille minimale ; effectifs et parts cohérents avec l'entraînement", () => {
    expect(bundle.profiles.length).toBeGreaterThanOrEqual(3);
    expect(bundle.profiles.length).toBeLessThanOrEqual(6);
    for (const p of bundle.profiles) {
      expect(p.size).toBeGreaterThanOrEqual(bundle.min_profile_size);
      expect(p.traits.length).toBeGreaterThanOrEqual(3);
      expect(p.traits.length).toBeLessThanOrEqual(4);
    }
    expect(bundle.min_profile_size).toBeGreaterThanOrEqual(20);
    expect(bundle.profiles.reduce((s, p) => s + p.size, 0)).toBe(bundle.train_rows);
    expect(bundle.profiles.reduce((s, p) => s + p.share, 0)).toBeCloseTo(1, 5);
    expect(new Set(bundle.profiles.map((p) => p.label)).size).toBe(bundle.profiles.length);
  });
});

describe("bundle des profils de départs : aucun attribut sensible", () => {
  it("variables du modèle : professionnelles seulement ; traits : variables du modèle ou famille de métier", () => {
    const allowed = new Set<string>(TYPOLOGY_ALLOWED_FEATURES);
    for (const f of bundle.features) expect(allowed.has(f), f).toBe(true);
    for (const p of bundle.profiles) for (const t of p.traits) expect(allowed.has(t.feature) || t.feature.startsWith(FAMILY_TRAIT_PREFIX), t.feature).toBe(true);
  });

  it("ni clé ni texte sensible dans model.json et golden.json (sexe, âge, situation familiale, gouvernorat, santé)", () => {
    const text = fs.readFileSync(path.join(DIR, "model.json"), "utf8");
    for (const k of ["sex", "birth", "age_band", "governorate", "marital", "is_health", "MALADIE", "MATERNITE", "matricule", "last_name", "first_name"])
      expect(text, k).not.toMatch(new RegExp(`\\b${k}\\b`, "i"));
    for (const p of bundle.profiles) {
      expect(isSensitiveText(p.label), p.label).toBe(false);
      for (const t of p.traits) expect(isSensitiveText(t.text), t.text).toBe(false);
    }
    const g = fs.readFileSync(path.join(DIR, "golden.json"), "utf8");
    for (const k of ["sex", "birth", "matricule", "governorate"]) expect(g, k).not.toContain(`"${k}`);
  });

  it("la requête des départs ne lit ni attribut sensible ni absence de santé", () => {
    for (const col of ["sex", "birth_date", "governorate", "marital_status", "is_health", "absence_episode", "last_name", "first_name"]) expect(DEPARTURES_SQL).not.toContain(col);
  });
});

// Chaîne complète sur la base d'entraînement (copie locale data/app.db) : même sélection et mêmes effectifs que Python.
const DB = path.resolve(__dirname, "../../data/app.db");
const sel = golden.selection;
const sameRef = (() => {
  if (!sel || !fs.existsSync(DB)) return false;
  const s = new Database(DB, { readonly: true, fileMustExist: true });
  try {
    return (s.prepare("SELECT value FROM app_setting WHERE key = 'data_end_date'").get() as { value: string } | undefined)?.value === sel.reference_date;
  } finally {
    s.close();
  }
})();

describe.skipIf(!sameRef)("profils de départs : parité de la sélection sur data/app.db", () => {
  it("mêmes départs classés (départ, coupure) et mêmes effectifs par profil que l'entraînement", () => {
    const s = new Database(DB, { readonly: true, fileMustExist: true });
    try {
      const rows = departureRows(s, sel!.reference_date, sel!.fsv);
      const classifiable = excludeOpposed(
        s,
        rows.filter((r) => r.valuesJson != null),
      );
      expect(classifiable.map((r) => [r.exitId, r.asOf])).toEqual(sel!.rows);
      const a = aggregateProfiles(bundle, rows.length, classifiable, 0);
      for (const p of a.profiles) expect(p.departures, `profil ${p.id}`).toBe(sel!.sizes[String(p.id)]);
      expect(a.unclassified).toBe(rawModel.metrics.unclassified);
    } finally {
      s.close();
    }
  });
});
