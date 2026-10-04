import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionUser } from "@/lib/auth/session";
import type { AccessContext } from "@/lib/dal/context";
import { HttpError } from "@/lib/dal/errors";
import { getSynthesis, getSynthesisNarrative } from "@/lib/dal/synthesis";
import { clearNarrativeCache } from "@/lib/ai/narrative/generative";
import { describeAudit } from "@/components/admin/audit-labels";
import { auditRows, createFixture, ctxOf, destroyFixture, meta, type Fixture } from "../insights/fixture";
import { fakeApi, forbiddenFetch, normalizeSpaces } from "./helpers";

// Synthèse rédigée branchée sur la DAL (base de test des insights) et sur la page /synthese : rôles, périmètre manager,
// audit de chaque appel, rendu statique de l'encadré. API toujours simulée.
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

let f: Fixture;
let c: ReturnType<typeof ctxOf>;
beforeAll(() => {
  f = createFixture("ia-synthese");
  c = ctxOf(f);
});
afterAll(() => destroyFixture(f));
beforeEach(() => {
  clearNarrativeCache();
  vi.stubEnv("SYNTHESIS_AI_API_KEY", undefined);
  vi.stubEnv("SYNTHESIS_AI_MODEL", undefined);
  vi.stubGlobal("fetch", forbiddenFetch());
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const html = (el: unknown) => renderToStaticMarkup(el as ReactElement);
const text = (m: string) => normalizeSpaces(m.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " "));
const IDENTITIES = () => [...Object.keys(f.ids).flatMap((k) => [`Nom${k}`, `Prenom${k}`, `M-${k}`]), "Production", "Commercial"];
const RH_TEXT =
  "Fin août 2026, toute l'entreprise compte 16 collaborateurs, sans changement depuis fin juillet 2026. " +
  "3 collaborateurs sont en risque élevé, dont 2 nouveaux. " +
  "Il reste 2 alertes, dont 1 critique, et 2 recommandations à décider. " +
  "Ce niveau de risque est une estimation fondée sur des facteurs associés ; la décision vous revient.";
const status = async (p: Promise<unknown>) =>
  p.then(
    () => 200,
    (e) => (e instanceof HttpError ? e.status : -1),
  );

describe("DAL : rôles et activation", () => {
  it("ADMIN refusé (403 audité) ; DTO d'un autre rôle refusé", async () => {
    const rh = getSynthesis(c.rh, meta);
    expect(await status(getSynthesisNarrative(c.admin, rh, meta))).toBe(403);
    expect(auditRows("synthesis.narrative").some((r) => r.userId === f.users.admin && r.outcome === "REFUSE")).toBe(true);
    expect(await status(getSynthesisNarrative(c.manager, rh, meta))).toBe(403);
  });

  it("sans clé : phrases types du périmètre, aucun appel réseau, aucun audit d'appel", async () => {
    const n = await getSynthesisNarrative(c.rh, getSynthesis(c.rh, meta), meta);
    expect(n.source).toBe("GABARIT");
    expect(n.sentences.map(normalizeSpaces)).toEqual([
      "Fin août 2026, l'effectif de toute l'entreprise compte 16 collaborateurs, stable depuis fin juillet 2026.",
      "Depuis fin juillet 2026, on compte 1 entrée et 1 sortie, dont 1 départ volontaire.",
      "3 collaborateurs sont en risque élevé : 2 nouveaux, 2 sortis de ce niveau depuis le calcul de juillet 2026.",
      "L'absentéisme hors santé reste stable : 0,9 % en août 2026, contre 0,8 % en juillet 2026.",
      "Il reste 2 alertes à traiter (dont 1 critique), 2 recommandations à décider et 2 formations obligatoires en retard.",
      "Le niveau de risque est une estimation fondée sur des facteurs associés, non causale ; la décision reste humaine.",
    ]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(auditRows("synthesis.narrative.generate")).toEqual([]);
  });

  it("manager : agrégats de sa hiérarchie seulement ; petite population masquée", async () => {
    const m = await getSynthesisNarrative(c.manager, getSynthesis(c.manager, meta), meta);
    const t = m.sentences.join(" ");
    expect(t).toContain("l'effectif de votre équipe compte 9 collaborateurs");
    expect(t).toContain("1 recommandation en cours");
    for (const s of IDENTITIES()) expect(t).not.toContain(s);
    const small: AccessContext = { userId: f.users.manager, login: "mgr.s", role: "MANAGER", employeeId: f.ids.S };
    const s = await getSynthesisNarrative(small, getSynthesis(small, meta), meta);
    expect(s.sentences.join(" ")).toContain("les sorties restent masquées (groupe de moins de 5 personnes)");
    expect(s.sentences.join(" ")).toContain("L'absentéisme et les heures supplémentaires sont masqués pour un groupe de moins de 5 personnes.");
  });
});

describe("DAL : reformulation par IA générative (API simulée)", () => {
  it("RH : texte vérifié ; audit de l'appel (qui, périmètre, taille, modèle) sans le contenu ; cache au second affichage", async () => {
    vi.stubEnv("SYNTHESIS_AI_API_KEY", "cle-de-test");
    const api = fakeApi({ text: RH_TEXT });
    const s = getSynthesis(c.rh, meta);
    const n = await getSynthesisNarrative(c.rh, s, meta, { fetchImpl: api });
    expect(n).toMatchObject({ source: "IA", model: "claude-opus-5-5", fallback: null });
    const body = String(api.mock.calls[0][1]?.body);
    for (const id of IDENTITIES()) expect(body).not.toContain(id);
    expect(JSON.parse(body).messages[0].content).toContain('"perimetre":"toute l\'entreprise"');
    const rows = auditRows("synthesis.narrative.generate");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: f.users.rh, outcome: "OK", targetId: "2026-08" });
    const detail = JSON.parse(rows[0].detail ?? "{}");
    expect(Object.keys(detail).sort()).toEqual(["durationMs", "model", "payloadBytes", "reason", "scope", "source", "view"]);
    expect(detail).toMatchObject({ scope: "ENTREPRISE", view: "RH", model: "claude-opus-5-5", payloadBytes: Buffer.byteLength(body, "utf8") });
    expect(rows[0].detail).not.toMatch(/collaborateurs|alertes|risque élevé/);
    await getSynthesisNarrative(c.rh, getSynthesis(c.rh, meta), meta, { fetchImpl: api });
    expect(api).toHaveBeenCalledTimes(1);
    expect(auditRows("synthesis.narrative.generate")).toHaveLength(1);
    expect(describeAudit({ action: "synthesis.narrative.generate", outcome: "OK", login: "rh.test", targetType: "synthesis", targetId: "2026-08", detail: rows[0].detail })).toBe(
      `rh.test a généré la synthèse rédigée par IA générative (toute l'entreprise, ${detail.payloadBytes.toLocaleString("fr-FR")} octets d'agrégats transmis).`,
    );
  });

  it("manager : périmètre générique transmis, aucune identité ; échec audité et repli", async () => {
    vi.stubEnv("SYNTHESIS_AI_API_KEY", "cle-de-test");
    const api = fakeApi({ status: 503 });
    const n = await getSynthesisNarrative(c.manager, getSynthesis(c.manager, meta), meta, { fetchImpl: api });
    expect(n).toMatchObject({ source: "GABARIT", fallback: "http_503" });
    const body = String(api.mock.calls[0][1]?.body);
    expect(body).toContain("votre équipe (périmètre hiérarchique)");
    for (const id of IDENTITIES()) expect(body).not.toContain(id);
    const row = auditRows("synthesis.narrative.generate").at(-1)!;
    expect(row).toMatchObject({ userId: f.users.manager, outcome: "ECHEC" });
    expect(JSON.parse(row.detail ?? "{}")).toMatchObject({ scope: "EQUIPE", view: "MANAGER", reason: "http_503" });
    expect(describeAudit({ action: "synthesis.narrative.generate", outcome: "ECHEC", login: "mgr.r", targetType: "synthesis", targetId: "2026-08", detail: row.detail })).toContain(
      "mgr.r n'a pas pu générer la synthèse rédigée par IA générative (périmètre d'une équipe",
    );
  });
});

describe("rendu statique de l'encadré", () => {
  const sample = { sentences: ["Première phrase.", "Deuxième phrase."], model: null, fallback: null };

  it("phrases types : titre court, méthode en pastille et en bulle", async () => {
    const { NarrativeBox } = await import("@/app/(app)/synthese/narrative");
    const m = html(createElement(NarrativeBox, { narrative: { source: "GABARIT", ...sample } }));
    expect(m).toContain('aria-labelledby="synthese-redigee-titre"');
    expect((m.match(/<li>/g) ?? []).length).toBe(2);
    const t = text(m);
    expect(m).toMatch(/id="synthese-redigee-titre"[^>]*>Synthèse du mois</);
    expect(t).not.toContain("Synthèse du mois en quelques phrases");
    expect(t).toContain("Phrases types");
    expect(t).toContain("Rédaction par phrases types, sans IA générative.");
    expect(t).not.toContain("(s)");
  });

  it("IA générative : modèle affiché ; repli et attente signalés", async () => {
    const { NarrativeBox } = await import("@/app/(app)/synthese/narrative");
    const ia = text(html(createElement(NarrativeBox, { narrative: { ...sample, source: "IA", model: "claude-opus-5-5" } })));
    expect(ia).toContain("IA générative");
    expect(ia).toContain("Reformulé par IA générative (modèle claude-opus-5-5) à partir des seuls agrégats ; chaque chiffre a été vérifié.");
    const fb = text(html(createElement(NarrativeBox, { narrative: { ...sample, source: "GABARIT", fallback: "delai" } })));
    expect(fb).toContain("la reformulation par IA générative n'a pas abouti");
    const pending = html(createElement(NarrativeBox, { narrative: { source: "GABARIT", ...sample }, pending: true }));
    expect(pending).toContain('aria-busy="true"');
    expect(text(pending)).toContain("Reformulation par IA générative en cours");
  });

  it("AiNarrative : rendu de la version reformulée (API simulée)", async () => {
    vi.stubEnv("SYNTHESIS_AI_API_KEY", "cle-de-test");
    vi.stubGlobal("fetch", fakeApi({ text: RH_TEXT }));
    const { AiNarrative } = await import("@/app/(app)/synthese/narrative");
    const t = text(html(await AiNarrative({ ctx: c.rh, synthesis: getSynthesis(c.rh, meta), meta })));
    expect(t).toContain("3 collaborateurs sont en risque élevé, dont 2 nouveaux.");
    expect(t).toContain("(modèle claude-opus-5-5)");
  });
});

describe("page /synthese (sans clé d'API)", () => {
  const as = (role: "RH" | "MANAGER") =>
    (session.current = { userId: role === "RH" ? f.users.rh : f.users.manager, login: role.toLowerCase(), role, employeeId: role === "MANAGER" ? f.ids.R : null } as SessionUser);
  const render = async () => html(await (await import("@/app/(app)/synthese/page")).default());

  it("RH : encadré en tête, avant les priorités et les chiffres clés", async () => {
    as("RH");
    const out = await render();
    const t = text(out);
    expect(out).toMatch(/id="synthese-redigee-titre"[^>]*>Synthèse du mois</);
    expect(t).toContain("Fin août 2026, l'effectif de toute l'entreprise compte 16 collaborateurs");
    expect(t).toContain("Rédaction par phrases types, sans IA générative.");
    expect(out.indexOf("Imprimer la synthèse")).toBeLessThan(out.indexOf('id="synthese-redigee-titre"'));
    expect(out.indexOf('id="synthese-redigee-titre"')).toBeLessThan(out.indexOf("À traiter en priorité"));
    expect(out.indexOf("À traiter en priorité")).toBeLessThan(out.indexOf("Chiffres clés"));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("manager : encadré de son équipe, sans nom, matricule, probabilité ni rémunération", async () => {
    as("MANAGER");
    const out = await render();
    const box = /<section aria-labelledby="synthese-redigee-titre"[\s\S]*?<\/section>/.exec(out)?.[0] ?? "";
    expect(text(box)).toContain("l'effectif de votre équipe compte 9 collaborateurs");
    for (const id of IDENTITIES()) expect(box).not.toContain(id);
    expect(box).not.toMatch(/TND|Probabilité|Masse salariale|%\s*de risque/i);
  });
});
