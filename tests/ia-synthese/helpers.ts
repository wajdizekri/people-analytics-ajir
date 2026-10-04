import { vi } from "vitest";
import type { NarrativeFacts } from "@/lib/ai/narrative";
import type { SynthesisDto } from "@/lib/dal/synthesis";

// Jeux d'agrégats de la synthèse rédigée (sans base) et API simulée : aucun appel réseau réel dans ces tests.

export const facts = (over: Partial<NarrativeFacts> = {}): NarrativeFacts => ({
  view: "RH",
  month: "2026-08",
  previousMonth: "2026-07",
  referenceDate: "2026-08-31",
  hasCurrentRun: true,
  hasPreviousRun: true,
  smallPopulation: false,
  minGroupSize: 5,
  headcount: 1234,
  headcountBefore: 1222,
  entries: 20,
  exits: 8,
  voluntaryExits: 5,
  high: 24,
  newHigh: 6,
  leftHigh: 3,
  absenteeism: 0.0423,
  absenteeismBefore: 0.0312,
  overtime: 2.5,
  overtimeBefore: 2,
  alertsOpen: 5,
  alertsCritical: 2,
  alertsNew: 3,
  recommendationsOpen: 7,
  recommendationsNew: 4,
  trainingsOverdue: 3,
  trainingsOverdueNew: 1,
  ...over,
});

export const MANAGER_MASKED = facts({
  view: "MANAGER",
  smallPopulation: true,
  headcount: 3,
  headcountBefore: 4,
  entries: 0,
  exits: null,
  voluntaryExits: null,
  high: 0,
  newHigh: 0,
  leftHigh: 1,
  absenteeism: null,
  absenteeismBefore: null,
  overtime: null,
  overtimeBefore: null,
  alertsOpen: 0,
  alertsCritical: 0,
  alertsNew: null,
  recommendationsOpen: 0,
  recommendationsNew: null,
  trainingsOverdue: 0,
  trainingsOverdueNew: 0,
});

// Jeux couvrant les branches des gabarits : valeurs nulles, masquées, zéros, singuliers, mois à élision, changement d'année
export const FACT_SETS: Record<string, NarrativeFacts> = {
  "RH complet": facts(),
  "manager, petite population": MANAGER_MASKED,
  "aucun calcul publié": facts({ hasCurrentRun: false, hasPreviousRun: false, high: null, newHigh: null, leftHigh: null }),
  "premier calcul (avril)": facts({ month: "2026-04", previousMonth: "2026-03", referenceDate: "2026-04-30", hasPreviousRun: false, newHigh: null, leftHigh: null }),
  "calcul précédent d'août": facts({ month: "2026-09", previousMonth: "2026-08", referenceDate: "2026-09-30" }),
  "changement d'année": facts({ month: "2027-01", previousMonth: "2026-12", referenceDate: "2027-01-31" }),
  "effectif nul": facts({ view: "MANAGER", headcount: 0, headcountBefore: 2, entries: 0, exits: 0, voluntaryExits: 0, high: 0, newHigh: 0, leftHigh: 0 }),
  singuliers: facts({
    headcount: 1,
    headcountBefore: 1,
    entries: 1,
    exits: 1,
    voluntaryExits: 0,
    high: 1,
    newHigh: 1,
    leftHigh: 0,
    absenteeism: 0.05,
    absenteeismBefore: null,
    alertsOpen: 1,
    alertsCritical: 1,
    recommendationsOpen: 1,
    trainingsOverdue: 1,
  }),
  "absentéisme en baisse, sans alerte": facts({ absenteeism: 0.021, absenteeismBefore: 0.034, alertsOpen: 0, alertsCritical: 0, recommendationsOpen: 0 }),
  "absentéisme stable, manager": facts({ view: "MANAGER", absenteeism: 0.0151, absenteeismBefore: 0.0145, recommendationsOpen: 2 }),
  "RH, absentéisme indisponible": facts({ absenteeism: null, absenteeismBefore: null, overtime: null, overtimeBefore: null }),
  "grands nombres": facts({ headcount: 12345, headcountBefore: 12000, entries: 1200, exits: 1100, voluntaryExits: 1000, high: 246, newHigh: 120, leftHigh: 118, alertsOpen: 1500, alertsCritical: 1200 }),
};

// DTO de synthèse avec listes nominatives et constats : rien de cela ne doit atteindre la charge utile
export function synthesisDto(view: "RH" | "MANAGER" = "RH"): SynthesisDto {
  const person = (id: number, name: string, matricule: string) => ({ id, name, matricule, department: "Finance", before: "MOYEN" as const, after: "ELEVE" as const, reason: "HAUSSE" as const });
  return {
    view,
    referenceDate: "2026-08-31",
    month: "2026-08",
    previousMonth: "2026-07",
    current: { asOf: "2026-08-31" },
    previous: { asOf: "2026-07-31" },
    smallPopulation: false,
    statements: [{ key: "nouveaux-eleves", tone: "alerte", text: "2 collaborateurs de Finance sont passés en risque élevé.", href: "/employees?niveau=ELEVE&departement=77", linkLabel: "Voir la liste" }],
    kpis: {
      headcount: { now: 48, before: 47 },
      entries: 2,
      exits: 1,
      voluntaryExits: 1,
      high: 3,
      newHigh: 2,
      leftHigh: 1,
      absenteeism: { now: 0.031, before: 0.029 },
      overtime: { now: 1.5, before: 1.2 },
      alerts: { open: 4, critical: 1, sincePrevious: 2 },
      recommendations: { open: 3, sincePrevious: 1 },
      trainingsOverdue: { total: 6, thisMonth: 2 },
    },
    newHigh: [person(4242, "Ben Salah Amira", "AJ-00421"), person(4243, "Trabelsi Karim", "AJ-00422")],
    leftHigh: [{ ...person(4250, "Gharbi Leila", "AJ-00430"), before: "ELEVE", after: "MOYEN", reason: "BAISSE" }],
  };
}
export const NOMINATIVE = ["Ben Salah", "Amira", "Trabelsi", "Karim", "Gharbi", "Leila", "AJ-00", "4242", "4243", "4250", "Finance", "departement=77"];

export const normalizeSpaces = (t: string) => t.replace(/[\u00a0\u202f]/g, " ");

type ApiReply = { text?: string; status?: number; stopReason?: string };

/** API Claude simulée : réponse Messages API (texte, statut HTTP, motif d'arrêt). */
export function fakeApi(reply: ApiReply = {}) {
  return vi.fn<typeof fetch>(async () => {
    const body = { id: "msg_test", type: "message", role: "assistant", content: [{ type: "text", text: reply.text ?? "" }], stop_reason: reply.stopReason ?? "end_turn" };
    return new Response(JSON.stringify(body), { status: reply.status ?? 200, headers: { "content-type": "application/json" } });
  });
}

/** API qui ne répond jamais : seule l'expiration du délai (signal d'abandon) met fin à l'appel. */
export function hangingApi() {
  return vi.fn<typeof fetch>(
    (_input, init) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      }),
  );
}

/** Toute tentative d'appel réseau fait échouer le test. */
export const forbiddenFetch = () =>
  vi.fn<typeof fetch>(async () => {
    throw new Error("Appel réseau interdit dans les tests de la synthèse rédigée");
  });
