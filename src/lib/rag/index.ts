import "server-only";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { ROLES, type Role } from "@/db/schema";
import { logger } from "@/lib/logger";
import { SYNONYM_GROUPS } from "./synonyms";
import { MAX_HITS, QUESTION_MAX, type RagChunk, type RagCorpus, type RagHit } from "./types";

// Recherche plein texte sur le corpus de documentation : index SQLite FTS5 en mémoire, construit au premier appel
// à partir de corpus.json et gardé en cache tant que son sourcesHash ne change pas.

const TITLE_WEIGHT = 5;
const MAX_TERMS = 8;
const MAX_SYNONYM_TERMS = 8;
const MAX_TERM_LENGTH = 40;
const MAX_LIMIT = 10;

const STOP_WORDS = new Set(
  (
    "a ai as au aux avec avez avoir avons alors aussi bonjour c ca ce ceci cela ces cet cette comme comment d dans de des " +
    "doit dois donc du elle elles en entre est et etre ete fait faire faut il ils j je l la le les leur leurs lui m ma mais " +
    "me merci mes moi mon n ne ni nos notre nous on ont ou par pas peut peux plait plus pour pourquoi puis qu quand que quel " +
    "quelle quelles quels qui quoi s sa sans se ses si son sont sur svp t ta te tes toi ton tous tout toute toutes tres tu " +
    "un une veux voudrais vos votre vous y"
  ).split(" "),
);

function words(text: string): string[] {
  return text.toLowerCase().normalize("NFD").replace(/\p{M}+/gu, "").match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** Pluriel simple : « absences » → « absence » (la recherche par préfixe retrouve les deux formes). */
function stem(word: string): string {
  return word.length >= 5 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
}

/** Chaîne FTS5 entre guillemets (lettres et chiffres seulement), préfixe sur le dernier mot s'il fait 3 lettres ou plus. */
function ftsTerm(phrase: string[]): string {
  const last = stem(phrase[phrase.length - 1]);
  return `"${[...phrase.slice(0, -1), last].join(" ")}"${last.length >= 3 ? "*" : ""}`;
}

type SynonymEntry = { words: string[]; stems: string[] };
let synonymGroups: SynonymEntry[][] | null = null;

function synonyms(): SynonymEntry[][] {
  synonymGroups ??= SYNONYM_GROUPS.map((group) =>
    group.map((entry) => words(entry)).filter((w) => w.length > 0).map((w) => ({ words: w, stems: w.map(stem) })),
  );
  return synonymGroups;
}

/** L'entrée apparaît dans la question ; son dernier mot (5 lettres ou plus) peut y être un début de mot (« import » → « importer »). */
function containsSequence(haystack: string[], needle: string[]): boolean {
  const last = needle.length - 1;
  const same = (w: string, j: number) => (j === last && needle[j].length >= 5 ? w.startsWith(needle[j]) : w === needle[j]);
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    if (needle.every((_, j) => same(haystack[i + j], j))) return true;
  }
  return false;
}

/** Transforme une question libre en requête FTS5 sûre (mots seulement), ou null si rien d'exploitable. */
export function sanitizeQuery(question: string): string | null {
  if (typeof question !== "string") return null;
  const all = words(question.slice(0, QUESTION_MAX)).map((w) => w.slice(0, MAX_TERM_LENGTH));
  const terms: string[] = [];
  for (const w of all) {
    if (terms.length >= MAX_TERMS) break;
    if (w.length < 2 || STOP_WORDS.has(w)) continue;
    const term = ftsTerm([w]);
    if (!terms.includes(term)) terms.push(term);
  }
  if (terms.length === 0) return null;

  const stems = all.map(stem);
  let added = 0;
  for (const group of synonyms()) {
    if (!group.some((entry) => containsSequence(stems, entry.stems))) continue;
    for (const entry of group) {
      const term = ftsTerm(entry.words);
      if (added < MAX_SYNONYM_TERMS && !terms.includes(term)) {
        terms.push(term);
        added++;
      }
    }
  }
  return terms.join(" OR ");
}

export type RagIndex = {
  db: Database.Database;
  chunks: RagChunk[];
  sourcesHash: string;
  search: Database.Statement<[string, string, number], { rowid: number; score: number }>;
};

/** Index FTS5 en mémoire d'un corpus (rowid = position du passage dans corpus.chunks). */
export function buildIndex(corpus: RagCorpus): RagIndex {
  const db = new Database(":memory:");
  db.exec(
    "CREATE VIRTUAL TABLE passages USING fts5(title, text, roles UNINDEXED, tokenize = 'unicode61 remove_diacritics 2')",
  );
  const insert = db.prepare<[number, string, string, string]>("INSERT INTO passages (rowid, title, text, roles) VALUES (?, ?, ?, ?)");
  db.transaction(() => {
    corpus.chunks.forEach((c, i) => {
      const roles = c.roles.filter((r) => (ROLES as readonly string[]).includes(r));
      insert.run(i, c.title, c.text, `|${roles.join("|")}|`);
    });
  })();
  // Filtre par rôle dans la requête, avant le LIMIT : un passage non autorisé ne prend jamais la place d'un autre.
  const search = db.prepare<[string, string, number], { rowid: number; score: number }>(
    `SELECT rowid, bm25(passages, ${TITLE_WEIGHT}, 1.0) AS score FROM passages
     WHERE passages MATCH ? AND instr(roles, ?) > 0 ORDER BY score LIMIT ?`,
  );
  return { db, chunks: corpus.chunks, sourcesHash: corpus.sourcesHash, search };
}

/** Recherche dans un index donné. score = -bm25 : positif, plus il est grand, plus le passage est pertinent. */
export function searchIn(index: RagIndex, question: string, role: Role, limit: number = MAX_HITS): RagHit[] {
  if (!(ROLES as readonly string[]).includes(role)) return [];
  const query = sanitizeQuery(question);
  if (!query) return [];
  const n = Number.isFinite(limit) ? Math.min(MAX_LIMIT, Math.max(1, Math.trunc(limit))) : MAX_HITS;
  return index.search.all(query, `|${role}|`, n).map((row) => ({ chunk: index.chunks[row.rowid], score: -row.score }));
}

function corpusFile(): string {
  return path.join(/*turbopackIgnore: true*/ process.cwd(), "src", "lib", "rag", "corpus.json");
}

function isChunk(c: unknown): c is RagChunk {
  const o = c as Partial<RagChunk> | null;
  return (
    !!o &&
    typeof o.id === "string" &&
    typeof o.title === "string" &&
    typeof o.text === "string" &&
    typeof o.href === "string" &&
    typeof o.source === "string" &&
    Array.isArray(o.roles) &&
    o.roles.length > 0
  );
}

function readCorpus(file: string): RagCorpus | null {
  try {
    const raw = JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ file, "utf8")) as Partial<RagCorpus>;
    if (typeof raw.sourcesHash !== "string" || !Array.isArray(raw.chunks)) throw new Error("format inattendu");
    return { version: Number(raw.version), generatedAt: String(raw.generatedAt), sourcesHash: raw.sourcesHash, chunks: raw.chunks.filter(isChunk) };
  } catch (err) {
    logger.warn({ err, file }, "Corpus de l'assistant illisible (npm run rag:index)");
    return null;
  }
}

const g = globalThis as unknown as { __paRagIndex?: { fileKey: string; index: RagIndex | null } };

function currentIndex(): RagIndex | null {
  const file = corpusFile();
  let fileKey = "absent";
  try {
    const st = fs.statSync(/*turbopackIgnore: true*/ file);
    fileKey = `${st.mtimeMs}:${st.size}`;
  } catch {}
  const cached = g.__paRagIndex;
  if (cached && cached.fileKey === fileKey) return cached.index;

  let index = cached?.index ?? null;
  if (fileKey === "absent") {
    logger.warn({ file }, "Corpus de l'assistant absent (npm run rag:index)");
  } else {
    const corpus = readCorpus(file);
    if (corpus && corpus.sourcesHash !== index?.sourcesHash) {
      index?.db.close();
      index = buildIndex(corpus);
    }
  }
  g.__paRagIndex = { fileKey, index };
  return index;
}

/** Passages les plus pertinents lisibles par ce rôle, du plus au moins pertinent. */
export function searchCorpus(question: string, role: Role, limit: number = MAX_HITS): RagHit[] {
  const index = currentIndex();
  return index ? searchIn(index, question, role, limit) : [];
}
