import { afterAll, describe, expect, it } from "vitest";
import { ROLES, type Role } from "@/db/schema";
import { buildIndex, sanitizeQuery, searchIn, type RagIndex } from "@/lib/rag/index";
import type { RagChunk, RagCorpus } from "@/lib/rag/types";

const ALL: Role[] = ["RH", "MANAGER", "ADMIN"];
const RH_MANAGER: Role[] = ["RH", "MANAGER"];

function chunk(id: string, title: string, text: string, roles: Role[]): RagChunk {
  return { id, title, text, roles, href: `/aide#${id}`, source: "test" };
}

function corpus(chunks: RagChunk[], sourcesHash = "fixture"): RagCorpus {
  return { version: 1, generatedAt: "2026-10-04T00:00:00.000Z", sourcesHash, chunks };
}

const FIXTURE = corpus([
  chunk("risque", "Niveau de risque", "Le niveau de risque est élevé, moyen ou faible. Il résume des facteurs associés.", RH_MANAGER),
  chunk("methode", "Méthode du score de départ", "Le modèle estime une probabilité de départ. Lecture réservée à la RH.", ["RH"]),
  chunk("rotation", "Taux de rotation", "Le taux rapporte les départs de l'année à l'effectif moyen.", RH_MANAGER),
  chunk("absences", "Absences du mois", "Les absences sont comptées en jours ouvrés.", RH_MANAGER),
  chunk("heures", "Heures supplémentaires", "Les heures supplémentaires dépassent la durée contractuelle.", RH_MANAGER),
  chunk("actions", "Suivre une action", "Une action se planifie depuis l'écran dédié.", RH_MANAGER),
  chunk("import", "Importer un export", "Le fichier est depose dans l'ecran Import puis controle.", ["RH"]),
  chunk("comptes", "Gérer les comptes", "L'administrateur crée les comptes et réinitialise les mots de passe.", ["ADMIN"]),
  chunk("charge", "Indicateur de charge", "Mesure synthétique de l'activité.", ALL),
  chunk("notes", "Notes diverses", "Cette note évoque la charge parmi d'autres sujets.", ALL),
]);

const indexes: RagIndex[] = [];
function index(c: RagCorpus = FIXTURE): RagIndex {
  const idx = buildIndex(c);
  indexes.push(idx);
  return idx;
}
afterAll(() => indexes.forEach((i) => i.db.close()));

const ids = (idx: RagIndex, q: string, role: Role, limit?: number) => searchIn(idx, q, role, limit).map((h) => h.chunk.id);

describe("sanitizeQuery", () => {
  it("ne garde que des mots entre guillemets, en minuscules, sans mots vides", () => {
    expect(sanitizeQuery("Le risque est-il élevé ?")).toBe('"risque"* OR "eleve"*');
    expect(sanitizeQuery("Que sont les absences ?")).toContain('"absence"*');
  });

  it("renvoie null si rien d'exploitable", () => {
    for (const q of ["", "   ", "?!*\"", "le la les de", "a b c"]) expect(sanitizeQuery(q)).toBeNull();
  });

  it("borne le nombre de termes", () => {
    const many = Array.from({ length: 40 }, (_, i) => `mot${i}`).join(" ");
    expect(sanitizeQuery(many)!.split(" OR ")).toHaveLength(8);
  });

  it("ajoute les synonymes métier", () => {
    const q = sanitizeQuery("Quel est le turnover ?")!;
    expect(q).toContain('"rotation"*');
    expect(q).toContain('"depart"*');
    expect(sanitizeQuery("Où voir les heures sup ?")).toContain('"heures supplementaire"*');
    expect(sanitizeQuery("Mot de passe oublié")).toContain('"connexion"*');
  });

  it("ne laisse passer aucune syntaxe FTS5", () => {
    const safe = /^"[\p{L}\p{N}]+( [\p{L}\p{N}]+)*"\*?( OR "[\p{L}\p{N}]+( [\p{L}\p{N}]+)*"\*?)*$/u;
    for (const q of ['risque" OR "x', "NEAR(a b)", "title:x", "-risque", "risque AND NOT eleve", "{title text}: risque", "^risque*", "a+b (c)"]) {
      const s = sanitizeQuery(q);
      if (s !== null) expect(s).toMatch(safe);
    }
  });
});

describe("searchIn", () => {
  const idx = index();

  it("ignore les accents dans les deux sens", () => {
    expect(ids(idx, "risque eleve", "RH")[0]).toBe("risque");
    expect(ids(idx, "ÉLEVÉ", "MANAGER")).toContain("risque");
    expect(ids(idx, "fichier déposé", "RH")[0]).toBe("import");
  });

  it("trouve un passage par synonyme", () => {
    expect(ids(idx, "turnover", "MANAGER")).toContain("rotation");
    expect(ids(idx, "absentéisme", "RH")).toContain("absences");
    expect(ids(idx, "heures sup", "MANAGER")[0]).toBe("heures");
    expect(ids(idx, "Où sont mes recommandations ?", "RH")[0]).toBe("actions");
  });

  it("donne plus de poids au titre", () => {
    expect(ids(idx, "charge", "ADMIN")).toEqual(["charge", "notes"]);
    const [first, second] = searchIn(idx, "charge", "ADMIN");
    expect(first.score).toBeGreaterThan(second.score);
    expect(second.score).toBeGreaterThan(0);
  });

  it("ne renvoie jamais un passage RH à l'ADMIN ni au manager", () => {
    expect(ids(idx, "probabilité méthode", "RH")).toContain("methode");
    expect(ids(idx, "probabilité méthode", "MANAGER")).not.toContain("methode");
    expect(ids(idx, "probabilité méthode", "ADMIN")).toEqual([]);
    expect(ids(idx, "fichier import", "MANAGER")).toEqual([]);
    expect(ids(idx, "comptes mot de passe", "RH")).not.toContain("comptes");
    expect(ids(idx, "comptes mot de passe", "ADMIN")[0]).toBe("comptes");
  });

  it("filtre par rôle avant la limite", () => {
    const rhOnly = Array.from({ length: 15 }, (_, i) => chunk(`rh${i}`, "Évaluation annuelle", "Évaluation annuelle : évaluation détaillée.", ["RH"]));
    const big = index(corpus([...rhOnly, chunk("mgr", "Divers", "Une évaluation parmi beaucoup d'autres sujets du quotidien.", ["MANAGER"])]));
    expect(ids(big, "évaluation", "MANAGER", 4)).toEqual(["mgr"]);
    expect(ids(big, "évaluation", "ADMIN", 4)).toEqual([]);
    expect(ids(big, "évaluation", "RH", 4)).toHaveLength(4);
  });

  it("respecte toujours les rôles autorisés", () => {
    for (const role of ROLES) {
      for (const q of ["risque", "départ", "comptes", "import", "charge", "action", "absences heures rotation"]) {
        for (const h of searchIn(idx, q, role, 10)) expect(h.chunk.roles).toContain(role);
      }
    }
  });

  it("borne la limite entre 1 et 10", () => {
    const wide = index(corpus(Array.from({ length: 30 }, (_, i) => chunk(`c${i}`, `Passage ${i}`, "Texte commun sur le risque.", ALL))));
    expect(searchIn(wide, "risque", "RH", 0)).toHaveLength(1);
    expect(searchIn(wide, "risque", "RH", -5)).toHaveLength(1);
    expect(searchIn(wide, "risque", "RH", 100)).toHaveLength(10);
    expect(searchIn(wide, "risque", "RH", Number.NaN)).toHaveLength(4);
    expect(searchIn(wide, "risque", "RH")).toHaveLength(4);
  });

  it("résiste aux questions piégées", () => {
    const traps = [
      '"', "*", "NEAR(a b)", "title:x", "-risque", "", " ", '"risque', "risque\"*", "risque OR", "AND", "NOT risque",
      "(risque", "risque)", "{title}: risque", "^risque", "risque + élevé", "élevé", "\u0000risque", "😀 risque",
      "'; DROP TABLE passages; --", "a".repeat(300), "risque ".repeat(60), "\"*:()-^{}+".repeat(30), "é".repeat(500),
    ];
    for (const q of traps) expect(() => searchIn(idx, q, "RH")).not.toThrow();
    expect(ids(idx, "-risque", "RH")[0]).toBe("risque");
    expect(ids(idx, "élevé", "RH")).toContain("risque");
    expect(searchIn(idx, "", "RH")).toEqual([]);
    expect(searchIn(idx, "risque", "INCONNU" as Role)).toEqual([]);
    expect(ids(idx, "risque", "RH")).toContain("risque");
  });
});

describe("performance", () => {
  it("cherche en moins de 50 ms dans ~2 000 passages", () => {
    let seed = 42;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const base = ("risque élevé départ absences rotation équipe fiche collaborateur recommandation action import compte " +
      "formation charge travail heures supplémentaires effectif salaire tableau bord alerte modèle données qualité " +
      "confidentialité journal audit entretien congé prévision indicateur taux mois année").split(" ");
    const vocab = [...base, ...Array.from({ length: 400 }, (_, i) => `terme${i.toString(36)}`)];
    const pick = (n: number) => Array.from({ length: n }, () => vocab[Math.floor(rand() * vocab.length)]).join(" ");
    const chunks = Array.from({ length: 2000 }, (_, i) =>
      chunk(`s${i}`, pick(3 + Math.floor(rand() * 4)), pick(40 + Math.floor(rand() * 60)), [ALL[i % 3], ...(i % 2 ? ["RH" as Role] : [])]),
    );
    const t0 = performance.now();
    const big = index(corpus(chunks, "perf"));
    const buildMs = performance.now() - t0;

    const questions = [
      "Quel est le risque élevé de départ ?", "absences de mon équipe", "turnover", "heures sup", "recommandation action",
      "Comment importer un fichier ?", "fiche collaborateur", "qualité des données", "charge de travail", "confidentialité",
    ];
    searchIn(big, "risque", "RH");
    // Meilleur temps sur 5 essais par question : le poste partagé (autres processus) ajoute des pauses sans rapport.
    const times: number[] = [];
    const best: number[] = [];
    for (const q of questions) {
      for (const role of ALL) {
        const runs: number[] = [];
        for (let k = 0; k < 5; k++) {
          const t = performance.now();
          const hits = searchIn(big, q, role);
          runs.push(performance.now() - t);
          expect(hits.length, `${q} / ${role}`).toBeGreaterThan(0);
          for (const h of hits) expect(h.chunk.roles).toContain(role);
        }
        times.push(...runs);
        best.push(Math.min(...runs));
      }
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)];
    const worstBest = Math.max(...best);
    console.info(
      `[rag] index 2000 passages : ${buildMs.toFixed(1)} ms ; recherche médiane ${median.toFixed(2)} ms, ` +
        `pire question ${worstBest.toFixed(2)} ms, max brut ${times[times.length - 1].toFixed(2)} ms (${times.length} requêtes)`,
    );
    expect(median).toBeLessThan(50);
    expect(worstBest).toBeLessThan(50);
  });
});
