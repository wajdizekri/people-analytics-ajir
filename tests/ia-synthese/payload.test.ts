import { describe, expect, it } from "vitest";
import { PAYLOAD_FIELDS, PERIMETERS, assertWhitelisted, buildPayload, draftSentences, factsFromSynthesis, type NarrativePayload } from "@/lib/ai/narrative";
import { SYSTEM_PROMPT, buildRequestBody } from "@/lib/ai/narrative/generative";
import { FACT_SETS, NOMINATIVE, facts, synthesisDto } from "./helpers";

// Liste blanche de la charge utile : champs fixes, valeurs à motif strict, aucune donnée nominative ni identifiant
const FORBIDDEN_KEY = /^id$|Id$|_id|matricule|^nom|name|prenom|employee|salari|departement|department|service|manager|statement|constat|phrase/i;

function keysOf(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => keysOf(v, out));
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      keysOf(v, out);
    }
  return out;
}

describe("charge utile : liste blanche typée", () => {
  it("exactement les champs de la liste blanche, aucune clé d'identification", () => {
    for (const f of Object.values(FACT_SETS)) {
      const p = buildPayload(f);
      expect(Object.keys(p).sort()).toEqual([...PAYLOAD_FIELDS].sort());
      expect(keysOf(p).filter((k) => FORBIDDEN_KEY.test(k))).toEqual([]);
      for (const v of Object.values(p)) expect(["string", "number", "boolean"].includes(typeof v) || v === null).toBe(true);
    }
  });

  it("depuis un DTO contenant des noms, matricules, identifiants et services : rien de nominatif dans la charge ni dans la requête", () => {
    const f = factsFromSynthesis(synthesisDto(), 5);
    const payload = buildPayload(f);
    const body = buildRequestBody({ indicateurs: payload, brouillon: draftSentences(f).join(" ") }, "claude-opus-5-5");
    for (const s of NOMINATIVE) {
      expect(JSON.stringify(payload)).not.toContain(s);
      expect(body).not.toContain(s);
    }
    expect(keysOf(JSON.parse(body)).filter((k) => FORBIDDEN_KEY.test(k))).toEqual([]);
    expect(payload).toMatchObject({ perimetre: "toute l'entreprise", effectifFinDeMois: 48, collaborateursRisqueEleve: 3, nouveauxRisqueEleve: 2 });
  });

  it("le test échoue si un matricule, un nom ou un identifiant de salarié s'y glisse", () => {
    const base = buildPayload(facts()) as unknown as Record<string, unknown>;
    expect(() => assertWhitelisted({ ...base, matricule: "AJ-00421" })).toThrow(/hors liste blanche/);
    expect(() => assertWhitelisted({ ...base, employeeId: 4242 })).toThrow(/hors liste blanche/);
    expect(() => assertWhitelisted({ ...base, perimetre: "équipe de Ben Salah Amira" })).toThrow(/perimetre/);
    expect(() => assertWhitelisted({ ...base, mois: "août 2026 (Ben Salah Amira)" })).toThrow(/mois/);
    expect(() => assertWhitelisted({ ...base, absenteismeHorsSante: "AJ-00421" })).toThrow(/absenteismeHorsSante/);
    expect(() => assertWhitelisted({ ...base, effectifFinDeMois: 12.5 })).toThrow(/effectifFinDeMois/);
    expect(() => assertWhitelisted({ ...base, sorties: "4242" })).toThrow(/sorties/);
    const missing = { ...base };
    delete missing.entrees;
    expect(() => assertWhitelisted(missing)).toThrow(/manquant/);
    expect(() => assertWhitelisted(base)).not.toThrow();
  });

  it("valeurs masquées transmises comme null (jamais devinées), périmètre manager générique", () => {
    const p: NarrativePayload = buildPayload(FACT_SETS["manager, petite population"]);
    expect(p).toMatchObject({ perimetre: PERIMETERS.MANAGER, sorties: null, sortiesVolontaires: null, absenteismeHorsSante: null, variationAbsenteisme: null, heuresSupParPersonne: null });
    expect(buildPayload(FACT_SETS["aucun calcul publié"]).collaborateursRisqueEleve).toBeNull();
  });

  it("chiffres préformatés en français pour être recopiés tels quels", () => {
    const p = buildPayload(facts());
    expect(p).toMatchObject({ mois: "août 2026", moisPrecedent: "juillet 2026", donneesAu: "31/08/2026", absenteismeHorsSante: "4,2\u00a0%", variationAbsenteisme: "+1,1\u00a0pt", heuresSupParPersonne: "2,5\u00a0h", variationEffectif: 12 });
  });

  it("requête : prompt système figé en tête (marqué pour le cache), données variables dans le message, ni réflexion ni température", () => {
    const f = facts();
    const body = JSON.parse(buildRequestBody({ indicateurs: buildPayload(f), brouillon: draftSentences(f).join(" ") }, "claude-opus-5-5"));
    expect(Object.keys(body).sort()).toEqual(["max_tokens", "messages", "model", "system"]);
    expect(body.model).toBe("claude-opus-5-5");
    expect(body.system).toEqual([{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }]);
    expect(SYSTEM_PROMPT).not.toMatch(/\d{4}|août|entreprise de|équipe de/);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe("user");
    expect(body.messages[0].content).toContain('"effectifFinDeMois":1234');
    expect(body.messages[0].content).toContain("Brouillon à reformuler");
    for (const rule of ["vouvoiement", "20 mots au plus", "N'utilisez que les nombres présents", "facteurs associés", "la décision reste humaine"]) expect(SYSTEM_PROMPT).toContain(rule);
  });
});
