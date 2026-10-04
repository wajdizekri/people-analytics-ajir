import { describe, expect, it } from "vitest";
import { allowedNumbers, buildPayload, numbersIn, verifyGenerated } from "@/lib/ai/narrative";
import { facts } from "./helpers";

// Contrôle du texte généré avant affichage : tout nombre absent de la charge utile, toute formulation causale ou tout
// écart de forme entraîne le refus (donc le repli sur les phrases types).
const payload = buildPayload(facts());
const GOOD =
  "Pour toute l'entreprise, l'effectif atteint 1 234 collaborateurs fin août 2026, soit 12 de plus qu'en juillet 2026. " +
  "On relève 20 entrées et 8 sorties, dont 5 départs volontaires. " +
  "24 collaborateurs sont en risque élevé, dont 6 nouveaux. " +
  "L'absentéisme hors santé passe de 3,1 % à 4,2 %, soit +1,1 pt. " +
  "Il reste 5 alertes, dont 2 critiques, et 7 recommandations à décider. " +
  "Ce niveau de risque est une estimation fondée sur des facteurs associés ; la décision vous revient.";

const reason = (text: string) => {
  const v = verifyGenerated(text, payload);
  return v.ok ? "ok" : v.reason;
};

describe("contrôle des nombres du texte généré", () => {
  it("nombres extraits au format français (milliers, décimales, dates) et normalisés", () => {
    expect(numbersIn("1 234 collaborateurs, 1\u202f234, 4,2\u00a0%, +1,1 pt, au 31/08/2026, 2,0 h")).toEqual(["1234", "1234", "4.2", "1.1", "31", "8", "2026", "2"]);
    const allowed = allowedNumbers(payload);
    for (const n of ["1234", "1222", "12", "20", "8", "5", "24", "6", "3", "4.2", "3.1", "1.1", "2.5", "2", "7", "1", "31", "2026"]) expect(allowed.has(n), n).toBe(true);
    expect(allowed.has("13")).toBe(false);
  });

  it("texte fidèle accepté, découpé en phrases", () => {
    const v = verifyGenerated(GOOD, payload);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.sentences).toHaveLength(6);
  });

  it("nombre inventé, calculé ou arrondi : refusé", () => {
    expect(reason(GOOD.replace("24 collaborateurs", "25 collaborateurs"))).toBe("nombre_non_fourni");
    // différence calculée par le modèle (4,2 − 3,1 = 1,1 serait fourni ; 35 % d'écart ne l'est pas)
    expect(reason(GOOD.replace("soit +1,1 pt", "soit une hausse de 35 %"))).toBe("nombre_non_fourni");
    expect(reason(GOOD.replace("4,2 %", "4,3 %"))).toBe("nombre_non_fourni");
    expect(reason(GOOD.replace("1 234", "1 235"))).toBe("nombre_non_fourni");
  });

  it("nombre écrit en lettres ou au format anglais : refusé", () => {
    expect(reason(GOOD.replace("20 entrées", "vingt entrées"))).toBe("nombre_en_lettres");
    expect(reason(GOOD.replace("dont 6 nouveaux", "dont la moitié de nouveaux"))).toBe("nombre_en_lettres");
    expect(reason(GOOD.replace("4,2 %", "4.2 %"))).toBe("format_nombre");
    // mots qui contiennent un nombre sans en être un : acceptés
    expect(reason(GOOD.replace("Il reste", "En septembre, il reste").replace("la décision vous revient", "le pourcentage par famille n'est pas cité"))).toBe("ok");
  });

  it("lecture causale refusée ; « non causale » et « facteurs associés » permis", () => {
    expect(reason(GOOD.replace("dont 6 nouveaux", "à cause de la charge"))).toBe("vocabulaire_causal");
    expect(reason(GOOD.replace("dont 5 départs volontaires", "ce qui explique 5 départs volontaires"))).toBe("vocabulaire_causal");
    expect(reason(GOOD.replace("la décision vous revient", "des départs pourraient être évités"))).toBe("vocabulaire_causal");
    expect(reason(GOOD.replace("une estimation", "une estimation non causale"))).toBe("ok");
  });

  it("forme : vide, liste, titre, lien, phrase tronquée, trop de phrases, phrase trop longue", () => {
    expect(reason("   ")).toBe("vide");
    expect(reason(`- ${GOOD}`)).toBe("mise_en_forme");
    expect(reason(`**Synthèse** ${GOOD}`)).toBe("mise_en_forme");
    expect(reason(`${GOOD} Voir https://exemple.org.`)).toBe("mise_en_forme");
    expect(reason(GOOD.slice(0, -1))).toBe("phrase_incomplete");
    expect(reason(`${GOOD} Les chiffres sont arrêtés fin août 2026.`)).toBe("trop_de_phrases");
    expect(reason(GOOD.replace("dont 6 nouveaux.", "dont 6 nouveaux, ce qui demande une attention suivie de la part de la direction des ressources humaines."))).toBe(
      "phrase_trop_longue",
    );
  });
});
