import { afterAll, describe, expect, it } from "vitest";
import type { Role } from "@/db/schema";
import { buildIndex, searchIn } from "@/lib/rag/index";
import type { RagCorpus } from "@/lib/rag/types";
import corpus from "@/lib/rag/corpus.json";

// Recherche sur le corpus réel (src/lib/rag/corpus.json) : questions types par rôle et cloisons entre rôles.
const index = buildIndex(corpus as RagCorpus);
afterAll(() => index.db.close());

const QUESTIONS: Record<Role, string[]> = {
  RH: ["Comment est calculé le niveau de risque ?", "Que faire face à une alerte de dérive ?", "Que veut dire fourchette calibrée ?"],
  MANAGER: ["Que veut dire le niveau de risque de mon équipe ?", "Comment lire l'absentéisme ?", "Que faire d'une recommandation ?"],
  ADMIN: ["Comment importer un export AJIR ?", "Comment créer un compte utilisateur ?", "Comment restaurer une sauvegarde ?"],
};

describe("assistant d'aide : corpus réel", () => {
  for (const role of Object.keys(QUESTIONS) as Role[]) {
    it(`${role} : chaque question type trouve au moins un passage, lien interne vers l'aide`, () => {
      for (const q of QUESTIONS[role]) {
        const hits = searchIn(index, q, role);
        expect(hits.length, q).toBeGreaterThan(0);
        for (const h of hits) expect(h.chunk.href.startsWith("/aide")).toBe(true);
      }
    });
  }

  it("cloisons : un passage renvoyé est toujours lisible par le rôle qui demande", () => {
    const probes = ["salaire masse salariale", "probabilité de départ", "lift", "importer un export", "mot de passe", "niveau de risque", "Bradford"];
    for (const role of ["RH", "MANAGER", "ADMIN"] as Role[])
      for (const q of probes) for (const h of searchIn(index, q, role, 10)) expect(h.chunk.roles, `${role} / ${q} / ${h.chunk.id}`).toContain(role);
  });

  it("le manager ne lit jamais « lift » ; aucun matricule dans les passages renvoyés", () => {
    for (const q of ["lift", "Qu'est-ce que le lift du modèle ?", "niveau moyen"])
      for (const h of searchIn(index, q, "MANAGER", 10)) expect(`${h.chunk.title} ${h.chunk.text}`).not.toMatch(/\blift\b/i);
    for (const role of ["RH", "MANAGER", "ADMIN"] as Role[])
      for (const h of searchIn(index, "collaborateur matricule fiche", role, 10)) expect(h.chunk.text).not.toMatch(/\bM\d{4,}\b/);
  });
});
