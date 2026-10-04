import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionUser } from "@/lib/auth/session";
import type { ActionMatching, MatchedComparisonDto } from "@/lib/dal/intervention-impact";
import { INSUFFICIENT_LABEL, MATCHING_TITLE, MatchedComparison, NON_CAUSAL_BADGE, intervalReading } from "@/app/(app)/interventions/matched-comparison";
import { createCausalFixture, destroyCausalFixture, type CausalFixture } from "./fixture";

// Section « Comparaison avec des collaborateurs similaires » : vocabulaire imposé (estimation non causale, aucun « évité »),
// limites écrites à côté du chiffre, formats français, jetons sémantiques ; rendu dans la page /interventions (RH seulement).

const session: { current: SessionUser | null } = { current: null };
vi.mock("@/lib/auth/session", () => ({ readSession: async () => session.current, clientIp: () => "test" }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement("a", { href, ...rest }, children) }));
vi.mock("next/form", () => ({ default: ({ children, ...rest }: { children: ReactNode }) => createElement("form", rest, children) }));
vi.mock("@/components/charts/echart", () => ({ EChart: ({ ariaLabel }: { ariaLabel: string }) => createElement("div", { role: "img", "aria-label": ariaLabel }) }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

const text = (el: unknown) =>
  renderToStaticMarkup(el as ReactElement)
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/ /g, " ")
    .replace(/\s+/g, " ");

const outcome = (o: Partial<ActionMatching["outcomes"][number]> & Pick<ActionMatching["outcomes"][number], "outcome">) => ({
  status: "OK" as const,
  pairs: 48,
  treatedRate: 0.08,
  controlRate: 0.12,
  diff: -0.04,
  low: -0.09,
  high: 0.01,
  naiveDiff: 0.05,
  ...o,
});
const balance = [
  { code: "level_eleve", label: "Risque élevé au dernier calcul", smdBefore: 1.42, smdAfter: 0.04 },
  { code: "compa_ratio", label: "Compa-ratio (salaire / médiane du poste)", smdBefore: -0.61, smdAfter: -0.31 },
  { code: "overtime_h_avg_3m", label: "Heures sup. par mois (moyenne 3 mois)", smdBefore: 0.4, smdAfter: 0.18 },
];
const DTO: MatchedComparisonDto = {
  referenceDate: "2026-08-31",
  horizonMonths: 6,
  levelWindowMonths: 3,
  washoutMonths: 6,
  minTreated: 20,
  minPairs: 20,
  level: 0.95,
  bootstrap: 2000,
  caliperSd: 0.2,
  smdThreshold: 0.25,
  actions: [
    {
      actionCode: "ENTRETIEN",
      status: "OK",
      actions: 52,
      comparable: 50,
      candidates: 9800,
      matched: 48,
      matchedShare: 0.96,
      supportShare: 1,
      verdict: "COMPARABLE",
      reasons: [],
      maxSmdBefore: 1.42,
      maxSmdAfter: 0.04,
      balance: [balance[0], { ...balance[1], smdAfter: 0.05 }],
      outcomes: [outcome({ outcome: "DEMISSION_6M" }), outcome({ outcome: "NIVEAU_BAISSE", treatedRate: 0.31, controlRate: 0.29, diff: 0.02, low: -0.05, high: 0.09, pairs: 41 })],
    },
    {
      actionCode: "REVISION_SALARIALE",
      status: "OK",
      actions: 40,
      comparable: 36,
      candidates: 7000,
      matched: 23,
      matchedShare: 0.64,
      supportShare: 0.8,
      verdict: "FRAGILE",
      reasons: ["DESEQUILIBRE", "APPARIEMENT_PARTIEL"],
      maxSmdBefore: 1.42,
      maxSmdAfter: 0.31,
      balance,
      outcomes: [outcome({ outcome: "DEMISSION_6M", diff: -0.13, low: -0.26, high: -0.02, pairs: 23 }), outcome({ outcome: "NIVEAU_BAISSE", status: "INSUFFISANT", pairs: 12, diff: null, low: null, high: null, treatedRate: null, controlRate: null, naiveDiff: null })],
    },
    {
      actionCode: "PLAN_FORMATION",
      status: "INSUFFISANT",
      actions: 4,
      comparable: 3,
      candidates: 0,
      matched: 0,
      matchedShare: null,
      supportShare: null,
      verdict: null,
      reasons: [],
      maxSmdBefore: null,
      maxSmdAfter: null,
      balance: [],
      outcomes: [
        outcome({ outcome: "DEMISSION_6M", status: "INSUFFISANT", pairs: 0, diff: null, low: null, high: null, treatedRate: null, controlRate: null, naiveDiff: null }),
        outcome({ outcome: "NIVEAU_BAISSE", status: "INSUFFISANT", pairs: 0, diff: null, low: null, high: null, treatedRate: null, controlRate: null, naiveDiff: null }),
      ],
    },
  ],
};

describe("section : vocabulaire et limites", () => {
  const s = text(createElement(MatchedComparison, { data: DTO }));

  it("titre, mention non causale, encadré des limites, tableaux « Voir les données »", () => {
    expect(s).toContain(MATCHING_TITLE);
    expect(s).toContain(NON_CAUSAL_BADGE);
    expect(s).toContain("valable sous hypothèses");
    expect(s).toContain("Ce que ce chiffre ne dit pas");
    for (const k of ["Variables non observées", "Choix des personnes suivies", "Petits effectifs", "Aucune décision individuelle ne repose sur ce chiffre"]) expect(s).toContain(k);
    expect(s).toContain("Voir les données");
    expect(s).toContain("Voir l'équilibre des groupes");
    // Résultat du scénario LATENT de la validation semi-synthétique (docs/RESULTATS_IA_INTERVENTIONS.md § 5.3)
    expect(s).toContain("Sur données simulées, un tel facteur a inversé le sens de l'écart, alors que les groupes paraissaient comparables.");
  });

  it("aucun « évité », aucune lecture causale", () => {
    expect(s).not.toMatch(/évit/i);
    expect(s).not.toMatch(/grâce à|a permis de|sauvé|retenu(s)? grâce/i);
    const causal = s.match(/\S+ (?:un effet )?causale?\b/gi) ?? [];
    expect(causal.length).toBeGreaterThan(0);
    for (const m of causal) expect(m, m).toMatch(/^(non|pas) /i);
  });

  it("écart, fourchette et équilibre en mots, au format français", () => {
    expect(s).toContain("Groupes comparables");
    expect(s).toContain("Comparaison fragile");
    expect(s).toContain("Suivis : 8,0 % · Similaires : 12,0 %");
    expect(s).toContain("Écart : −4,0 pt (fourchette de −9,0 pt à +1,0 pt)");
    expect(s).toContain("Aucun écart net (fourchette contenant zéro) · Paires : ");
    expect(s).toContain("Écart net, non causal (fourchette excluant zéro)");
    expect(s).toContain("Écarts subsistants : compa-ratio (salaire / médiane du poste)");
    expect(s).not.toContain("risque élevé au dernier calcul.");
    expect(s).toContain("Appariement partiel : 64 % des suivis");
    expect(s).toContain("Paires : 48 · Couverture : 96 % des 50 suivis comparables");
    expect(s).not.toMatch(/\d\.\d/);
  });

  it("gardes : effectif insuffisant, aucun chiffre sous le seuil", () => {
    expect(s).toContain(`${INSUFFICIENT_LABEL} : 12 / 20 paires`);
    expect(s).toContain("Suivis comparables : 3 / 20 requis");
  });

  it("lecture de la fourchette", () => {
    expect(intervalReading({ low: -0.1, high: 0.02 })).toContain("contenant zéro");
    expect(intervalReading({ low: 0.01, high: 0.2 })).toContain("excluant zéro");
    expect(intervalReading({ low: null, high: null })).toBe("");
  });

  it("jetons sémantiques seulement (thème sombre)", () => {
    const raw = /\b(?:bg|text|border(?:-[lrtbxy])?|ring|divide|from|via|to|accent)-(?:slate|gray|sky|red|amber|emerald|brand|white|black|green)\b|#[0-9a-f]{6}\b/i;
    const src = fs.readFileSync(path.resolve(process.cwd(), "src/app/(app)/interventions/matched-comparison.tsx"), "utf8");
    expect(src).not.toMatch(raw);
    expect(src).not.toMatch(/text-success|bg-success/);
  });
});

describe("page /interventions avec des entretiens comparables", () => {
  let f: CausalFixture;
  beforeAll(() => {
    f = createCausalFixture("page");
  });
  afterAll(() => destroyCausalFixture(f));
  const sp = () => ({ searchParams: Promise.resolve({}) });

  it("RH : section rendue après l'avant / après, avertissement conservé", async () => {
    session.current = { userId: f.users.rh, login: "rh.causal", role: "RH", employeeId: null } as SessionUser;
    const page = (await import("@/app/(app)/interventions/page")).default;
    const s = text(await page(sp()));
    expect(s).toContain("Observation non causale");
    expect(s).toContain("en tient compte en partie, sans prouver d'effet");
    expect(s.indexOf(MATCHING_TITLE)).toBeGreaterThan(s.indexOf("Avant / après par type d'action"));
    expect(s).toContain("Entretien de rétention");
    expect(s).toMatch(/Groupes comparables|Comparaison fragile/);
    expect(s).toContain("Écart : ");
    expect(s).toContain(INSUFFICIENT_LABEL);
    expect(s).not.toMatch(/évit/i);
  });

  it("MANAGER et ADMIN : page refusée", async () => {
    const page = (await import("@/app/(app)/interventions/page")).default;
    session.current = { userId: f.users.manager, login: "mgr.causal", role: "MANAGER", employeeId: f.ids[0] } as SessionUser;
    await expect(page(sp())).rejects.toThrow("REDIRECT:/interdit");
    session.current = { userId: f.users.admin, login: "admin.causal", role: "ADMIN", employeeId: null } as SessionUser;
    await expect(page(sp())).rejects.toThrow("REDIRECT:/interdit");
  });
});
