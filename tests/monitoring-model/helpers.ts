// Outils communs aux tests de rendu des écrans « Transparence du modèle » et « Vérification a posteriori »

const decode = (s: string) =>
  s
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

/** Texte visible d'un rendu statique : balises retirées, espaces (dont insécables) ramenés à une espace simple. */
export const text = (markup: string) => decode(markup.replace(/<[^>]+>/g, " ")).replace(/[\s\u00a0\u202f]+/g, " ");

/** Attributs aria-label du rendu (résumés des graphiques pour lecteur d'écran). */
export const ariaLabels = (markup: string) => [...markup.matchAll(/aria-label="([^"]*)"/g)].map((m) => decode(m[1]).replace(/[\u00a0\u202f]/g, " "));

const words = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/**
 * Phrases rédigées de plus de `max` mots : paragraphes et puces du rendu, bulles d'aide exclues (texte du glossaire),
 * de même que les puces qui portent des données structurées (cartes d'un tableau sous 640 px).
 * Une phrase s'arrête à un point, un point d'interrogation ou d'exclamation ; « · » sépare les éléments d'un sous-titre.
 */
export function longSentences(markup: string, max = 20): string[] {
  const noTips = markup.replace(/<span id="[^"]*" hidden=""[\s\S]*?<\/span><\/span>[\s\S]*?<\/span><\/span>/g, "");
  return [...noTips.matchAll(/<(p|li)\b[^>]*>([\s\S]*?)<\/\1>/g)]
    .filter((m) => !/<(dl|table)\b/.test(m[2]))
    .flatMap((m) => text(m[2]).split(/(?<=[.!?…])\s+|\s·\s/))
    .map((s) => s.trim())
    .filter((s) => words(s) > max);
}
