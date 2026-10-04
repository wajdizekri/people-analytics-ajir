// Format français des nombres de la synthèse rédigée et outils de contrôle des phrases (comptage des mots, extraction
// des nombres). Partagé par les gabarits, la charge utile envoyée à l'IA générative et la vérification de son texte.

const NBSP = "\u00a0";
const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

export const MONTH_PATTERN = new RegExp(`^(${MONTHS.join("|")}) \\d{4}$`);

const dec = (n: number, d = 1) => n.toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });

export const int = (n: number) => new Intl.NumberFormat("fr-FR").format(Math.round(n));
export const pct = (r: number) => `${dec(r * 100)}${NBSP}%`;
export const pts = (d: number) => `${d > 0 ? "+" : d < 0 ? "−" : ""}${dec(Math.abs(d) * 100)}${NBSP}pt`;
export const hours = (h: number) => `${dec(h)}${NBSP}h`;
export const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
export const dateLabel = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
/** « de juillet 2026 », « d'août 2026 » */
export const ofLabel = (label: string) => (/^[aeiouéèêh]/i.test(label) ? `d'${label}` : `de ${label}`);
export const capitalize = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** « 3 entrées », « 1 entrée », « aucune entrée » */
export function count(n: number, one: string, many: string, none: string): string {
  if (n === 0) return none;
  return `${int(n)} ${n > 1 ? many : one}`;
}

/** Mots d'une phrase : groupes de caractères séparés par des espaces et contenant une lettre ou un chiffre (« 1 234 » = 1 mot). */
export function countWords(sentence: string): number {
  return sentence
    .replace(/(\d)[\s\u00a0\u202f](?=\d{3}(?!\d))/g, "$1")
    .split(/\s+/)
    .filter((t) => /[\p{L}\p{N}]/u.test(t)).length;
}

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Nombre écrit en chiffres, au format français (séparateur de milliers : espace, espace insécable ou fine insécable)
const NUMBER = /\d+(?:[ \u00a0\u202f]\d{3}(?!\d))*(?:,\d+)?/g;

/** Valeurs absolues normalisées (« 1 234,50 » → « 1234.5 », « 08 » → « 8 ») des nombres écrits dans un texte. */
export function numbersIn(text: string): string[] {
  return [...text.matchAll(NUMBER)].map((m) => normalizeNumber(m[0]));
}

export function normalizeNumber(raw: string | number): string {
  const n = typeof raw === "number" ? Math.abs(raw) : Number(raw.replace(/[ \u00a0\u202f]/g, "").replace(",", "."));
  return String(n);
}
