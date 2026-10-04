import { describe, expect, it } from "vitest";
import { assignProfile, checkTypologyGolden, distances, isSensitiveText, parseTypologyBundle, prepare, rawFromSnapshot } from "@/lib/ai/typology/model";
import { FEATURE_INDEX } from "@/lib/features/spec";
import { snapshot, syntheticBundle, tenureFor } from "./helpers";

const b = parseTypologyBundle(syntheticBundle());

describe("profils de départs : exécution du bundle (calcul à la main)", () => {
  it("transformation log1p, bornes, standardisation, distances au carré, profil le plus proche", () => {
    const z = prepare(b, [tenureFor(2), 10]);
    expect(z[0]).toBeCloseTo(-1, 12);
    expect(z[1]).toBe(0);
    const d = distances(b, [tenureFor(2), 10]);
    expect(d[0]).toBeCloseTo(0, 12);
    expect(d[1]).toBeCloseTo(4, 12);
    expect(d[2]).toBeCloseTo(5, 12);
    expect(assignProfile(b, [tenureFor(2), 10]).profileId).toBe(1);
    expect(assignProfile(b, [tenureFor(4), 20]).profileId).toBe(3);
    expect(assignProfile(b, [tenureFor(4), 10]).profileId).toBe(2);
  });

  it("valeurs hors bornes ramenées aux bornes ; valeur négative traitée comme 0 avant log1p", () => {
    expect(prepare(b, [-5, 100])).toEqual([-3, 6]);
    expect(prepare(b, [1e9, -3])).toEqual([7, -2]);
  });

  it("transformation racine carrée (taux d'absence), négatif traité comme 0", () => {
    const s = parseTypologyBundle(syntheticBundle({ transform: ["log1p", "sqrt"], clip: [[0, 10], [0, 1]], standardization: { mean: [3, 0.1], std: [1, 0.1] } }));
    expect(prepare(s, [tenureFor(3), 0.04])[1]).toBeCloseTo(1, 12);
    expect(prepare(s, [tenureFor(3), -1])[1]).toBeCloseTo(-1, 12);
  });

  it("à égalité de distance, le premier profil (même règle que Python)", () => {
    const tie = parseTypologyBundle(syntheticBundle({ centers: [[0, 1], [0, -1], [5, 5]] }));
    expect(assignProfile(tie, [tenureFor(3), 10]).profileId).toBe(1);
  });

  it("valeurs du modèle prises dans un vecteur feature_snapshot complet", () => {
    const v = snapshot({ tenure_months: 12, overtime_h_avg_3m: 7.5 });
    expect(rawFromSnapshot(b, v)).toEqual([12, 7.5]);
    expect(b.feature_index).toEqual([FEATURE_INDEX.tenure_months, FEATURE_INDEX.overtime_h_avg_3m]);
  });

  it("golden : distances à 1e-9 près, écart signalé au-delà", () => {
    const rows = [[tenureFor(2), 10], [tenureFor(4), 20], [3, 0]].map((x) => ({ x, d: distances(b, x), profile: assignProfile(b, x).profileId }));
    expect(checkTypologyGolden(b, { version: b.version, rows }).maxDiff).toBe(0);
    const shifted = rows.map((r) => ({ ...r, d: r.d.map((v) => v + 1e-6) }));
    expect(() => checkTypologyGolden(b, { version: b.version, rows: shifted })).toThrow(/Parité rompue/);
    const wrong = rows.map((r, i) => (i === 0 ? { ...r, profile: 2 } : r));
    expect(() => checkTypologyGolden(b, { version: b.version, rows: wrong })).toThrow(/profil/);
  });
});

describe("profils de départs : contrôles du bundle", () => {
  it("refuse des dimensions incohérentes, un centre manquant, une version de variables différente", () => {
    expect(() => parseTypologyBundle(syntheticBundle({ clip: [[0, 10]] }))).toThrow(/dimensions/);
    expect(() => parseTypologyBundle(syntheticBundle({ centers: [[0, 0], [1, 1]] }))).toThrow(/un centre par profil/);
    expect(() => parseTypologyBundle(syntheticBundle({ fsv: "v0" }))).toThrow(/contrat courant/);
    expect(() => parseTypologyBundle(syntheticBundle({ feature_index: [0, 0] }))).toThrow(/position/);
  });

  it("refuse une variable non admise : présence fine (retards, Bradford) ou attribut absent du contrat", () => {
    for (const f of ["late_count_3m", "bradford_12m", "no_badge_days_3m", "short_episodes_12m", "sex", "age", "governorate"])
      expect(() => parseTypologyBundle(syntheticBundle({ features: [f, "overtime_h_avg_3m"], feature_index: [FEATURE_INDEX[f] ?? 99, FEATURE_INDEX.overtime_h_avg_3m] }))).toThrow();
  });

  it("garde de taille minimale : un profil sous min_profile_size est refusé", () => {
    const raw = syntheticBundle();
    raw.profiles[2].size = 19;
    expect(() => parseTypologyBundle(raw)).toThrow(/taille minimale/);
  });

  it("refuse un libellé ou un trait qui cite un attribut sensible ; « hors santé » reste admis", () => {
    const label = syntheticBundle();
    label.profiles[0].label = "Jeunes femmes";
    expect(() => parseTypologyBundle(label)).toThrow(/sensible/);
    const t = syntheticBundle();
    t.profiles[1].traits[0] = { feature: "tenure_months", direction: "HAUSSE", effect: 1, text: "Surtout des salariés mariés avec enfants" };
    expect(() => parseTypologyBundle(t)).toThrow(/sensible/);
    const f = syntheticBundle();
    f.profiles[1].traits[0] = { feature: "governorate:Tunis", direction: "HAUSSE", effect: 1, text: "Surtout Tunis" };
    expect(() => parseTypologyBundle(f)).toThrow(/trait non admis/);
    expect(isSensitiveText("Taux d'absence hors santé de 2 %")).toBe(false);
    for (const s of ["Arrêts maladie fréquents", "Congé de maternité", "Âge moyen élevé", "l'âge médian", "Gouvernorat de Sfax", "SEXE"]) expect(isSensitiveText(s)).toBe(true);
    for (const s of ["Arrivées récentes, peu ou pas augmentés", "Heures supplémentaires élevées", "dans la famille Production", "Anciens managers"]) expect(isSensitiveText(s)).toBe(false);
  });
});
