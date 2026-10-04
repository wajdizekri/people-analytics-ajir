import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DepartureProfiles } from "@/components/retention/departure-profiles";
import { aggregateProfiles } from "@/lib/ai/typology/aggregate";
import { parseTypologyBundle } from "@/lib/ai/typology/model";
import type { DepartureProfilesDto } from "@/lib/dal/typology";
import { row, syntheticBundle, tenureFor } from "./helpers";

// Rendu serveur de la section seule (sans runtime Next) : liens et graphique remplacés par des éléments simples
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children) }));
vi.mock("@/components/charts/echart", () => ({ EChart: ({ ariaLabel }: { ariaLabel: string }) => createElement("div", { role: "img", "aria-label": ariaLabel }) }));

const b = parseTypologyBundle(syntheticBundle());
const times = <T,>(n: number, f: () => T) => Array.from({ length: n }, f);
const rows = [
  ...times(18, () => row({ tenure_months: tenureFor(2), overtime_h_avg_3m: 10 }, { departmentName: "Production", exitDate: "2021-03-01" })),
  ...times(12, () => row({ tenure_months: tenureFor(4), overtime_h_avg_3m: 10 }, { departmentName: "IT", exitDate: "2026-08-20" })),
  ...times(9, () => row({ tenure_months: tenureFor(3), overtime_h_avg_3m: 20 }, { departmentName: "Finance" })),
];

function dto(over: Partial<DepartureProfilesDto> = {}): DepartureProfilesDto {
  const a = aggregateProfiles(b, rows.length + 6, rows);
  return {
    status: "OK",
    referenceDate: "2026-08-31",
    model: { version: "typo-kmeans-v1-20261004", trainedAt: "2026-10-04T08:00:00Z", trainFrom: "2020-10-01", trainTo: "2026-08-28", k: 3, minProfileSize: 20 },
    ...a,
    minGroupSize: 5,
    minDepartures: 30,
    ...over,
  };
}
const render = (d: DepartureProfilesDto) => renderToStaticMarkup(createElement(DepartureProfiles, { data: d, role: "RH" }));

describe("section « Profils de départs » (rendu statique)", () => {
  it("titre, visuel des parts triées, une carte par profil avec ses traits, tableau Voir les données", () => {
    const html = render(dto());
    expect(html).toContain('id="profils-departs"');
    expect(html).toContain("Profils de départs");
    expect(html).toContain("Départs par profil (%)");
    expect(html).toContain("Plus fréquent : Arrivées récentes");
    expect(html).toContain("46,2");
    expect(html).toContain("Barres horizontales triées");
    expect(html).toContain("Voir les données");
    for (const p of b.profiles) {
      expect(html).toContain(p.label);
      for (const t of p.traits) expect(html).toContain(t.text.replace(/'/g, "&#x27;"));
    }
    expect(html).toContain("18 départs");
    expect(html).toContain("Ancienneté médiane au départ");
    expect(html).toContain("Stabilité du profil : élevée");
    expect(html).toContain("Stabilité du profil : faible");
    expect(html).toContain("départs du 01/03/2021 au 20/08/2026");
    expect(html).toContain("39 départs classés sur 45 départs volontaires · 6 non classés");
  });

  it("détail par département ; badge « Estimation non causale », limites dans la bulle : aucun salarié étiqueté, attributs exclus", () => {
    const html = render(dto());
    expect(html).toContain("Profil le plus fréquent par département");
    expect(html).toMatch(/Production<\/th>/);
    expect(html).toContain("Estimation non causale");
    expect(html).toContain("facteurs associés, pas des causes");
    expect(html).toContain("Aucun collaborateur n&#x27;est étiqueté");
    expect(html).toContain("Sexe, âge, situation familiale, gouvernorat et données de santé ne sont jamais utilisés");
    expect(html).not.toContain("Comment lire");
    expect(html).not.toMatch(/<h3[^>]*>Limites/);
  });

  it("aucune donnée nominative rendue", () => {
    const html = render(dto());
    for (const s of ["employeeId", "exitId", "matricule", "Nom ", "valuesJson"]) expect(html).not.toContain(s);
  });

  it("profil masqué : signalé, sans effectif", () => {
    const masked = dto({
      profiles: dto().profiles.map((p) => (p.id === 3 ? { ...p, masked: true, departures: null, share: null, medianTenureMonths: null } : p)),
      maskedProfiles: 1,
    });
    const html = render(masked);
    expect(html).toContain("1 profil n&#x27;est pas chiffré");
    expect(html).toContain("Effectif non affiché : moins de 5 départs");
  });

  it("états : modèle absent, modèle invalide, trop peu de départs", () => {
    expect(render(dto({ status: "MODELE_ABSENT", profiles: [] }))).toContain("Profils de départs non disponibles");
    expect(render(dto({ status: "MODELE_INVALIDE", profiles: [] }))).toContain("contrôle de cohérence");
    const few = render(dto({ status: "TROP_PEU", classified: 12, profiles: [] }));
    expect(few).toContain("Trop peu de départs volontaires pour décrire des profils");
    expect(few).toContain("12 départs classés · 30 requis");
  });
});
