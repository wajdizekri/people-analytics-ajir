import { describe, expect, it } from "vitest";
import { aggregateProfiles } from "@/lib/ai/typology/aggregate";
import type { DepartureRow } from "@/lib/ai/typology/departures";
import { parseTypologyBundle } from "@/lib/ai/typology/model";
import { row, syntheticBundle, tenureFor } from "./helpers";

const b = parseTypologyBundle(syntheticBundle());
// Profil 1 : z = (-1, 0) ; profil 2 : (1, 0) ; profil 3 : (0, 2)
const young = (o: Partial<DepartureRow> = {}) => row({ tenure_months: tenureFor(2), overtime_h_avg_3m: 10 }, o);
const senior = (o: Partial<DepartureRow> = {}) => row({ tenure_months: tenureFor(4), overtime_h_avg_3m: 10 }, o);
const overtime = (o: Partial<DepartureRow> = {}) => row({ tenure_months: tenureFor(3), overtime_h_avg_3m: 20 }, o);
const times = <T,>(n: number, f: (i: number) => T) => Array.from({ length: n }, (_, i) => f(i));

describe("profils de départs : agrégats", () => {
  it("compte par profil, parts sur les départs classés, ancienneté médiane brute, non classés", () => {
    const rows = [...times(10, () => young()), ...times(6, () => senior()), ...times(8, () => overtime())];
    const a = aggregateProfiles(b, 30, rows);
    expect(a.classified).toBe(24);
    expect(a.unclassified).toBe(6);
    expect(a.profiles.map((p) => p.departures)).toEqual([10, 6, 8]);
    expect(a.profiles[0].share).toBeCloseTo(10 / 24, 12);
    expect(a.profiles[0].medianTenureMonths).toBeCloseTo(tenureFor(2), 9);
    expect(a.maskedProfiles).toBe(0);
    expect(a.profiles[0].traits[0].text).toContain("Ancienneté médiane");
  });

  it("garde de taille minimale : un profil de moins de 5 départs est masqué, avec masquage secondaire si le reste se déduit", () => {
    const a = aggregateProfiles(b, 20, [...times(12, () => young()), ...times(6, () => senior()), ...times(2, () => overtime())]);
    expect(a.profiles[2]).toMatchObject({ masked: true, departures: null, share: null, medianTenureMonths: null });
    // Pool masqué = 2 < 5 : le plus petit profil visible (6) est masqué à son tour, sinon 20 - 12 - 6 révélerait 2
    expect(a.profiles[1]).toMatchObject({ masked: true, departures: null });
    expect(a.profiles[0]).toMatchObject({ masked: false, departures: 12 });
    expect(a.maskedProfiles).toBe(2);
  });

  it("départements : détail seulement à partir de 5 départs classés, profil cité s'il réunit 5 départs", () => {
    const rows = [
      ...times(7, () => young({ departmentName: "Production" })),
      ...times(3, () => senior({ departmentName: "Production" })),
      ...times(6, () => overtime({ departmentName: "IT" })),
      ...times(3, () => young({ departmentName: "IT" })),
      ...times(4, () => senior({ departmentName: "Finance" })),
      ...times(3, () => senior({ departmentName: "Commercial" })),
      ...times(3, () => overtime({ departmentName: "Commercial" })),
    ];
    const a = aggregateProfiles(b, rows.length, rows);
    expect(a.departments.map((d) => d.department)).toEqual(["Production", "IT", "Commercial"]);
    expect(a.departments[0]).toMatchObject({ departures: 10, topProfileId: 1 });
    expect(a.departments[0].topShare).toBeCloseTo(0.7, 12);
    expect(a.departments[1]).toMatchObject({ departures: 9, topProfileId: 3 });
    expect(a.departments[2]).toMatchObject({ departures: 6, topProfileId: null, topShare: null });
    expect(a.otherDepartments).toBe(4);
  });

  it("aucun champ nominatif dans les agrégats", () => {
    const a = aggregateProfiles(b, 12, times(12, () => young()));
    const json = JSON.stringify(a);
    for (const k of ["employeeId", "exitId", "matricule", "lastName", "firstName", "valuesJson"]) expect(json).not.toContain(k);
  });

  it("refuse un vecteur de variables d'une autre longueur que shared/features.json", () => {
    const bad = { ...young(), valuesJson: "[1,2,3]" };
    expect(() => aggregateProfiles(b, 1, [bad])).toThrow(/valeurs/);
  });
});
