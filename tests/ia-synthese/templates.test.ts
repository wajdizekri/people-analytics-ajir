import { describe, expect, it } from "vitest";
import { MAX_SENTENCES, MAX_WORDS, allowedNumbers, buildPayload, countWords, draftNarrative, draftSentences, factsFromSynthesis, numbersIn, verifyGenerated } from "@/lib/ai/narrative";
import { FACT_SETS, MANAGER_MASKED, facts, normalizeSpaces, synthesisDto } from "./helpers";

const CLOSING_RUN = "Le niveau de risque est une estimation fondée sur des facteurs associés, non causale ; la décision reste humaine.";

describe("gabarits : règles communes sur tous les jeux d'agrégats", () => {
  for (const [name, f] of Object.entries(FACT_SETS)) {
    it(name, () => {
      const sentences = draftSentences(f);
      expect(sentences.length).toBeGreaterThanOrEqual(4);
      expect(sentences.length).toBeLessThanOrEqual(MAX_SENTENCES);
      for (const s of sentences) {
        expect(countWords(s), s).toBeLessThanOrEqual(MAX_WORDS);
        expect(s, s).toMatch(/^[A-ZÀ-ÖØ-Þ0-9]/);
        expect(s, s).toMatch(/\.$/);
        expect(s, s).not.toMatch(/undefined|null|NaN|\(s\)|\s{2}|\s[,.]/);
        expect(s, s).not.toMatch(/\d\.\d/);
      }
      const text = sentences.join(" ");
      // périmètre et période toujours dits ; pourcentages au format français (espace insécable)
      expect(sentences[0]).toContain(f.view === "RH" ? "de toute l'entreprise" : "de votre équipe");
      expect(sentences[0]).toMatch(/^Fin (janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre) \d{4}, /);
      expect(text).not.toMatch(/\d %|\d,\d%/);
      // chaque nombre du brouillon figure dans la charge utile : le texte par gabarits passe lui-même le contrôle
      const payload = buildPayload(f);
      const allowed = allowedNumbers(payload);
      expect(numbersIn(text).filter((n) => !allowed.has(n))).toEqual([]);
      expect(verifyGenerated(text, payload)).toEqual({ ok: true, sentences });
    });
  }
});

describe("gabarits : textes attendus", () => {
  it("RH, toute l'entreprise : effectif, mouvements, risque, absentéisme, points ouverts, mise en garde", () => {
    expect(draftSentences(facts()).map(normalizeSpaces)).toEqual([
      "Fin août 2026, l'effectif de toute l'entreprise compte 1 234 collaborateurs, en hausse de 12 depuis fin juillet 2026.",
      "Depuis fin juillet 2026, on compte 20 entrées et 8 sorties, dont 5 départs volontaires.",
      "24 collaborateurs sont en risque élevé : 6 nouveaux, 3 sortis de ce niveau depuis le calcul de juillet 2026.",
      "L'absentéisme hors santé augmente : 4,2 % en août 2026, contre 3,1 % en juillet 2026 (+1,1 pt).",
      "Il reste 5 alertes à traiter (dont 2 critiques), 7 recommandations à décider et 3 formations obligatoires en retard.",
      CLOSING_RUN,
    ]);
  });

  it("manager, petite population : sorties, absentéisme et heures supplémentaires masqués, sans valeur devinée", () => {
    const s = draftSentences(MANAGER_MASKED).map(normalizeSpaces);
    expect(s).toEqual([
      "Fin août 2026, l'effectif de votre équipe compte 3 collaborateurs, en baisse de 1 depuis fin juillet 2026.",
      "Depuis fin juillet 2026, aucune entrée n'est enregistrée ; les sorties restent masquées (groupe de moins de 5 personnes).",
      "Aucun collaborateur n'est plus en risque élevé : 1 en est sorti depuis le calcul de juillet 2026.",
      "L'absentéisme et les heures supplémentaires sont masqués pour un groupe de moins de 5 personnes.",
      "Aucune alerte, recommandation ou formation obligatoire en retard n'attend de traitement.",
      CLOSING_RUN,
    ]);
    expect(s.join(" ")).not.toMatch(/%|sorties?,|départs? volontaires?/);
  });

  it("manager : recommandations « en cours » (la RH décide), jamais « à décider »", () => {
    const text = draftSentences(facts({ view: "MANAGER" })).join(" ");
    expect(text).toContain("7 recommandations en cours");
    expect(text).not.toContain("à décider");
  });

  it("sans calcul publié : pas de niveau de risque commenté, mise en garde non causale", () => {
    const s = draftSentences(FACT_SETS["aucun calcul publié"]);
    expect(s[2]).toBe("Aucun calcul du risque de départ n'est encore publié pour cette période.");
    expect(s[5]).toBe("Ces chiffres décrivent des évolutions, sans lecture causale ; chaque décision reste humaine.");
  });

  it("premier calcul et élision des mois (d'avril, d'août)", () => {
    expect(draftSentences(FACT_SETS["premier calcul (avril)"])[2]).toBe(
      "24 collaborateurs sont en risque élevé au calcul d'avril 2026 ; aucun calcul précédent ne permet de comparer.",
    );
    expect(draftSentences(FACT_SETS["calcul précédent d'août"])[2]).toContain("depuis le calcul d'août 2026.");
    expect(draftSentences(FACT_SETS["changement d'année"])[1]).toContain("Depuis fin décembre 2026,");
  });

  it("singuliers, zéros et absentéisme stable ou en baisse", () => {
    const one = draftSentences(FACT_SETS.singuliers).map(normalizeSpaces);
    expect(one[0]).toBe("Fin août 2026, l'effectif de toute l'entreprise compte 1 collaborateur, stable depuis fin juillet 2026.");
    expect(one[1]).toBe("Depuis fin juillet 2026, on compte 1 entrée et 1 sortie, dont aucun départ volontaire.");
    expect(one[2]).toBe("1 collaborateur est en risque élevé : 1 nouveau, aucun sorti de ce niveau depuis le calcul de juillet 2026.");
    expect(one[3]).toBe("L'absentéisme hors santé atteint 5,0 % en août 2026.");
    expect(one[4]).toBe("Il reste 1 alerte à traiter (dont 1 critique), 1 recommandation à décider et 1 formation obligatoire en retard.");
    const zero = draftSentences(FACT_SETS["effectif nul"]);
    expect(zero[0]).toBe("Fin août 2026, l'effectif de votre équipe ne compte aucun collaborateur, contre 2 fin juillet 2026.");
    expect(zero[1]).toBe("Aucune entrée ni sortie n'est enregistrée depuis fin juillet 2026.");
    expect(zero[2]).toBe("Aucun collaborateur n'est en risque élevé au calcul d'août 2026, comme au calcul précédent.");
    expect(normalizeSpaces(draftSentences(FACT_SETS["absentéisme en baisse, sans alerte"])[3])).toBe(
      "L'absentéisme hors santé baisse : 2,1 % en août 2026, contre 3,4 % en juillet 2026 (−1,3 pt).",
    );
    expect(draftSentences(FACT_SETS["absentéisme stable, manager"])[3]).toMatch(/^L'absentéisme hors santé reste stable : /);
    expect(draftSentences(FACT_SETS["RH, absentéisme indisponible"])[3]).toBe("L'absentéisme hors santé n'est pas disponible pour août 2026.");
  });

  it("à partir du DTO de la synthèse : seuls les agrégats sont repris, jamais les listes nominatives ni les constats", () => {
    const n = draftNarrative(factsFromSynthesis(synthesisDto(), 5));
    expect(n).toMatchObject({ source: "GABARIT", model: null, fallback: null });
    const text = n.sentences.join(" ");
    for (const s of ["Ben Salah", "AJ-00421", "Finance", "4242"]) expect(text).not.toContain(s);
    expect(normalizeSpaces(text)).toContain("compte 48 collaborateurs, en hausse de 1 depuis fin juillet 2026.");
  });
});
