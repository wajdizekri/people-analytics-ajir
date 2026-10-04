import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Role } from "@/db/schema";
import { FAQ, GLOSSARY, KPIS, SECTIONS } from "@/lib/help/content";
import { TERMS } from "@/lib/help/terms";
import { DOC_SOURCES, HELP_SOURCES, MANAGER_RESERVED, hashSources } from "@/lib/rag/sources";
import type { RagCorpus } from "@/lib/rag/types";

const ROOT = path.resolve(__dirname, "..", "..");
const corpus = JSON.parse(fs.readFileSync(path.join(ROOT, "src/lib/rag/corpus.json"), "utf8")) as RagCorpus;
const ROLES: Role[] = ["ADMIN", "RH", "MANAGER"];
const sectionRoles = new Map(SECTIONS.map((s) => [s.id as string, s.roles ?? ROLES]));
const allows = (entry: readonly Role[] | undefined, roles: Role[]) => roles.every((r) => !entry || entry.includes(r));

describe("corpus de l'assistant d'aide", () => {
  it("est à jour par rapport à ses sources", () => {
    const hash = hashSources((f) => fs.readFileSync(path.join(ROOT, f), "utf8"));
    expect(corpus.sourcesHash, "src/lib/rag/corpus.json est périmé : relancez npm run rag:index").toBe(hash);
    expect(corpus.version).toBe(1);
    expect(Number.isNaN(Date.parse(corpus.generatedAt))).toBe(false);
  });

  it("couvre l'aide intégrée et chaque document du manifeste", () => {
    const sources = new Set(corpus.chunks.map((c) => c.source));
    for (const s of [...HELP_SOURCES.map((h) => h.source), ...DOC_SOURCES.map((d) => d.path)]) expect(sources, s).toContain(s);
    for (const role of ROLES) expect(corpus.chunks.filter((c) => c.roles.includes(role)).length, role).toBeGreaterThan(30);
  });

  it("a des passages bien formés : id unique, rôles non vides, lien vers une rubrique d'aide visible, taille raisonnable", () => {
    expect(new Set(corpus.chunks.map((c) => c.id)).size).toBe(corpus.chunks.length);
    for (const c of corpus.chunks) {
      expect(c.title.trim(), c.id).not.toBe("");
      expect(c.roles.length, c.id).toBeGreaterThan(0);
      expect(new Set(c.roles).size, c.id).toBe(c.roles.length);
      for (const r of c.roles) expect(ROLES, c.id).toContain(r);
      expect(c.href, c.id).toMatch(/^\/aide#[a-z-]+$/);
      const visible = sectionRoles.get(c.href.slice("/aide#".length));
      expect(visible, `${c.id} : rubrique inconnue`).toBeDefined();
      for (const r of c.roles) expect(visible, `${c.id} : rubrique invisible pour ${r}`).toContain(r);
      expect(c.text.length, c.id).toBeGreaterThanOrEqual(20);
      expect(c.text.length, c.id).toBeLessThanOrEqual(1200);
      expect(c.text, c.id).not.toMatch(/[#*`|]{2,}|\]\(/);
    }
  });

  it("reprend les rôles des entrées de l'aide sans jamais les élargir", () => {
    for (const c of corpus.chunks) {
      if (c.source === "help:glossaire") expect(GLOSSARY.some((g) => g.term === c.title && allows(g.roles, c.roles)), c.id).toBe(true);
      if (c.source === "help:faq") expect(FAQ.some((f) => f.q === c.title && f.a === c.text && allows(f.roles, c.roles)), c.id).toBe(true);
      if (c.source === "help:indicateurs") expect(KPIS.some((k) => k.label === c.title && allows(k.roles, c.roles)), c.id).toBe(true);
      if (c.source === "help:termes") expect(Object.values(TERMS).some((t) => t.label === c.title && allows("roles" in t ? t.roles : undefined, c.roles)), c.id).toBe(true);
    }
  });

  it("ne donne à l'ADMIN aucun passage d'une source réservée à la RH ou au pilotage", () => {
    const admin = corpus.chunks.filter((c) => c.roles.includes("ADMIN"));
    const rhOnly = new Set<string>([...DOC_SOURCES.filter((d) => !d.roles.includes("ADMIN") && !d.rules?.some((r) => r.roles?.includes("ADMIN"))).map((d) => d.path), "help:indicateurs"]);
    for (const c of admin) expect(rhOnly.has(c.source), c.id).toBe(false);
    expect(admin.some((c) => c.source.startsWith("docs/RESULTATS_") && c.source !== "docs/RESULTATS_ML.md")).toBe(false);
    for (const c of admin.filter((c) => c.source === "docs/DICTIONNAIRE.md")) expect(c.title, c.id).toMatch(/^(Paramètres|Contrôles qualité)/);
  });

  it("ne montre au manager ni le lift ni un sujet réservé à la RH", () => {
    const manager = corpus.chunks.filter((c) => c.roles.includes("MANAGER"));
    for (const c of manager) expect(`${c.title} ${c.text}`, c.id).not.toMatch(/lift/i);
    const guarded = new Set(DOC_SOURCES.filter((d) => d.managerGuard).map((d) => d.path));
    for (const c of manager.filter((c) => guarded.has(c.source))) expect(c.text, c.id).not.toMatch(MANAGER_RESERVED);
    for (const c of manager) expect(["docs/EXPLOITATION.md", "docs/INSTALLATION.md"]).not.toContain(c.source);
    expect(manager.some((c) => c.source.startsWith("docs/RESULTATS_"))).toBe(false);
  });

  it("ne contient ni matricule ni chiffre de la base de démonstration", () => {
    for (const c of corpus.chunks) {
      expect(`${c.title} ${c.text}`, c.id).not.toMatch(/\bM\d{4,}/);
      expect(c.text, c.id).not.toMatch(/base de démonstration|base de démo\b|copie de travail|mixte_medium|ground_truth/i);
    }
  });
});
