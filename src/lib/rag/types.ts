import type { Role } from "@/db/schema";

// Contrat commun de l'assistant d'aide (RAG sur la documentation, jamais sur les données RH) : docs/qa/CHANTIER_RAG.md.

/** Passage de documentation indexé (src/lib/rag/corpus.json, produit par `npm run rag:index`). */
export type RagChunk = {
  id: string;
  /** Titre lisible du passage (« Niveau de risque », « Importer un export AJIR »…). */
  title: string;
  text: string;
  /** Rôles autorisés à lire ce passage ; jamais vide. */
  roles: Role[];
  /** Lien interne vers la rubrique d'aide correspondante (« /aide#glossaire »…). */
  href: string;
  /** Origine : fichier ou rubrique source (« help:faq », « docs/DICTIONNAIRE.md »…). */
  source: string;
};

export type RagCorpus = { version: number; generatedAt: string; sourcesHash: string; chunks: RagChunk[] };

export type RagHit = { chunk: RagChunk; score: number };

export type AssistantSource = { title: string; href: string };

/** Réponse renvoyée au navigateur. EXTRAIT : sans IA générative (défaut, hors ligne) ; IA : reformulation vérifiée. */
export type AssistantAnswer = {
  mode: "EXTRAIT" | "IA" | "AUCUN";
  answer: string;
  sources: AssistantSource[];
  /** Mention affichée sous la réponse (modèle utilisé, repli, limite). */
  notice?: string;
};

export const QUESTION_MIN = 3;
export const QUESTION_MAX = 300;
export const MAX_HITS = 4;
