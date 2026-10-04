import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Outils des tests de rendu statique des écrans « Santé des données » et « Dérive des données »

/* eslint-disable @typescript-eslint/no-explicit-any -- options ECharts relues telles que la page les transmet */
export type Any = any;

/** Remplaçant de EChart : la page reste rendue sans canevas, l'option transmise est relisible (attribut data-option). */
export const EChartStub = ({ ariaLabel, option }: { ariaLabel: string; option: unknown }) =>
  createElement("div", { role: "img", "aria-label": ariaLabel, "data-option": JSON.stringify(option) });

const decode = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
const spaces = new RegExp(`[${String.fromCharCode(160, 8239)}]`, "g");

export const html = (el: unknown) => renderToStaticMarkup(el as ReactElement);

/** Texte visible ou non du rendu, balises retirées, espaces (y compris insécables) ramenées à une espace. */
export const text = (markup: string) => decode(markup.replace(/<[^>]+>/g, " ")).replace(spaces, " ").replace(/ +/g, " ");

/** Graphiques de la page, dans l'ordre : résumé pour lecteur d'écran et option ECharts. */
export function charts(markup: string): { label: string; option: Any }[] {
  return [...markup.matchAll(/role="img" aria-label="([^"]*)" data-option="([^"]*)"/g)].map((m) => ({ label: decode(m[1]).replace(spaces, " "), option: JSON.parse(decode(m[2])) }));
}

/** Les repères apparaissent tous, dans cet ordre. */
export function inOrder(s: string, marks: string[]): boolean {
  const at = marks.map((m) => s.indexOf(m));
  return at.every((i, k) => i >= 0 && (k === 0 || i > at[k - 1]));
}

const BLOCK_END = new RegExp("</(p|li|h[1-6]|div|dt|dd|th|td|a|button|summary|figcaption|label|caption|section|nav|ul|ol|option|select|span|strong)>", "g");
// Retire les éléments `tag` dont la balise ouvrante vérifie `when`, contenu compris (balises de même nom imbriquées comptées)
function without(markup: string, tag: string, when: (open: string) => boolean = () => true): string {
  const re = new RegExp(`<(/?)${tag}(?=[ >])[^>]*>`, "g");
  let out = "";
  let last = 0;
  let depth = 0;
  for (let m = re.exec(markup); m; m = re.exec(markup)) {
    const closing = m[1] === "/";
    if (depth === 0) {
      if (closing || !when(m[0])) continue;
      out += markup.slice(last, m.index);
      depth = 1;
    } else if (closing) {
      depth--;
      if (depth === 0) last = m.index + m[0].length;
    } else depth++;
  }
  return out + markup.slice(last);
}

/**
 * Phrases affichées d'emblée (hors blocs repliés, bulles d'aide et tableaux) qui dépassent `max` mots (charte : 20).
 * Une phrase finit à la fin d'un bloc ou sur un point suivi d'une espace ; un mot contient au moins une lettre ou un chiffre.
 */
export function longSentences(markup: string, max = 20): string[] {
  const visible = without(without(without(markup, "details"), "table"), "span", (open) => open.includes('hidden=""') || open.includes("sr-only"));
  const flat = decode(visible.replace(BLOCK_END, " ¶ ").replace(/<[^>]+>/g, " "));
  return flat
    .split(/¶|[.!?…] /)
    .map((s) => s.trim().replace(/ +/g, " "))
    .filter((s) => s.split(" ").filter((w) => /[0-9A-Za-zÀ-ÿ]/.test(w)).length > max);
}
