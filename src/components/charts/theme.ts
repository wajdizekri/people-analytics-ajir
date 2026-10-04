// Palette, polices et formats des graphiques. Module sans "use client" : utilisable côté serveur (construction des options)
// comme dans le wrapper client EChart. Contrastes calculés sur fond blanc.

export const CHART_FONT = '"Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';

// Sémantique fixe de la charte : rouge défavorable, ambre à surveiller, vert favorable, bleu ArabSoft neutre, gris référence / prévision.
// Un statut n'est jamais porté par la couleur seule : rouge et vert ont la même clarté et se confondent pour un daltonien quand ils
// se touchent (écart de 4 en deutéranopie, 8 en sombre), ambre et vert de même en protanopie (7). Aplats de statut accolés : écart
// de 2 px en couleur de surface et libellé écrit (étiquette, légende ou tableau) ; dans une pile, l'ordre Élevé, Moyen, Faible
// place l'ambre entre le rouge et le vert.
export const SEMANTIC = {
  defavorable: "#b91c1c", // 6,5:1
  attention: "#d97706", // 3,2:1, nettement plus clair que le rouge (distinction sans la teinte)
  favorable: "#15803d", // 5,0:1
  neutre: "#1e56a3", // bleu ArabSoft, 7,2:1
  reference: "#5b6b82", // gris des moyennes, seuils, N-1 : 5,3:1
  prevision: "#6b7a90", // gris des prévisions (tirets) : 4,4:1
  contexte: "#7c8aa1", // valeurs mises en retrait : 3,5:1 (#7c8aa0 à l'œil ; clé distincte pour porter son nouvel équivalent sombre)
} as const;
export type Tone = keyof typeof SEMANTIC;

// Niveaux de risque : mêmes couleurs que les badges, dans l'ordre Élevé, Moyen, Faible, Non évalué
export const RISK_COLORS = { ELEVE: SEMANTIC.defavorable, MOYEN: SEMANTIC.attention, FAIBLE: SEMANTIC.favorable, NON_EVALUE: SEMANTIC.contexte } as const;

// Séries sans signification : 6 teintes dans un ordre fixe (la couleur suit la série, jamais son rang : ni recyclage ni
// réordonnancement ; au-delà de 6 séries, regrouper dans « Autres »). Bleu ArabSoft, magenta AJIR, violet, turquoise, bleu vif,
// vieux rose : aucune teinte chaude ni verte, réservées à la sémantique. Passe le validateur de la compétence dataviz en clair
// (#ffffff) et, par DARK_COLORS, en sombre (#111a2b) : clarté et saturation OKLCH, écart entre teintes voisines en vision normale
// et daltonienne (les trois premières : toutes paires), contraste ≥ 3:1. Non-régression : tests/charts/pbi.test.ts.
export const CHART_PALETTE = ["#1e56a3", "#93006a", "#8a4ada", "#1ba0aa", "#4987ff", "#a76088"] as const;

// Encres et traits des options écrites côté serveur (valeurs claires, celles de LIGHT_TOKENS du wrapper client) : texte principal,
// étiquettes, texte secondaire, ligne de base, grille, surface (écart entre aplats), bordure. Remplacées en sombre par DARK_COLORS.
export const CHART_INK = { fg: "#0f172a", ink: "#334155", muted: "#475569", axis: "#94a3b8", grid: "#e5e9f0", surface: "#ffffff", border: "#cbd5e1" } as const;
/** Couleur de surface des cartes : écart entre aplats accolés, anneau d'un repère, détourage d'une étiquette. */
export const CHART_SURFACE = CHART_INK.surface;

// Bande d'incertitude (prévisions) et texte associé
export const BAND_FILL = "rgba(91, 107, 130, 0.16)";
export const BAND_LABEL = "Fourchette probable à 80 %";

// Thème sombre : équivalent de chaque couleur claire des graphiques, ≥ 3:1 sur --pa-surface sombre (#111a2b) pour les tracés,
// ≥ 4,5:1 pour les encres. Appliqué à l'affichage par EChart (les options restent écrites avec les couleurs claires) ;
// en HTML, cssChartColor(hex) renvoie une variable CSS --pa-chart-<hex> définie pour le thème sombre dans globals.css.
// Les statuts restent clairs (rouge 0,71, ambre 0,84, vert 0,80 de clarté OKLCH), hors de la bande des teintes catégorielles :
// c'est leur écart de clarté qui les sépare ; ramenés dans la bande, rouge et vert tombent à un écart de 4 en deutéranopie.
export const DARK_COLORS: Record<string, string> = {
  // sémantique (SEMANTIC, RISK_COLORS, STATUS_COLORS)
  "#b91c1c": "#f87171", // défavorable 6,3:1
  "#d97706": "#fbbf24", // attention 10,4:1
  "#b45309": "#fbbf24",
  "#15803d": "#4ade80", // favorable 10,0:1
  "#1e56a3": "#5b8fcf", // neutre (bleu ArabSoft) 5,2:1
  "#5b6b82": "#94a3b8", // référence 6,8:1
  "#6b7a90": "#8b9ab0", // prévision 6,1:1
  "#7c8aa1": "#65696f", // contexte 3,2:1 ; écart de 16 avec le bleu neutre (une barre mise en valeur ressort des barres grisées)
  "#7c8aa0": "#6f7f99", // gris de contexte d'avant le 04/10/2026 (écart de 8 avec le bleu neutre) : conservé pour les options déjà écrites
  // palette catégorielle (CHART_PALETTE) : mêmes teintes, pas choisis pour la surface sombre (clarté OKLCH 0,48 à 0,67)
  "#93006a": "#c21d7d", // magenta 3,1:1
  "#8a4ada": "#8550d6", // violet 3,4:1
  "#1ba0aa": "#04aaa0", // turquoise 6,0:1
  "#4987ff": "#0f60fa", // bleu vif 3,4:1
  "#a76088": "#a86b9f", // vieux rose 4,4:1
  // palette d'avant le 04/10/2026 : conservée pour les options déjà écrites avec ces teintes
  "#c25e00": "#fb923c",
  "#0e7c6b": "#2dd4bf",
  "#990066": "#f472b6",
  "#6d4fc2": "#a78bfa",
  "#8a6a00": "#c9a227",
  "#475569": "#a3b1c6",
  "#2e8bc0": "#7cc4ef",
  // encres, traits, fonds
  "#0f172a": "#e6edf7",
  "#334155": "#cbd5e1",
  "#64748b": "#94a3b8",
  "#94a3b8": "#5d6e8a",
  "#cbd5e1": "#3a4a66",
  "#e2e8f0": "#26354f",
  "#e5e9f0": "#26354f",
  "#c3ccd8": "#4b5b78",
  "#ffffff": "#111a2b",
  "#fff": "#111a2b",
  [BAND_FILL]: "rgba(148, 163, 184, 0.2)",
};

const DARK_INK = "#0b1220";
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
/** Texte le plus lisible (blanc ou encre) sur un aplat hexadécimal. */
export function bestTextOn(fill: string, ink = DARK_INK) {
  if (!/^#[0-9a-f]{6}$/i.test(fill)) return ink;
  const l = lum(fill);
  return 1.05 / (l + 0.05) >= (l + 0.05) / (lum(ink) + 0.05) ? "#ffffff" : ink;
}

/** Couleur d'un graphique pour le HTML (pastille, légende) : suit le thème via --pa-chart-<hex> (repli : la couleur claire). */
export function cssChartColor(color: string) {
  const k = color.toLowerCase();
  return /^#[0-9a-f]{6}$/.test(k) && DARK_COLORS[k] ? `var(--pa-chart-${k.slice(1)}, ${color})` : color;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- options ECharts hétérogènes, parcourues sans connaître leur forme */
const remap = (v: any): any => {
  if (typeof v === "string") return DARK_COLORS[v.toLowerCase()] ?? DARK_COLORS[v] ?? v;
  if (Array.isArray(v)) return v.map(remap);
  if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) {
    const o: any = {};
    for (const k in v) o[k] = remap(v[k]);
    return o;
  }
  return v;
};
const inside = (label: any) => label && typeof label.position === "string" && label.position.startsWith("inside");
// Étiquette posée dans un aplat : couleur recalculée sur l'aplat sombre
function fixInsideLabel(item: any) {
  if (!item || typeof item !== "object" || !inside(item.label) || typeof item.itemStyle?.color !== "string") return item;
  return { ...item, label: { ...item.label, color: bestTextOn(item.itemStyle.color) } };
}

/** Option ECharts pour le thème sombre : couleurs claires connues remplacées (DARK_COLORS), étiquettes intérieures recontrastées. */
export function darkOption<T extends object>(option: T): T {
  const o = remap(option);
  o.darkMode = true;
  if (o.series)
    o.series = (Array.isArray(o.series) ? o.series : [o.series]).map((s: any) => {
      const next = fixInsideLabel(s);
      return Array.isArray(next?.data) ? { ...next, data: next.data.map(fixInsideLabel) } : next;
    });
  return o;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export const NBSP = " ";

const nfCache = new Map<string, Intl.NumberFormat>();
function nf(min: number, max: number) {
  const k = `${min}-${max}`;
  let f = nfCache.get(k);
  if (!f) nfCache.set(k, (f = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: min, maximumFractionDigits: max })));
  return f;
}

// Nombre au format français : 1 234,5. `digits` fixe le nombre de décimales ; sinon jusqu'à 2, sans zéros inutiles.
export function frNumber(v: number | null | undefined, digits?: number): string {
  if (v == null || typeof v !== "number" || !Number.isFinite(v)) return "—";
  return digits == null ? nf(0, 2).format(v) : nf(digits, digits).format(v);
}

const INVARIANT = new Set(["mois", "fois", "%", "pt", "pts", "TND", "h", "j", "×"]);

// Accord de l'unité : « 1 collaborateur », « 0,5 jour », « 12 jours » (singulier en dessous de 2, règle française)
export function unitFor(v: number, unit: string): string {
  if (!unit || INVARIANT.has(unit) || Math.abs(v) >= 2) return unit;
  return unit.replace(/(\p{L})s(\b|$)/u, "$1$2");
}

// Format d'affichage des valeurs d'un graphique (sérialisable : transmis du serveur au wrapper client)
export type ValueFormat = {
  unit?: string; // « % », « TND », « collaborateurs », « jours »…
  digits?: number; // décimales des infobulles et étiquettes (défaut : 1 pour %, 0 sinon)
  legendValues?: Record<string, string>; // texte ajouté après chaque entrée de légende (anneau : « 19 (2 %) »)
};

export function defaultDigits(unit?: string) {
  return unit === "%" || unit === "pt" ? 1 : 0;
}

export function formatValue(v: number | null | undefined, f: ValueFormat = {}): string {
  if (v == null || typeof v !== "number" || !Number.isFinite(v)) return "—";
  const digits = f.digits ?? defaultDigits(f.unit);
  const n = frNumber(v, digits);
  if (!f.unit) return n;
  return `${n}${NBSP}${unitFor(v, f.unit)}`;
}

// Étiquette courte (barres, axes) : l'unité n'est gardée que pour %, pt et ×
export function formatShort(v: number | null | undefined, f: ValueFormat = {}): string {
  if (v == null || typeof v !== "number" || !Number.isFinite(v)) return "";
  const n = frNumber(v, f.digits ?? defaultDigits(f.unit));
  return f.unit === "%" || f.unit === "pt" || f.unit === "×" ? `${n}${NBSP}${f.unit}` : n;
}

// Nom d'axe : « Taux d'absence (%) », « Effectif (collaborateurs) »
export function axisName(measure: string, unit?: string) {
  return unit ? `${measure} (${unit})` : measure;
}

export function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
