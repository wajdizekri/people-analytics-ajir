import fs from "node:fs";
import path from "node:path";
import type { Role } from "../src/db/schema";
import { FAQ, GLOSSARY, KPIS, ROLE_SCOPE, SCREENS, SECTIONS, START, factorGroups, type SectionId } from "../src/lib/help/content";
import { TERMS, type TermId } from "../src/lib/help/terms";
import { DEMO_DROP, DOC_SOURCES, HELP_SOURCES, MANAGER_RESERVED, TERM_PLACEMENT, hashSources, type DocRule, type DocSource, type HelpSource } from "../src/lib/rag/sources";
import type { RagChunk, RagCorpus } from "../src/lib/rag/types";

// Construit src/lib/rag/corpus.json (assistant d'aide) à partir du manifeste src/lib/rag/sources.ts.
// Usage : npm run rag:index. Sortie déterministe : seul generatedAt change, et seulement si les sources ont changé.

const USAGE = "Usage : npx tsx scripts/rag-index.ts [--check]   (--check : échoue si corpus.json n'est pas à jour)";
export const CORPUS_FILE = "src/lib/rag/corpus.json";
const ROLE_ORDER: Role[] = ["ADMIN", "RH", "MANAGER"];
const CHUNK_MAX = 900;
const CHUNK_HARD_MAX = 1100;
const TAIL_MIN = 250;
const CODE_LANGS = new Set(["powershell", "ps1", "pwsh", "sh", "bash", "shell", "cmd", "console"]);

type Draft = { source: string; anchor: string; title: string; text: string; roles: Role[]; section: SectionId };
type Unit = { text: string; roles: Role[] };

const SECTION_ROLES = new Map<SectionId, readonly Role[]>(SECTIONS.map((s) => [s.id, s.roles ?? ROLE_ORDER]));

const sortRoles = (roles: Iterable<Role>) => {
  const set = new Set(roles);
  return ROLE_ORDER.filter((r) => set.has(r));
};
const rolesKey = (roles: readonly Role[]) => roles.join(",");

/** Rôles d'une entrée (absent = tous), restreints à la rubrique de /aide et au plafond éventuel. */
function effectiveRoles(entry: readonly Role[] | undefined, section: SectionId, cap?: readonly Role[]): Role[] {
  const sec = SECTION_ROLES.get(section);
  if (!sec) throw new Error(`Rubrique d'aide inconnue : ${section}`);
  return ROLE_ORDER.filter((r) => (!entry || entry.includes(r)) && sec.includes(r) && (!cap || cap.includes(r)));
}

export function slug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

const clean = (s: string) => s.replace(/[ \t\r\n]+/g, " ").trim();
const endSentence = (s: string) => (/[.!?…:;]$/.test(s) ? s : `${s}.`);

/** Garde du manager : jamais le mot « lift » ni, pour les sources sensibles, un sujet réservé à la RH. */
function guard(roles: Role[], text: string, strict: boolean): Role[] {
  if (!roles.includes("MANAGER")) return roles;
  if (/lift/i.test(text) || (strict && MANAGER_RESERVED.test(text))) return roles.filter((r) => r !== "MANAGER");
  return roles;
}

// ---------- Aide intégrée ----------

/** Fusionne les variantes identiques produites rôle par rôle (libellés et contenus qui dépendent du rôle). */
function mergeVariants(drafts: Draft[]): Draft[] {
  const out: Draft[] = [];
  const byKey = new Map<string, Draft>();
  for (const d of drafts) {
    const key = [d.anchor, d.title, d.text, d.section].join("\u0000");
    const prev = byKey.get(key);
    if (prev) prev.roles = sortRoles([...prev.roles, ...d.roles]);
    else {
      const copy = { ...d, roles: [...d.roles] };
      byKey.set(key, copy);
      out.push(copy);
    }
  }
  return out;
}

function helpDrafts(h: HelpSource): Draft[] {
  const d = (anchor: string, title: string, text: string, roles: Role[], section: SectionId = h.section): Draft => ({
    source: h.source,
    anchor,
    title: clean(title),
    text: clean(text),
    roles,
    section,
  });
  switch (h.kind) {
    case "START":
      return ROLE_ORDER.map((role) =>
        d(
          `etapes-${role.toLowerCase()}`,
          "Par où commencer ?",
          START[role].map((s, i) => `Étape ${i + 1} : ${endSentence(s.title)} ${endSentence(s.text)} Écran : ${s.cta} (${s.href}).`).join(" "),
          effectiveRoles([role], h.section),
        ),
      );
    case "FAQ":
      return FAQ.map((f) => d(slug(f.q), f.q, f.a, effectiveRoles(f.roles, h.section)));
    case "SCREENS":
      return mergeVariants(
        SCREENS.flatMap((s) =>
          ROLE_ORDER.map((role) => {
            const label = s.labels?.[role] ?? s.label;
            return d(slug(s.href), `Écran ${label}`, `Écran « ${label} » (${s.href}) : ${endSentence(s.purpose)}`, effectiveRoles(s.roles, h.section).filter((r) => r === role));
          }),
        ),
      );
    case "KPIS":
      return KPIS.map((k) =>
        d(
          k.id,
          k.label,
          [
            endSentence(k.definition),
            `Calcul : ${endSentence(k.formula)}`,
            `Périmètre : ${endSentence(k.scope)}`,
            k.exclusions ? `Exclusions : ${endSentence(k.exclusions)}` : "",
            `Unité : ${endSentence(k.unit)}`,
            `Période : ${endSentence(k.period)}`,
          ].join(" "),
          effectiveRoles(k.roles, h.section),
        ),
      );
    case "FACTORS":
      return mergeVariants(
        ROLE_ORDER.flatMap((role) =>
          factorGroups(role).map((g) =>
            d(
              `${slug(g.code)}-${role === "MANAGER" ? "manager" : "rh"}`,
              `Facteurs associés : ${g.label}`,
              [
                `Famille de facteurs « ${g.label} » : ${endSentence(g.summary)}`,
                g.variables.length ? `Variables utilisées : ${g.variables.map((v) => endSentence(v.text)).join(" ")}` : "",
              ].join(" "),
              effectiveRoles([role], h.section),
            ),
          ),
        ),
      );
    case "GLOSSARY":
      return GLOSSARY.map((g) => d(slug(g.term), g.term, g.definition, effectiveRoles(g.roles, h.section)));
    case "TERMS":
      return (Object.keys(TERMS) as TermId[]).map((id) => {
        const place = TERM_PLACEMENT[id];
        if (!place) throw new Error(`Terme « ${id} » sans rubrique dans TERM_PLACEMENT (src/lib/rag/sources.ts).`);
        const t = TERMS[id] as { label: string; text: string; roles?: readonly Role[] };
        return d(id, t.label, t.text, effectiveRoles(t.roles, place.section, place.cap), place.section);
      });
    case "ROLE_SCOPE":
      return ROLE_ORDER.map((role) =>
        d(
          `perimetre-${role.toLowerCase()}`,
          "Ce que votre rôle voit",
          `Vous voyez : ${ROLE_SCOPE[role].sees.join(" ")} Vous ne voyez pas : ${ROLE_SCOPE[role].neverSees.join(" ")}`,
          effectiveRoles([role], h.section),
        ),
      );
  }
}

// Une définition de terms.ts identique (même libellé, mêmes rôles) à un terme du glossaire ou à un indicateur est déjà couverte.
function dropDuplicateTerms(drafts: Draft[]): Draft[] {
  const seen = new Set(drafts.filter((d) => d.source !== "help:termes").map((d) => `${slug(d.title)}|${rolesKey(d.roles)}`));
  return drafts.filter((d) => d.source !== "help:termes" || !seen.has(`${slug(d.title)}|${rolesKey(d.roles)}`));
}

// ---------- Documents Markdown ----------

type MdSection = { path: string[]; level: number; lines: string[] };

const FENCE = /^\s*(```|~~~)\s*([\w-]*)/;
const ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/;
const TABLE = /^\s*\|/;

function parseSections(md: string): MdSection[] {
  const out: MdSection[] = [];
  const stack: { level: number; text: string }[] = [];
  let cur: MdSection = { path: [], level: 0, lines: [] };
  let inFence = false;
  for (const line of md.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n")) {
    const isFence = FENCE.test(line);
    const h = !inFence && !isFence ? /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line) : null;
    if (isFence) inFence = !inFence;
    if (h) {
      out.push(cur);
      const level = h[1].length;
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ level, text: h[2] });
      cur = { path: stack.map((s) => s.text), level, lines: [] };
    } else cur.lines.push(line);
  }
  out.push(cur);
  return out.filter((s) => s.level > 0);
}

/** Markdown en ligne → texte simple (liens, emphase, code). */
export function flatten(md: string): string {
  const code: string[] = [];
  let s = md.replace(/`([^`]*)`/g, (_, c: string) => `\u0001${code.push(c) - 1}\u0002`);
  s = s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<\/?(?:br|sup|sub|span|div|details|summary|a|b|i|em|strong|p)\b[^<>]*>/gi, " ")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(^|[^\w*])\*([^*\s][^*]*?)\*(?=[^\w*]|$)/g, "$1$2")
    .replace(/(^|[^\w])_([^_\s][^_]*?)_(?=[^\w]|$)/g, "$1$2")
    .replace(/\\([|*_`[\]()#])/g, "$1");
  s = s.replace(/\u0001(\d+)\u0002/g, (_, i: string) => code[Number(i)]);
  return clean(s);
}

const headingText = (h: string) => flatten(h).replace(/^\d+(?:\.\d+)*(?:\s+bis)?\.?\s+/, "");

/** Phrases (sans couper avant une minuscule, un chiffre ou une abréviation courante). */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+(?=[«"(A-ZÀ-ÖØ-ÞŒ])/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Coupe une phrase trop longue sur « ; », puis « , », puis entre deux mots. */
function splitLong(s: string, max: number): string[] {
  if (s.length <= max) return [s];
  for (const sep of ["; ", ", ", " "]) {
    const parts = s.split(sep);
    if (parts.length < 2) continue;
    const out: string[] = [];
    let cur = "";
    for (const p of parts) {
      const next = cur ? `${cur}${sep}${p}` : p;
      if (cur && next.length > max) {
        out.push(cur);
        cur = p;
      } else cur = next;
    }
    if (cur) out.push(cur);
    if (out.every((o) => o.length <= max)) return out;
  }
  return [s.slice(0, max)];
}

function splitCells(row: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inCode = false;
  const body = row.trim().replace(/^\|/, "").replace(/\|$/, "");
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "\\" && body[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (c === "`") {
      inCode = !inCode;
      cur += c;
    } else if (c === "|" && !inCode) {
      cells.push(cur);
      cur = "";
    } else cur += c;
  }
  cells.push(cur);
  return cells.map((c) => flatten(c));
}

function rolesFromCell(cell: string): Role[] {
  const out: Role[] = [];
  if (/\bADMIN\b/i.test(cell)) out.push("ADMIN");
  if (/\bRH\b/.test(cell)) out.push("RH");
  if (/manager/i.test(cell)) out.push("MANAGER");
  return out;
}

type Cfg = { include: boolean; roles: readonly Role[]; section: SectionId; rolesColumn?: string; dropColumns: readonly string[] };

function sectionConfig(src: DocSource, sec: MdSection): Cfg {
  let cfg: Cfg = { include: src.include, roles: src.roles, section: src.section, dropColumns: [] };
  if (sec.level === 1) return { ...cfg, include: !!src.intro };
  for (const h of sec.path.slice(1)) {
    for (const r of (src.rules ?? []).filter((rule: DocRule) => rule.heading.test(h))) {
      cfg = {
        include: r.include ?? cfg.include,
        roles: r.roles ?? cfg.roles,
        section: r.section ?? cfg.section,
        rolesColumn: r.rolesColumn ?? cfg.rolesColumn,
        dropColumns: r.dropColumns ?? cfg.dropColumns,
      };
    }
  }
  return cfg;
}

function sectionUnits(src: DocSource, sec: MdSection, cfg: Cfg): Unit[] {
  const units: Unit[] = [];
  const drops = [...DEMO_DROP, ...(src.drop ?? [])];
  const dropped = (s: string) => drops.some((re) => re.test(s));
  const push = (text: string, roles: readonly Role[] = cfg.roles) => {
    const r = guard(sortRoles(roles), text, !!src.managerGuard);
    if (text && r.length) units.push({ text, roles: r });
  };
  const prose = (raw: string) => {
    let text = flatten(raw);
    for (const re of src.strip ?? []) text = text.replace(re, "");
    const kept = sentences(clean(text)).filter((s) => !dropped(s));
    if (!kept.length) return;
    const joined = endSentence(kept.join(" "));
    if (joined.length <= CHUNK_MAX) return push(joined);
    for (const s of kept) for (const part of splitLong(s, CHUNK_MAX)) push(endSentence(part));
  };

  const lines = sec.lines;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      for (i++; i < lines.length && !FENCE.test(lines[i]); i++) body.push(lines[i]);
      i++;
      if (!CODE_LANGS.has(fence[2].toLowerCase())) continue;
      const cmds = body
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => (l.startsWith("#") ? l.replace(/^#+\s*/, "") : l.replace(/\s+#\s+(.+)$/, " ($1)")))
        .filter((l) => !dropped(l));
      for (const part of splitLong(cmds.join(" ; "), CHUNK_MAX - 20)) push(endSentence(`Commandes : ${part}`));
      continue;
    }
    if (TABLE.test(line)) {
      const rows: string[][] = [];
      for (; i < lines.length && TABLE.test(lines[i]); i++) {
        if (/^\s*\|?\s*:?-{3,}/.test(lines[i])) continue;
        rows.push(splitCells(lines[i]));
      }
      const [header, ...body] = rows;
      if (!header) continue;
      const keep = header.map((h) => !cfg.dropColumns.includes(h));
      const rolesCol = cfg.rolesColumn ? header.indexOf(cfg.rolesColumn) : -1;
      for (const cells of body) {
        const pairs = header.map((h, k) => [h, cells[k] ?? ""] as const).filter(([, v], k) => keep[k] && v && v !== "—" && v !== "-");
        if (!pairs.length) continue;
        const [[, key], ...rest] = pairs;
        const text = endSentence(rest.length === 1 && header.filter((_, k) => keep[k]).length === 2 ? `${key} : ${rest[0][1]}` : `${key} — ${rest.map(([h, v]) => `${h} : ${v}`).join(" ; ")}`);
        if (dropped(text)) continue;
        const roles = rolesCol >= 0 ? cfg.roles.filter((r) => rolesFromCell(cells[rolesCol] ?? "").includes(r)) : cfg.roles;
        for (const part of splitLong(text, CHUNK_MAX)) push(endSentence(part), roles);
      }
      continue;
    }
    const block = [line.replace(ITEM, "").replace(/^\s*>\s?/, "")];
    for (i++; i < lines.length; i++) {
      const l = lines[i];
      if (!l.trim() || ITEM.test(l) || TABLE.test(l) || FENCE.test(l)) break;
      block.push(l.replace(/^\s*>\s?/, ""));
    }
    prose(block.join(" "));
  }
  return units;
}

/** Regroupe des unités en passages de taille voisine (CHUNK_MAX au plus), sans jamais couper une unité. */
function pack(texts: string[]): string[] {
  const total = texts.reduce((n, t) => n + t.length + 1, -1);
  const target = total / Math.max(1, Math.ceil(total / CHUNK_MAX));
  const out: string[] = [];
  let cur = "";
  for (const t of texts) {
    if (cur && (cur.length + 1 + t.length > CHUNK_MAX || cur.length >= target)) {
      out.push(cur);
      cur = t;
    } else cur = cur ? `${cur} ${t}` : t;
  }
  if (cur) {
    const last = out[out.length - 1];
    if (last !== undefined && cur.length < TAIL_MIN && last.length + 1 + cur.length <= CHUNK_HARD_MAX) out[out.length - 1] = `${last} ${cur}`;
    else out.push(cur);
  }
  return out;
}

function docDrafts(src: DocSource, md: string): Draft[] {
  const drafts: Draft[] = [];
  for (const sec of parseSections(md)) {
    const cfg = sectionConfig(src, sec);
    if (!cfg.include) continue;
    const units = sectionUnits(src, sec, cfg);
    if (!units.length) continue;
    const leaf = sec.path[sec.path.length - 1];
    const title = sec.level === 1 ? src.label : `${headingText(leaf)} — ${src.label}`;
    const anchor = sec.level === 1 ? "introduction" : slug(headingText(leaf));
    const groups = new Map<string, Unit[]>();
    for (const u of units) groups.set(rolesKey(u.roles), [...(groups.get(rolesKey(u.roles)) ?? []), u]);
    const parts = [...groups.values()].flatMap((g) => pack(g.map((u) => u.text)).map((text) => ({ text, roles: g[0].roles })));
    parts.forEach((p, k) =>
      drafts.push({ source: src.path, anchor: parts.length > 1 ? `${anchor}-${k + 1}` : anchor, title, text: p.text, roles: p.roles, section: cfg.section }),
    );
  }
  return drafts;
}

// ---------- Corpus ----------

function finalize(drafts: Draft[]): RagChunk[] {
  const ids = new Set<string>();
  const chunks: RagChunk[] = [];
  for (const d of drafts) {
    const roles = guard(d.roles, `${d.title} ${d.text}`, false);
    if (roles.length !== d.roles.length) console.warn(`  « ${d.title} » (${d.source}) : retiré du manager (mot « lift »).`);
    if (!roles.length || !d.text) continue;
    const sec = SECTION_ROLES.get(d.section) ?? [];
    const hidden = roles.filter((r) => !sec.includes(r));
    if (hidden.length) throw new Error(`« ${d.title} » renvoie vers /aide#${d.section}, invisible pour ${hidden.join(", ")}.`);
    let id = `${d.source}#${d.anchor}`;
    if (ids.has(id)) id = `${id}--${roles.join("-").toLowerCase()}`;
    for (let n = 2; ids.has(id); n++) id = `${d.source}#${d.anchor}-${n}`;
    ids.add(id);
    chunks.push({ id, title: d.title, text: d.text, roles, href: `/aide#${d.section}`, source: d.source });
  }
  return chunks;
}

export function buildChunks(root: string): RagChunk[] {
  const help = dropDuplicateTerms(HELP_SOURCES.flatMap(helpDrafts));
  const docs = DOC_SOURCES.flatMap((src) => docDrafts(src, fs.readFileSync(path.join(root, src.path), "utf8")));
  return finalize([...help, ...docs]);
}

export function buildCorpus(root: string, now: Date = new Date()): RagCorpus {
  const sourcesHash = hashSources((f) => fs.readFileSync(path.join(root, f), "utf8"));
  return { version: 1, generatedAt: now.toISOString(), sourcesHash, chunks: buildChunks(root) };
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) return console.log(USAGE);
  const root = path.resolve(__dirname, "..");
  const file = path.join(root, CORPUS_FILE);
  const corpus = buildCorpus(root);
  let previous: RagCorpus | null = null;
  try {
    previous = JSON.parse(fs.readFileSync(file, "utf8")) as RagCorpus;
  } catch {
    previous = null;
  }
  if (argv.includes("--check")) {
    if (previous?.sourcesHash !== corpus.sourcesHash) {
      console.error(`${CORPUS_FILE} n'est pas à jour : relancez npm run rag:index.`);
      process.exitCode = 1;
    } else console.log(`${CORPUS_FILE} à jour (${corpus.chunks.length} passages).`);
    return;
  }
  const same = previous?.sourcesHash === corpus.sourcesHash && JSON.stringify(previous.chunks) === JSON.stringify(corpus.chunks);
  if (same && previous) corpus.generatedAt = previous.generatedAt;
  fs.writeFileSync(file, `${JSON.stringify(corpus, null, 2)}\n`);

  const bySource = new Map<string, number>();
  for (const c of corpus.chunks) bySource.set(c.source, (bySource.get(c.source) ?? 0) + 1);
  console.log(`${CORPUS_FILE} : ${corpus.chunks.length} passages${same ? " (inchangé)" : ""}, empreinte ${corpus.sourcesHash.slice(0, 12)}`);
  for (const r of ROLE_ORDER) console.log(`  ${r.padEnd(8)} ${corpus.chunks.filter((c) => c.roles.includes(r)).length} passages lisibles`);
  for (const [s, n] of bySource) console.log(`  ${String(n).padStart(4)}  ${s}`);
}

if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  try {
    main();
  } catch (e) {
    console.error((e as Error).message);
    process.exitCode = 2;
  }
}
